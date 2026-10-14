// Scrittura continua alla Dasher (Ward e MacKay, Cambridge): le lettere scorrono da destra,
// ognuna alta quanto è probabile dopo il testo già scritto. Guardando a destra della croce
// si avanza verso la lettera guardata; guardando a sinistra si torna indietro (e si cancella).
// Non serve fissare nulla: regge bene il tremolio dello sguardo.

const VOWEL_ACCENTS = { a: ["à"], e: ["è", "é"], i: ["ì"], o: ["ò"], u: ["ù"] };
const LETTERS = [..."abcdefghijklmnopqrstuvwxyz"].flatMap((c) => [c, ...(VOWEL_ACCENTS[c] ?? [])]);
const SPACE = " ";
const SPEAK = "\n"; // simbolo speciale: legge la frase
const SYMBOLS = [...LETTERS, "'", SPACE, ".", "?", SPEAK];
const LABELS = { [SPACE]: "␣", [SPEAK]: "Parla" };

const UNIFORM_SHARE = 0.06; // ogni simbolo resta raggiungibile anche se il vocabolario non lo prevede
const DEAD_ZONE = 0.08;     // sguardo vicino alla croce: si sta fermi
const ZOOM_RATE = 1.4;      // velocità di avanzamento con lo sguardo tutto a destra (per secondo)
const CENTER_RATE = 1.2;    // quanto in fretta il punto guardato si sposta verso la croce (per secondo)
const MAX_DEPTH = 3;
const BOX_ASPECT = 2.5;     // larghezza dei riquadri rispetto all'altezza: più larghi = più facili da puntare

// Probabilità della lettera successiva, dalle parole del vocabolario pesate per frequenza.
export class LetterModel {
  // words: ordinate per frequenza; extra: { parola: conteggio } imparate dalla persona.
  constructor(words, extra = {}) {
    const weight = new Map();
    words.forEach((w, i) => weight.set(w, 1 / (i + 10)));
    for (const [w, n] of Object.entries(extra)) weight.set(w, (weight.get(w) ?? 0) + n * 0.05);
    this.entries = [...weight].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    this.keys = this.entries.map((e) => e[0]);
    this.cache = new Map();
  }

  // Intervalli [start, end) in 0..1 per ogni simbolo, dato il testo scritto finora.
  children(text) {
    const partial = text.match(/[^\s.?!']*$/)[0].toLowerCase();
    const wordStart = partial === "";
    const key = `${partial}|${wordStart && text.trim() !== ""}|${/[.?!]\s*$/.test(text)}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const counts = new Map(SYMBOLS.map((s) => [s, 0]));
    let total = 0;
    for (let i = this.lowerBound(partial); i < this.keys.length && this.keys[i].startsWith(partial); i++) {
      const [w, wt] = this.entries[i];
      const next = w.length > partial.length ? w[partial.length] : SPACE; // parola finita: spazio
      if (counts.has(next)) {
        counts.set(next, counts.get(next) + wt);
        total += wt;
      }
    }
    const hasText = text.trim() !== "";
    if (wordStart) {
      // Inizio parola: niente spazio doppio; punteggiatura e "Parla" solo se c'è testo.
      counts.set(SPACE, 0);
      if (hasText) {
        counts.set(".", total * 0.06);
        counts.set("?", total * 0.04);
        counts.set(SPEAK, total * 0.1);
        total *= 1.2;
      }
    }
    const allowed = SYMBOLS.filter((s) => (s !== SPEAK || hasText) && !(wordStart && s === SPACE));
    const uniform = UNIFORM_SHARE / allowed.length;
    let start = 0;
    const out = [];
    for (const s of allowed) {
      const p = (total ? (counts.get(s) / total) * (1 - UNIFORM_SHARE) : 0) + (total ? uniform : 1 / allowed.length);
      out.push({ sym: s, start, end: start + p });
      start += p;
    }
    for (const c of out) { c.start /= start; c.end /= start; } // normalizza a 1
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(key, out);
    return out;
  }

  lowerBound(prefix) {
    let lo = 0, hi = this.keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.keys[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

export class Dasher {
  // getText/setText: testo condiviso con la tastiera; speak(): legge e svuota.
  // getGaze(): {x, y} in pixel della finestra o null; isPaused(): occhi chiusi.
  constructor(canvas, model, { getText, setText, speak, getGaze, isPaused }) {
    this.canvas = canvas;
    this.model = model;
    Object.assign(this, { getText, setText, speak, getGaze, isPaused });
    this.speed = 1;
    this.running = false;
  }

  start() {
    this.resize();
    this.root = this.getText();
    this.center = 0.5;              // punto del nodo radice sotto la croce (0..1)
    this.scale = 1;                 // altezza della radice sullo schermo, in altezze di schermo
    this.lastT = null;
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
      this.step(t);
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    this.rect = r;
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // La radice deve restare abbastanza grande da coprire la croce.
  minScale() { return this.rect.width / (2 * BOX_ASPECT * this.rect.height); }

  step(t) {
    const dt = this.lastT === null ? 0 : Math.min((t - this.lastT) / 1000, 0.1);
    this.lastT = t;
    const g = this.getGaze();
    if (!g || this.isPaused() || dt === 0) return;
    const { left, top, width: W, height: H } = this.rect;
    let dx = (g.x - left - W / 2) / (W / 2);
    const dy = (g.y - top - H / 2) / H;
    if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
    dx = Math.max(-1, Math.min(1, dx));

    // Punto del nodo radice sotto lo sguardo.
    const target = this.center + (dy * H) / (this.scale * H);
    if (dx > 0) {
      // Avanti: si ingrandisce attorno al punto guardato, che resta dov'è sullo schermo
      // (il riquadro che si guarda cresce sotto gli occhi invece di scappare via).
      const f = Math.exp(ZOOM_RATE * this.speed * dx * dt);
      this.center = target - (target - this.center) / f;
      this.scale *= f;
    } else {
      // Indietro: si rimpicciolisce attorno alla croce.
      this.scale *= Math.exp(ZOOM_RATE * 0.7 * this.speed * dx * dt);
    }
    // Intanto il punto guardato scivola verso la croce, così ci si entra.
    this.center += (target - this.center) * Math.min(1, CENTER_RATE * this.speed * dt);
    this.center = Math.max(0, Math.min(1, this.center));

    // Entrata in una lettera: quando il suo riquadro supera la croce, la lettera è scritta.
    const kids = this.model.children(this.root);
    const k = kids.find((c) => this.center >= c.start && this.center < c.end) ?? kids.at(-1);
    const h = (k.end - k.start) * this.scale * H;
    if (h * BOX_ASPECT > W / 2) {
      this.center = (this.center - k.start) / (k.end - k.start);
      this.scale *= k.end - k.start;
      if (k.sym === SPEAK) {
        this.speak();
        this.root = this.getText();
        this.center = 0.5;
        this.scale = 1;
      } else {
        this.root = applySymbol(this.root, k.sym);
        this.setText(this.root);
      }
      return;
    }

    // Uscita dalla radice verso sinistra: si torna al testo precedente (cancella una lettera).
    // (con margine: appena entrati in una lettera la radice è proprio al limite)
    if (this.scale < this.minScale() * 0.8) {
      if (!this.root) {
        this.scale = this.minScale();
        return;
      }
      const parent = this.root.slice(0, -1);
      const last = this.root.slice(-1);
      const p = this.model.children(parent).find((c) => c.sym === last.toLowerCase());
      this.root = parent;
      this.setText(parent);
      if (p) {
        this.center = p.start + this.center * (p.end - p.start);
        this.scale /= p.end - p.start;
      } else {
        this.center = 0.5;
        this.scale = this.minScale();
      }
    }
  }

  draw() {
    const ctx = this.canvas.getContext("2d");
    const { width: W, height: H } = this.rect;
    ctx.fillStyle = "#0f1115";
    ctx.fillRect(0, 0, W, H);
    const y0 = (0 - this.center) * this.scale * H + H / 2;
    const y1 = (1 - this.center) * this.scale * H + H / 2;
    // Riquadro del testo già scritto: contiene le lettere successive (niente vuoti neri).
    ctx.fillStyle = "#171c26";
    const rw = Math.min(W, (y1 - y0) * BOX_ASPECT);
    ctx.fillRect(W - rw, Math.max(0, y0), rw, Math.min(H, y1) - Math.max(0, y0));
    this.drawNode(ctx, this.root, y0, y1, 0, W, H);

    // Croce: guardare a destra avanza, a sinistra torna indietro.
    ctx.strokeStyle = "#ffb300";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 18, H / 2); ctx.lineTo(W / 2 + 18, H / 2);
    ctx.moveTo(W / 2, H / 2 - 18); ctx.lineTo(W / 2, H / 2 + 18);
    ctx.stroke();
  }

  drawNode(ctx, text, y0, y1, depth, W, H) {
    for (const [i, c] of this.model.children(text).entries()) {
      const a = y0 + c.start * (y1 - y0);
      const b = y0 + c.end * (y1 - y0);
      if (b < 0 || a > H || b - a < 1.5) continue;
      const h = b - a;
      const w = Math.min(W, h * BOX_ASPECT);
      ctx.fillStyle = boxColor(c.sym, i, depth);
      ctx.fillRect(W - w, a, w, h);
      ctx.strokeStyle = "#0f1115";
      ctx.strokeRect(W - w, a, w, h);
      if (h > 14) {
        const size = Math.max(12, Math.min(56, h * 0.45));
        ctx.fillStyle = c.sym === SPEAK ? "#4caf50" : "#f2f4f8";
        ctx.font = `600 ${size}px system-ui, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        const label = LABELS[c.sym] ?? c.sym.toUpperCase();
        ctx.fillText(label, W - w + 8, Math.max(size / 2, Math.min(H - size / 2, (Math.max(a, 0) + Math.min(b, H)) / 2)));
      }
      if (depth < MAX_DEPTH && h > 40 && c.sym !== SPEAK) {
        this.drawNode(ctx, applySymbol(text, c.sym), a, b, depth + 1, W, H);
      }
    }
  }
}

function applySymbol(text, sym) {
  if (sym === "." || sym === "?") return text.trimEnd() + sym + " ";
  return text + sym;
}

function boxColor(sym, i, depth) {
  if (sym === SPACE) return depth % 2 ? "#2a3a2a" : "#22322a";
  if (sym === SPEAK) return "#1d2b1d";
  const shades = depth % 2 ? ["#26304a", "#2c3756"] : ["#1e2a3a", "#243246"];
  return shades[i % 2];
}
