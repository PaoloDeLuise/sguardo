// Suoni generati dal browser (Web Audio): nessun file da scaricare, nessuna connessione.
// - click(): riscontro leggero quando una cella scatta;
// - warning(): due note per chi assiste (la fotocamera si è scollegata);
// - Alarm: chiamata d'aiuto, forte e ripetuta finché qualcuno la ferma.

let ctx = null;

// Va chiamata da un clic (per esempio "Avvia fotocamera"): prima di un gesto dell'utente i
// browser non lasciano suonare una pagina.
export function unlock() {
  try {
    ctx ??= new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    // senza audio restano i segnali a schermo
  }
}

// Una nota: frequenza (Hz), inizio (secondi da adesso), durata (secondi), volume 0–1.
function tone(freq, start, duration, volume, type = "sine") {
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    // Attacco e rilascio brevi: senza, ogni nota comincia e finisce con uno schiocco.
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.setValueAtTime(volume, t0 + duration - 0.02);
    gain.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  } catch {
    // audio non disponibile
  }
}

export function click() {
  tone(880, 0, 0.06, 0.08);
}

export function warning() {
  tone(660, 0, 0.25, 0.5, "square");
  tone(440, 0.3, 0.35, 0.5, "square");
}

// Due note alternate, a onda quadra (a parità di volume si sente di più), una volta al secondo.
export class Alarm {
  constructor() {
    this.timer = null;
  }

  get active() {
    return this.timer !== null;
  }

  start() {
    if (this.active) return;
    unlock();
    const cycle = () => {
      tone(988, 0, 0.4, 0.9, "square");
      tone(740, 0.5, 0.4, 0.9, "square");
    };
    cycle();
    this.timer = setInterval(cycle, 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
