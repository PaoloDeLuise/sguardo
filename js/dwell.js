// Scelta della cella da selezionare con lo sguardo. Non dipende dalla pagina: la usa la griglia
// (board.js) e la usa il simulatore (tools/simulate-dwell.mjs).
//
// Due metodi:
// - "classic": un cronometro sulla cella sotto lo sguardo, che riparte da zero appena lo sguardo
//   esce (con un margine del 10% oltre il bordo). Con lo sguardo tremolante un'uscita breve
//   basta a ricominciare.
// - "accumulate": ogni cella accumula "prove" in proporzione alla probabilità che lo sguardo
//   cada su di lei (lo sguardo stimato è una piccola zona d'incertezza, non un punto); le prove
//   calano lentamente quando non la si guarda. Vince la cella che arriva per prima alla soglia:
//   le uscite brevi tolgono poco, guardare stabilmente altrove porta avanti un'altra cella.

export const DWELL = {
  method: "accumulate",
  sigmaPx: 60,   // incertezza dello sguardo (deviazione standard per asse, in pixel)
  decay: 0.5,    // quanto calano al secondo le prove di una cella non guardata (in secondi di fissazione)
  hysteresis: 0.1, // solo "classic": margine oltre il bordo della cella corrente
  normalize: false,
};

export class DwellSelector {
  constructor(options = {}) {
    this.options = { ...DWELL, ...options };
    this.reset();
  }

  reset() {
    this.evidence = [];  // secondi di fissazione accumulati, per cella
    this.current = null; // "classic": cella corrente
    this.since = 0;
  }

  // rects: [{ left, top, right, bottom }] delle celle; gaze: { x, y } o null; dt in ms;
  // needMs(i): fissazione richiesta per la cella i. Restituisce { progress, leader, selected }:
  // progress[i] in 0..1, leader = cella in vantaggio (o null), selected = cella scelta (o null).
  update(rects, gaze, dt, needMs) {
    return this.options.method === "classic"
      ? this.classic(rects, gaze, dt, needMs)
      : this.accumulate(rects, gaze, dt, needMs);
  }

  classic(rects, gaze, dt, needMs) {
    const progress = rects.map(() => 0);
    let cell = null;
    if (gaze) {
      const h = this.options.hysteresis;
      if (this.current !== null && rects[this.current] && inside(rects[this.current], gaze, h)) cell = this.current;
      else cell = rects.findIndex((r) => inside(r, gaze, 0));
      if (cell < 0) cell = null;
    }
    if (cell !== this.current) {
      this.current = cell;
      this.since = 0;
    }
    if (cell === null) return { progress, leader: null, selected: null };
    this.since += dt;
    progress[cell] = Math.min(1, this.since / needMs(cell));
    return { progress, leader: cell, selected: progress[cell] >= 1 ? cell : null };
  }

  accumulate(rects, gaze, dt, needMs) {
    const { sigmaPx, decay } = this.options;
    const s = dt / 1000;
    let weights = gaze ? rects.map((r) => massInRect(r, gaze, sigmaPx)) : rects.map(() => 0);
    // normalize: si assume che la persona stia guardando una delle celle, quindi la probabilità
    // si divide tra le celle (vicino a un bordo conta di più la cella più vicina, ma una vince).
    if (this.options.normalize) {
      const total = weights.reduce((a, b) => a + b, 0);
      if (total > 0.05) weights = weights.map((w) => w / total);
    }
    let leader = null;
    let selected = null;
    const progress = rects.map((r, i) => {
      const e = Math.max(0, (this.evidence[i] ?? 0) + weights[i] * s - decay * (1 - weights[i]) * s);
      this.evidence[i] = e;
      return Math.min(1, (e * 1000) / needMs(i));
    });
    progress.forEach((p, i) => {
      if (p > 0 && (leader === null || p > progress[leader])) leader = i;
    });
    if (leader !== null && progress[leader] >= 1) selected = leader;
    return { progress, leader, selected };
  }
}

// Incertezza dello sguardo adatta alla griglia: il 30% del lato corto di una cella, tra 25 e
// 60 px. Con un valore fisso di 60 px, sulle celle piccole del telefono (~220x115) lo sguardo
// "si allargava" sulle celle vicine e ogni cella accumulava più lentamente.
export function sigmaForCells(rects) {
  const sides = rects.map((r) => Math.min(r.right - r.left, r.bottom - r.top)).sort((a, b) => a - b);
  const typical = sides[sides.length >> 1] ?? 200;
  return Math.max(25, Math.min(60, 0.3 * typical));
}

function inside(r, { x, y }, margin) {
  const mx = (r.right - r.left) * margin, my = (r.bottom - r.top) * margin;
  return x >= r.left - mx && x <= r.right + mx && y >= r.top - my && y <= r.bottom + my;
}

// Probabilità che lo sguardo vero cada nel rettangolo, se quello stimato è (x, y) con
// incertezza gaussiana sigma per asse.
function massInRect(r, { x, y }, sigma) {
  const k = 1 / (sigma * Math.SQRT2);
  const px = (erf((r.right - x) * k) - erf((r.left - x) * k)) / 2;
  const py = (erf((r.bottom - y) * k) - erf((r.top - y) * k)) / 2;
  return px * py;
}

// Approssimazione di Abramowitz e Stegun (errore < 1.5e-7).
function erf(v) {
  const sign = Math.sign(v);
  const a = Math.abs(v);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496735) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}
