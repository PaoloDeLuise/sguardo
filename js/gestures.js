// Gesti che abbassano la penna della scrittura a mano (e la alzano, volendo): occhiolino e bocca
// aperta. Un puntatore non ha pulsante e questi gesti non muovono il puntatore (con la testa che
// guida, gli occhi e la mandibola sono indipendenti).
//
// Per ogni gesto c'è un livello: 1 = soglia. Il gesto è "attivo" sopra la soglia e si disattiva
// scendendo sotto il 60% della soglia (isteresi, per non tremare attorno al limite). Se resta attivo
// per `hold` millisecondi e per almeno MIN_FRAMES fotogrammi scatta, una sola volta: per scattare
// ancora bisogna rilasciarlo. I fotogrammi contano perché sul telefono ce ne sono pochi al secondo
// e il segnale è rumoroso: a 10 fps 150 ms sono un fotogramma solo, e uno scatto isolato non basta.
// Il livello si mostra a schermo (barra nell'area di disegno) per tarare la sensibilità sul proprio
// dispositivo.

export const GESTURE_MODES = ["wink", "mouth"];

// Soglie con sensibilità 1. wink: un occhio chiuso oltre `on` e l'altro sotto `other`.
const THRESHOLDS = { wink: { on: 0.6, other: 0.35 }, mouth: { on: 0.35 } };
const HOLD_MS = { wink: 150, mouth: 200 };
const MIN_FRAMES = 3;
const RELEASE = 0.6;        // si disattiva sotto questa parte della soglia
const ONSET = 0.5;          // il gesto "comincia" quando il livello supera questa parte della soglia
const MAX_BACK_MS = 800;    // quanto indietro al massimo si tolgono i punti disegnati durante il gesto

export class GestureDetector {
  constructor() {
    this.mode = "wink";
    this.sensitivity = 1; // più alto = gesto più facile (soglia divisa per questo)
    this.reset();
  }

  reset() {
    this.level = 0;
    this.active = false;
    this.since = null;
    this.frames = 0;      // fotogrammi consecutivi con il gesto attivo
    this.onsetAt = null;  // da quando il livello è continuamente sopra ONSET
    this.handled = false;
  }

  // f: fotogramma del tracker { face, eyes: [sinistro, destro], jaw }.
  measure(f) {
    if (!f.face) return 0;
    const k = this.sensitivity;
    if (this.mode === "wink") {
      const [l, r] = f.eyes ?? [0, 0];
      const { on, other } = THRESHOLDS.wink;
      const big = Math.max(l, r), small = Math.min(l, r);
      // L'occhio chiuso conta anche se l'altro è un po' chiuso, ma non se lo sono tutti e due (battito).
      return small < other ? big / (on / k) : 0;
    }
    if (this.mode === "mouth") return (f.jaw ?? 0) / (THRESHOLDS.mouth.on / k);
    return 0;
  }

  // Un fotogramma. Restituisce true quando il gesto scatta.
  update(f) {
    this.level = this.measure(f);
    if (this.level >= ONSET) this.onsetAt ??= f.t;
    else this.onsetAt = null;
    if (!this.active && this.level >= 1) {
      this.active = true;
      this.since = f.t;
      this.frames = 0;
    } else if (this.active && this.level < RELEASE) {
      this.active = false;
      this.since = null;
      this.handled = false;
    }
    if (this.active) this.frames++;
    if (this.active && !this.handled && f.t - this.since >= HOLD_MS[this.mode] && this.frames >= MIN_FRAMES) {
      this.handled = true;
      return true;
    }
    return false;
  }

  // Quanto indietro, da t, tagliare il tratto: i punti disegnati da quando il gesto è cominciato
  // (non solo da quando è scattato) sono già mossi dal gesto: aprendo la bocca la testa si sposta.
  backMsAt(t) {
    const since = this.onsetAt == null ? 0 : t - this.onsetAt;
    return Math.min(MAX_BACK_MS, Math.max(this.backMs, since + 100));
  }

  // Minimo: il tempo di tenuta più un margine.
  get backMs() { return HOLD_MS[this.mode] + 120; }
}
