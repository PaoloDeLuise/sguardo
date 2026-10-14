"""Voce clonata per Sguardo, con Coqui XTTS-v2.

La clonazione si fa una volta: i vocali caricati vengono convertiti, uniti, ripuliti dai
silenzi e analizzati; il risultato (voce/voce-clonata.pt) viene riusato per ogni frase.

Il modello XTTS-v2 è distribuito con la Coqui Public Model License (solo uso non
commerciale, https://coqui.ai/cpml): viene scaricato (circa 1,8 GB) solo dopo che chi usa
Sguardo l'ha accettata nella pagina. Il codice di coqui-tts è MPL-2.0.

Tempi misurati su un portatile i7-1255U senza scheda grafica dedicata: caricamento 18 s,
clonazione 1,3 s, generazione circa 3,4 volte la durata della frase (2,5 con SGUARDO_INT8=1,
predefinito: il modello compresso a 8 bit è circa il 30% più veloce).

Richiede le dipendenze di requirements-voce.txt e ffmpeg nel PATH.
"""

import hashlib
import io
import os
import pathlib
import re
import shutil
import subprocess
import threading
import wave

ROOT = pathlib.Path(__file__).resolve().parent
VOICE_DIR = ROOT / "voce"
SAMPLES_DIR = VOICE_DIR / "campioni"
REFERENCES_DIR = VOICE_DIR / "riferimenti"  # un file ripulito per ogni vocale
LATENTS = VOICE_DIR / "voce-clonata.pt"
LICENSE_ACCEPTED = VOICE_DIR / "licenza-cpml-accettata.txt"
# Frasi già generate. Le frasi rapide (keep) restano per sempre: sono poche e devono partire
# subito. Le altre (frasi scritte e versioni intermedie generate mentre si scrive) vanno in una
# memoria temporanea: si tengono solo le più recenti, così lo spazio non cresce (~48 KB per
# secondo di audio, una frase scritta lascia 0,5–1 MB) e non restano frasi personali su disco.
AUDIO_CACHE = VOICE_DIR / "frasi"
KEPT_DIR = AUDIO_CACHE / "fisse"
RECENT_DIR = AUDIO_CACHE / "recenti"
MAX_RECENT_FILES = 100
MAX_RECENT_BYTES = 15 * 1024 * 1024

MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
LANGUAGE = "it"
SAMPLE_RATE = 24000  # uscita di XTTS
# Come usa i campioni XTTS (configurazione ufficiale): il timbro viene calcolato da ogni file
# (fino a 30 s ciascuno) e mediato, quindi più vocali lo rendono più stabile; intonazione e
# modo di parlare vengono dai primi 30 s di tutti i file messi in fila.
MAX_SECONDS_PER_SAMPLE = 30
MIN_REFERENCE_SECONDS = 5
MAX_SAMPLE_BYTES = 30 * 1024 * 1024
QUANTIZE = os.environ.get("SGUARDO_INT8", "1") == "1"


class VoiceEngine:
    def __init__(self):
        self.model = None
        self.latents = None  # (gpt_cond_latent, speaker_embedding)
        self.state = "non caricato"  # non caricato | caricamento | pronto | errore
        self.error = None
        self._load_lock = threading.Lock()
        self._synth_lock = threading.Lock()  # il modello genera una frase alla volta

    @staticmethod
    def installed():
        try:
            import TTS  # noqa: F401
        except ImportError:
            return False
        return shutil.which("ffmpeg") is not None

    def status(self):
        return {
            "installed": self.installed(),
            "license": LICENSE_ACCEPTED.exists(),
            "state": self.state,
            "error": self.error,
            "cloned": LATENTS.exists(),
            "samples": sorted(p.name for p in SAMPLES_DIR.glob("*")) if SAMPLES_DIR.exists() else [],
        }

    def accept_license(self):
        VOICE_DIR.mkdir(parents=True, exist_ok=True)
        LICENSE_ACCEPTED.write_text("Coqui Public Model License (https://coqui.ai/cpml) accettata dalla pagina di Sguardo.\n", encoding="utf-8")

    def load_in_background(self):
        threading.Thread(target=self.load, daemon=True).start()

    def load(self):
        """Carica il modello (al primo uso lo scarica, circa 1,8 GB)."""
        with self._load_lock:
            if self.model is not None:
                return
            if not LICENSE_ACCEPTED.exists():
                raise ValueError("Per usare la voce clonata bisogna prima accettare la licenza del modello.")
            self.state = "caricamento"
            try:
                import torch
                from TTS.tts.configs.xtts_config import XttsConfig
                from TTS.tts.models.xtts import Xtts
                from TTS.utils.manage import ModelManager

                os.environ["COQUI_TOS_AGREED"] = "1"  # accettata nella pagina (LICENSE_ACCEPTED)
                model_dir = pathlib.Path(ModelManager().download_model(MODEL_NAME)[0])
                config = XttsConfig()
                config.load_json(str(model_dir / "config.json"))
                model = Xtts.init_from_config(config)
                model.load_checkpoint(config, checkpoint_dir=str(model_dir), use_deepspeed=False)
                model.eval()
                # Il tracciamento dello sguardo gira nel browser sullo stesso processore:
                # gli si lasciano 2 core liberi, così non rallenta mentre la voce si genera.
                torch.set_num_threads(max(1, torch.get_num_threads() - 2))  # predefinito: un thread per core fisico
                if QUANTIZE:
                    quantize_gpt(model)
                if LATENTS.exists():
                    saved = torch.load(LATENTS, weights_only=True)  # solo tensori: niente codice eseguibile
                    self.latents = (saved["gpt"], saved["speaker"])
                self.model = model
                self.state = "pronto"
                self.error = None
            except Exception as e:  # noqa: BLE001 - lo stato viene mostrato nella pagina
                self.state = "errore"
                self.error = str(e)
                raise

    def add_sample(self, name, data):
        if not data or len(data) > MAX_SAMPLE_BYTES:
            raise ValueError("File vuoto o troppo grande (massimo 30 MB).")
        SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^\w.\-]", "_", pathlib.Path(name).name)[:80] or "vocale"
        (SAMPLES_DIR / safe).write_bytes(data)
        return safe

    def reset(self):
        """Cancella vocali e voce clonata (la licenza resta accettata)."""
        shutil.rmtree(SAMPLES_DIR, ignore_errors=True)
        shutil.rmtree(AUDIO_CACHE, ignore_errors=True)
        shutil.rmtree(REFERENCES_DIR, ignore_errors=True)
        (VOICE_DIR / "riferimento.wav").unlink(missing_ok=True)  # versione precedente
        LATENTS.unlink(missing_ok=True)
        self.latents = None

    def clone(self):
        """Prepara il riferimento dai vocali caricati e salva la voce clonata."""
        samples = sorted(SAMPLES_DIR.glob("*")) if SAMPLES_DIR.exists() else []
        if not samples:
            raise ValueError("Carica almeno un vocale.")
        references, seconds = build_references(samples, REFERENCES_DIR)
        if seconds < MIN_REFERENCE_SECONDS:
            raise ValueError(f"Dopo aver tolto i silenzi restano solo {seconds:.1f} s di voce: ne servono almeno {MIN_REFERENCE_SECONDS}.")
        self.load()
        import torch

        config = self.model.config
        with self._synth_lock:
            gpt, speaker = self.model.get_conditioning_latents(
                audio_path=[str(r) for r in references],
                max_ref_length=config.max_ref_len,          # 30 s per file
                gpt_cond_len=config.gpt_cond_len,           # 30 s per l'intonazione (il predefinito sarebbe 6)
                gpt_cond_chunk_len=config.gpt_cond_chunk_len,
            )
            torch.save({"gpt": gpt, "speaker": speaker}, LATENTS)
            self.latents = (gpt, speaker)
            shutil.rmtree(AUDIO_CACHE, ignore_errors=True)  # erano con la voce precedente
        return seconds

    def synthesize(self, text, keep=False):
        """Restituisce la frase come file WAV (bytes) con la voce clonata.
        keep: frase da conservare per sempre (frasi rapide)."""
        if not LATENTS.exists():
            raise ValueError("Nessuna voce clonata.")
        name = hashlib.sha1(text.encode("utf-8")).hexdigest() + ".wav"
        for folder in (KEPT_DIR, RECENT_DIR):
            if (folder / name).exists():
                if folder is RECENT_DIR:
                    os.utime(folder / name)  # usata di recente: resta più a lungo
                return (folder / name).read_bytes()
        cached = (KEPT_DIR if keep else RECENT_DIR) / name
        self.load()
        with self._synth_lock:
            if cached.exists():  # generata da un'altra richiesta mentre questa aspettava
                return cached.read_bytes()
            out = self.model.inference(text, LANGUAGE, *self.latents, enable_text_splitting=True)
            audio = to_wav_bytes(out["wav"], SAMPLE_RATE)
            cached.parent.mkdir(parents=True, exist_ok=True)
            cached.write_bytes(audio)
            if not keep:
                prune_recent()
        return audio


def prune_recent():
    """Cancella le frasi temporanee meno usate oltre MAX_RECENT_FILES o MAX_RECENT_BYTES."""
    files = sorted(RECENT_DIR.glob("*.wav"), key=lambda p: p.stat().st_mtime, reverse=True)
    total = 0
    for i, path in enumerate(files):
        total += path.stat().st_size
        if i >= MAX_RECENT_FILES or total > MAX_RECENT_BYTES:
            path.unlink(missing_ok=True)


def quantize_gpt(model):
    """Comprime a 8 bit la parte di XTTS che genera il parlato: circa il 30% più veloce
    sul processore. GPT-2 usa Conv1D (pesi trasposti), che vanno prima convertiti in Linear."""
    import torch
    from transformers.pytorch_utils import Conv1D

    def convert(module):
        for name, child in module.named_children():
            if isinstance(child, Conv1D):
                linear = torch.nn.Linear(child.weight.shape[0], child.weight.shape[1])
                linear.weight.data = child.weight.data.t().contiguous()
                linear.bias.data = child.bias.data
                setattr(module, name, linear)
            else:
                convert(child)

    convert(model.gpt)
    model.gpt = torch.ao.quantization.quantize_dynamic(model.gpt, {torch.nn.Linear}, dtype=torch.qint8)


def build_references(samples, out_dir):
    """Converte ogni vocale (anche .opus di WhatsApp o le registrazioni del browser) in un file
    WAV ripulito: senza silenzi lunghi, volume uniforme, al massimo MAX_SECONDS_PER_SAMPLE.
    Restituisce i file ottenuti e la durata totale del parlato."""
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    references, total = [], 0.0
    for i, path in enumerate(samples):
        out = out_dir / f"{i:03d}.wav"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(path),
             "-af", "silenceremove=start_periods=1:start_threshold=-40dB:"
                    "stop_periods=-1:stop_duration=0.4:stop_threshold=-40dB,loudnorm",
             "-ar", str(SAMPLE_RATE), "-ac", "1", "-t", str(MAX_SECONDS_PER_SAMPLE), str(out)],
            check=True, capture_output=True,
        )
        with wave.open(str(out), "rb") as w:
            seconds = w.getnframes() / w.getframerate()
        if seconds >= 1:  # file vuoti o solo silenzio non servono
            references.append(out)
            total += seconds
        else:
            out.unlink()
    return references, total


def to_wav_bytes(samples, rate):
    import numpy as np

    pcm = (np.clip(np.asarray(samples), -1, 1) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()
