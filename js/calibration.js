// Sequenza di punti da guardare, per calibrare e per misurare la precisione.

// Griglia 3x3 vicino ai bordi + 4 punti intermedi (coordinate 0..1 della finestra).
// Il centro è ripetuto alla fine: durante il primo punto spesso ci si sta ancora
// sistemando e la postura cambia.
export const CALIB_POINTS = [
  [0.5, 0.5],
  [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
  [0.92, 0.5], [0.92, 0.92], [0.5, 0.92],
  [0.08, 0.92], [0.08, 0.5],
  [0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7],
  [0.5, 0.5],
];

// Ricalibrazione rapida (circa 10 s): centro e quattro angoli.
export const QUICK_POINTS = [
  [0.5, 0.5], [0.08, 0.08], [0.92, 0.08], [0.92, 0.92], [0.08, 0.92],
];

// Punti diversi da quelli di calibrazione, per una misura onesta dell'errore.
export const VALIDATION_POINTS = [
  [0.5, 0.25], [0.75, 0.5], [0.5, 0.75], [0.25, 0.5],
];

export class Aborted extends Error {}

export class Calibrator {
  constructor(overlay, target, msg) {
    this.overlay = overlay;
    this.target = target;
    this.msg = msg;
    this.aborted = false;
  }

  abort() { this.aborted = true; }

  async sleep(ms) {
    await new Promise((r) => setTimeout(r, ms));
    if (this.aborted) throw new Aborted();
  }

  async intro(text, ms) {
    this.msg.textContent = text;
    this.moveTarget([0.5, 0.5]);
    await this.sleep(ms);
    this.msg.textContent = "";
  }

  moveTarget([x, y]) {
    this.target.style.left = `${x * 100}%`;
    this.target.style.top = `${y * 100}%`;
  }

  // sampler.start() inizia a raccogliere, sampler.stop() restituisce i campioni,
  // sampler.stable() dice se l'occhio è fermo. La raccolta parte quando l'occhio
  // si è fermato sul punto, o comunque dopo maxSettleMs.
  async runPoints(points, sampler, { minSettleMs = 700, maxSettleMs = 2000, collectMs = 1000 } = {}) {
    const results = [];
    for (const p of points) {
      this.target.classList.remove("collecting");
      this.moveTarget(p);
      await this.sleep(minSettleMs);
      for (let waited = minSettleMs; waited < maxSettleMs && !sampler.stable(); waited += 50) {
        await this.sleep(50);
      }
      this.target.classList.add("collecting");
      sampler.start();
      try {
        await this.sleep(collectMs);
      } finally {
        results.push({ point: p, samples: sampler.stop() });
      }
    }
    this.target.classList.remove("collecting");
    return results;
  }
}

// Scarta i campioni presi mentre l'occhio non era fermo sul punto: iride orizzontale,
// palpebra o blendshape orizzontale lontani dalla mediana del punto.
export function cleanSamples(samples) {
  if (samples.length < 5) return samples;
  const keep = new Array(samples.length).fill(true);
  for (const j of [0, 2, 3]) {
    const vals = samples.map((s) => s[j]);
    const med = median(vals);
    const mad = median(vals.map((v) => Math.abs(v - med))) || 1e-6;
    vals.forEach((v, i) => {
      if (Math.abs(v - med) > 3 * 1.4826 * mad) keep[i] = false;
    });
  }
  return samples.filter((_, i) => keep[i]);
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
