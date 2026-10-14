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

// Velocità del punto che scivola da una posizione all'altra (frazioni di schermo al secondo):
// abbastanza lenta da poterlo seguire con gli occhi senza scatti.
const GLIDE_SPEED = 0.6;
const MIN_GLIDE_MS = 500;
const MAX_GLIDE_MS = 1600;

export class Calibrator {
  constructor(overlay, target, msg) {
    this.overlay = overlay;
    this.target = target;
    this.msg = msg;
    this.aborted = false;
    this.position = [0.5, 0.5];
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
    this.position = [x, y];
    this.target.style.left = `${x * 100}%`;
    this.target.style.top = `${y * 100}%`;
  }

  // Sposta il punto a velocità costante. Restituisce il tratto percorso: { t0, t1, from, to }
  // (tempi di performance.now, lo stesso orologio dei fotogrammi).
  async glideTo(to) {
    const from = this.position;
    const ms = Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, (Math.hypot(to[0] - from[0], to[1] - from[1]) / GLIDE_SPEED) * 1000));
    const t0 = performance.now();
    await new Promise((resolve) => {
      const frame = (t) => {
        const k = Math.min(1, (t - t0) / ms);
        this.moveTarget([from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k]);
        if (k < 1 && !this.aborted) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    if (this.aborted) throw new Aborted();
    return { t0, t1: t0 + ms, from, to };
  }

  // Per ogni punto: il punto scivola fin lì (gli occhi lo inseguono: si registra anche questo),
  // poi si aspetta che l'occhio sia fermo e si raccolgono i campioni.
  // sampler.start() inizia a raccogliere, sampler.stop() restituisce i fotogrammi,
  // sampler.stable() dice se l'occhio è fermo.
  // Restituisce { fixations: [{ point, samples }], pursuit: [{ segment, samples }] }.
  async runPoints(points, sampler, { minSettleMs = 400, maxSettleMs = 2000, collectMs = 1000 } = {}) {
    const fixations = [];
    const pursuit = [];
    for (const p of points) {
      this.target.classList.remove("collecting");
      sampler.start();
      let segment;
      try {
        segment = await this.glideTo(p);
      } finally {
        const samples = sampler.stop();
        if (segment) pursuit.push({ segment, samples });
      }
      await this.sleep(minSettleMs);
      for (let waited = minSettleMs; waited < maxSettleMs && !sampler.stable(); waited += 50) {
        await this.sleep(50);
      }
      this.target.classList.add("collecting");
      sampler.start();
      try {
        await this.sleep(collectMs);
      } finally {
        fixations.push({ point: p, samples: sampler.stop() });
      }
    }
    this.target.classList.remove("collecting");
    return { fixations, pursuit };
  }
}

// Esempi presi mentre gli occhi inseguivano il punto: ogni fotogramma ha come etichetta la
// posizione del punto lagMs prima (l'occhio insegue con un po' di ritardo). Si scarta l'inizio
// di ogni tratto, quando l'occhio sta ancora raggiungendo il punto con uno scatto.
// frames: [{ t, features }] già senza battiti di ciglia.
export function pursuitExamples(pursuit, lagMs, skipMs = 250) {
  const out = [];
  for (const { segment: { t0, t1, from, to }, samples } of pursuit) {
    for (const f of samples) {
      if (f.t < t0 + skipMs || f.t > t1 + lagMs) continue;
      const k = Math.min(1, Math.max(0, (f.t - lagMs - t0) / (t1 - t0)));
      out.push({ point: [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k], samples: [f.features] });
    }
  }
  return out;
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
