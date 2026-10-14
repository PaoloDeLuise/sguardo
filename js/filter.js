// Filtro One Euro: smorza il tremolio quando lo sguardo è fermo,
// ma segue rapidamente i movimenti ampi.
class LowPass {
  constructor() { this.y = null; }
  filter(x, a) {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y;
    return this.y;
  }
}

export class OneEuro {
  constructor(minCutoff = 0.4, beta = 0.004, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.tPrev = null;
    this.xPrev = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  // t in secondi
  filter(value, t) {
    if (this.tPrev === null) {
      this.tPrev = t;
      this.xPrev = value;
      return this.x.filter(value, 1);
    }
    const dt = Math.max(t - this.tPrev, 1e-3);
    const edx = this.dx.filter((value - this.xPrev) / dt, OneEuro.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    this.tPrev = t;
    this.xPrev = value;
    return this.x.filter(value, OneEuro.alpha(cutoff, dt));
  }
}
