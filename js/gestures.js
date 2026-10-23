// Gesti che abbassano e alzano la penna della scrittura a mano: occhiolino, bocca aperta,
// inclinazione della testa. Un puntatore non ha pulsante e questi gesti non muovono il puntatore
// (con la testa che guida, la mandibola e l'inclinazione laterale sono assi indipendenti).
//
// Per ogni gesto c'è un livello: 1 = soglia. Il gesto è "attivo" sopra la soglia e si disattiva
// scendendo sotto il 60% della soglia (isteresi, per non tremare attorno al limite). Se resta attivo
// per `hold` millisecondi scatta, una sola volta: per scattare ancora bisogna rilasciarlo.
// Il livello si mostra a schermo (barra nell'area di disegno) per tarare la sensibilità sul proprio
// dispositivo: sul telefono i segnali sono più rumorosi che sul portatile.

export const GESTURE_MODES = ["wink", "mouth", "tilt"];

// Soglie con sensibilità 1. wink: un occhio chiuso oltre `on` e l'altro sotto `other`.
const THRESHOLDS = { wink: { on: 0.6, other: 0.35 }, mouth: { on: 0.35 }, tilt: { on: 15 } }; // tilt in gradi
const HOLD_MS = { wink: 150, mouth: 200, tilt: 250 };
const RELEASE = 0.6;        // si disattiva sotto questa parte della soglia
const BASELINE_RATE = 0.02; // quanto in fretta la posizione "dritta" segue la testa (per fotogramma)

const wrap = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;

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
    this.handled = false;
    this.baseline = null; // inclinazione "dritta" della testa
  }

  // f: fotogramma del tracker { face, eyes: [sinistro, destro], jaw, roll (gradi) }.
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
    if (this.mode === "tilt") {
      if (f.roll == null) return 0;
      this.baseline ??= f.roll;
      const delta = Math.abs(wrap(f.roll - this.baseline));
      const on = THRESHOLDS.tilt.on / k;
      // La posizione dritta segue lentamente la testa, ma non mentre è inclinata.
      if (delta < on * RELEASE) this.baseline += wrap(f.roll - this.baseline) * BASELINE_RATE;
      return delta / on;
    }
    return 0;
  }

  // Un fotogramma. Restituisce true quando il gesto scatta.
  update(f) {
    this.level = this.measure(f);
    if (!this.active && this.level >= 1) {
      this.active = true;
      this.since = f.t;
    } else if (this.active && this.level < RELEASE) {
      this.active = false;
      this.since = null;
      this.handled = false;
    }
    if (this.active && !this.handled && f.t - this.since >= HOLD_MS[this.mode]) {
      this.handled = true;
      return true;
    }
    return false;
  }

  // Quanto tempo prima dello scatto è cominciato il gesto: i punti disegnati in quel momento
  // erano già disturbati dal gesto e si tolgono dalla fine del tratto.
  get backMs() { return HOLD_MS[this.mode] + 120; }
}
