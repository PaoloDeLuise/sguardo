// Scrittura continua alla Dasher (Ward e MacKay, Cambridge): le lettere scorrono verso la
// croce, ognuna grande quanto è probabile dopo il testo già scritto. Guardando oltre la croce
// (dalla parte da cui arrivano le lettere) si avanza verso la lettera guardata; guardando dalla
// parte opposta si torna indietro (e si cancella). Non serve fissare nulla.
//
// Due orientamenti:
// - "horizontal": lettere affiancate da sinistra a destra, arrivano dall'alto. Lo schermo è più
//   largo che alto, quindi le lettere sono molto più grandi.
// - "vertical": lettere una sotto l'altra, arrivano da destra (il Dasher classico).

import { t } from "./i18n.js";

// Vocali accentate dell'italiano: la lingua in uso passa le sue (vedi js/locales/).
const ITALIAN_ACCENTS = { a: ["à"], e: ["è", "é"], i: ["ì"], o: ["ò"], u: ["ù"] };
const SPACE = " ";
const SPEAK = "\n"; // simbolo speciale: legge la frase

// Simboli della scrittura continua: lettere (con gli accenti della lingua), apostrofo, spazio,
// punteggiatura e "Parla".
function symbolsFor(accents) {
  const letters = [..."abcdefghijklmnopqrstuvwxyz"].flatMap((c) => [c, ...(accents[c] ?? [])]);
  return [...letters, "'", SPACE, ".", "?", SPEAK];
}

function labelFor(sym) {
  if (sym === SPACE) return "␣";
  if (sym === SPEAK) return t("kb.speak");
  return sym.toUpperCase();
}

const UNIFORM_SHARE = 0.06; // ogni simbolo resta raggiungibile anche se il vocabolario non lo prevede
const DEAD_ZONE = 0.08;     // sguardo vicino alla croce: si sta fermi
const ZOOM_RATE = 1.4;      // velocità di avanzamento con lo sguardo tutto in avanti (per secondo)
const MAX_DEPTH = 3;
// Profondità dei riquadri rispetto alla loro grandezza, in proporzione allo schermo: una lettera
// è "scritta" quando il suo riquadro raggiunge la croce, cioè quando occupa circa metà della
// lunghezza su cui sono disposte le lettere.
const BOX_DEPTH = 0.9;

// Movimento. anchor: da dove parte lo zoom, tra la croce (0) e il punto guardato (1);
// centerRate: quanto in fretta (al secondo) il punto guardato si sposta verso la croce;
// edgeBoost: quanto più in fretta se il punto è vicino al bordo.
// La prima versione era { anchor: 1, centerRate: 1.2, edgeBoost: 0 }: le lettere guardate vicino
// al bordo crescevano verso il bordo e uscivano dallo schermo prima di arrivare alla croce.
export const MOTION = { anchor: 0.5, centerRate: 2.5, edgeBoost: 1 };

// Colori per lo sfondo scuro e per quello chiaro (che illumina il viso, vedi style.css).
const PALETTES = {
  dark: {
    bg: "#0f1115", root: "#171c26", cross: "#ffb300", line: "#0f1115", text: "#f2f4f8", speakText: "#4caf50",
    space: ["#22322a", "#2a3a2a"], speak: "#1d2b1d", even: ["#1e2a3a", "#243246"], odd: ["#26304a", "#2c3756"],
  },
  light: {
    bg: "#f4f6fa", root: "#e9edf3", cross: "#e65100", line: "#f4f6fa", text: "#11151c", speakText: "#2e7d32",
    space: ["#d7ecd9", "#c8e4cb"], speak: "#d7ecd9", even: ["#d6e4f2", "#c8daee"], odd: ["#bfd3ea", "#b2c9e4"],
  },
};

// Probabilità della lettera successiva, dalle parole del vocabolario pesate per frequenza.
export class LetterModel {
  // words: ordinate per frequenza; extra: { parola: conteggio } imparate dalla persona;
  // options: { accents, apostropheInWord } dalla lingua in uso (di default l'italiano).
  constructor(words, extra = {}, { accents = ITALIAN_ACCENTS, apostropheInWord = false } = {}) {
    this.symbols = symbolsFor(accents);
    this.apostropheInWord = apostropheInWord;
    const weight = new Map();
    words.forEach((w, i) => weight.set(w, 1 / (i + 10)));
    for (const [w, n] of Object.entries(extra)) weight.set(w, (weight.get(w) ?? 0) + n * 0.05);
    this.entries = [...weight].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    this.keys = this.entries.map((e) => e[0]);
    this.cache = new Map();
  }

  // Intervalli [start, end) in 0..1 per ogni simbolo, dato il testo scritto finora.
  children(text) {
    const partial = text.match(this.apostropheInWord ? /[^\s.?!]*$/ : /[^\s.?!']*$/)[0].toLowerCase();
    const wordStart = partial === "";
    const key = `${partial}|${wordStart && text.trim() !== ""}|${/[.?!]\s*$/.test(text)}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const counts = new Map(this.symbols.map((s) => [s, 0]));
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
    const allowed = this.symbols.filter((s) => (s !== SPEAK || hasText) && !(wordStart && s === SPACE));
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
  // options: { orientation: "horizontal" | "vertical", motion: { anchor, centerRate, edgeBoost } }
  constructor(canvas, model, { getText, setText, speak, getGaze, isPaused }, options = {}) {
    this.canvas = canvas;
    this.model = model;
    Object.assign(this, { getText, setText, speak, getGaze, isPaused });
    this.speed = 1;
    this.orientation = options.orientation ?? "horizontal";
    this.motion = { ...MOTION, ...options.motion };
    this.palette = PALETTES.dark;
    this.running = false;
  }

  start() {
    this.resize();
    this.reset();
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
      this.step(t);
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  reset() {
    this.root = this.getText();
    this.center = 0.5; // punto del nodo radice sotto la croce (0..1)
    this.scale = 1;    // grandezza della radice sullo schermo, in lunghezze dell'asse delle lettere
    this.lastT = null;
  }

  stop() { this.running = false; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio || 1;
    this.rect = r;
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  get horizontal() { return this.orientation === "horizontal"; }

  set light(on) { this.palette = on ? PALETTES.light : PALETTES.dark; }

  // S: lunghezza dell'asse su cui sono disposte le lettere; F: lunghezza dell'asse "avanti".
  get axes() {
    const { width: W, height: H } = this.rect;
    return this.horizontal ? { S: W, F: H } : { S: H, F: W };
  }

  // Profondità dei riquadri per pixel di grandezza.
  get depth() { const { S, F } = this.axes; return (BOX_DEPTH * F) / S; }

  // La radice deve restare abbastanza grande da coprire la croce.
  minScale() { const { S, F } = this.axes; return F / (2 * this.depth * S); }

  // Sguardo nelle coordinate della scrittura: s lungo le lettere, f in avanti (0 = indietro).
  local(g) {
    const { left, top, height: H } = this.rect;
    return this.horizontal ? { s: g.x - left, f: H - (g.y - top) } : { s: g.y - top, f: g.x - left };
  }

  // Rettangolo [x, y, larghezza, altezza]: da a a b lungo le lettere, profondità d dal bordo
  // da cui arrivano (alto in orizzontale, destra in verticale).
  screenRect(a, b, d) {
    const { width: W } = this.rect;
    return this.horizontal ? [a, 0, b - a, d] : [W - d, a, d, b - a];
  }

  step(t) {
    const dt = this.lastT === null ? 0 : Math.min((t - this.lastT) / 1000, 0.1);
    this.lastT = t;
    const g = this.getGaze();
    if (!g || this.isPaused() || dt === 0) return;
    const { S, F } = this.axes;
    const { s, f } = this.local(g);
    let forward = (f - F / 2) / (F / 2);
    const across = (s - S / 2) / S;
    if (Math.abs(forward) < DEAD_ZONE && Math.abs(across) < DEAD_ZONE) return;
    forward = Math.max(-1, Math.min(1, forward));
    const { anchor, centerRate, edgeBoost } = this.motion;

    // Punto del nodo radice sotto lo sguardo.
    const target = this.center + across / this.scale;
    if (forward > 0) {
      // Avanti: si ingrandisce attorno a un punto tra la croce e lo sguardo, così il riquadro
      // guardato cresce verso il centro invece di uscire dal bordo.
      const z = Math.exp(ZOOM_RATE * this.speed * forward * dt);
      const pivot = this.center + anchor * (target - this.center);
      this.center = pivot - (pivot - this.center) / z;
      this.scale *= z;
    } else {
      // Indietro: si rimpicciolisce attorno alla croce.
      this.scale *= Math.exp(ZOOM_RATE * 0.7 * this.speed * forward * dt);
    }
    // Il punto guardato scivola verso la croce, più in fretta se è vicino al bordo.
    const rate = centerRate * (1 + edgeBoost * Math.min(1, Math.abs(across) * 2)) * this.speed;
    this.center += (target - this.center) * Math.min(1, rate * dt);
    this.center = Math.max(0, Math.min(1, this.center));

    // Entrata in una lettera: quando il suo riquadro supera la croce, la lettera è scritta.
    const kids = this.model.children(this.root);
    const k = kids.find((c) => this.center >= c.start && this.center < c.end) ?? kids.at(-1);
    const size = (k.end - k.start) * this.scale * S;
    if (size * this.depth > F / 2) {
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

    // Uscita dalla radice all'indietro: si torna al testo precedente (cancella una lettera).
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

  // Dove si trova sullo schermo (lungo le lettere, in pixel) il simbolo sym tra i figli della
  // radice: [inizio, fine]. Serve al simulatore.
  symbolSpan(sym) {
    const { S } = this.axes;
    const k = this.model.children(this.root).find((c) => c.sym === sym);
    if (!k) return null;
    const at = (v) => (v - this.center) * this.scale * S + S / 2;
    return [at(k.start), at(k.end)];
  }

  draw() {
    const ctx = this.canvas.getContext("2d");
    const { width: W, height: H } = this.rect;
    const { S, F } = this.axes;
    ctx.fillStyle = this.palette.bg;
    ctx.fillRect(0, 0, W, H);
    const a0 = (0 - this.center) * this.scale * S + S / 2;
    const a1 = (1 - this.center) * this.scale * S + S / 2;
    // Riquadro del testo già scritto: contiene le lettere successive (niente vuoti neri).
    ctx.fillStyle = this.palette.root;
    ctx.fillRect(...this.screenRect(Math.max(0, a0), Math.min(S, a1), Math.min(F, (a1 - a0) * this.depth)));
    this.drawNode(ctx, this.root, a0, a1, 0);

    // Croce: guardare dalla parte da cui arrivano le lettere avanza, dall'altra torna indietro.
    ctx.strokeStyle = this.palette.cross;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 18, H / 2); ctx.lineTo(W / 2 + 18, H / 2);
    ctx.moveTo(W / 2, H / 2 - 18); ctx.lineTo(W / 2, H / 2 + 18);
    ctx.stroke();
  }

  drawNode(ctx, text, a0, a1, level) {
    const { S, F } = this.axes;
    for (const [i, c] of this.model.children(text).entries()) {
      const a = a0 + c.start * (a1 - a0);
      const b = a0 + c.end * (a1 - a0);
      if (b < 0 || a > S || b - a < 1.5) continue;
      const size = b - a;
      const d = Math.min(F, size * this.depth);
      const rect = this.screenRect(a, b, d);
      ctx.fillStyle = boxColor(this.palette, c.sym, i, level);
      ctx.fillRect(...rect);
      ctx.strokeStyle = this.palette.line;
      ctx.strokeRect(...rect);
      if (size > 14 && d > 14) {
        const font = Math.max(12, Math.min(56, size * 0.45, d * 0.7));
        ctx.fillStyle = c.sym === SPEAK ? this.palette.speakText : this.palette.text;
        ctx.font = `600 ${font}px system-ui, sans-serif`;
        const label = labelFor(c.sym);
        // La scritta sta sul lato rivolto verso la croce, al centro della parte visibile.
        const mid = Math.max(font / 2, Math.min(S - font / 2, (Math.max(a, 0) + Math.min(b, S)) / 2));
        if (this.horizontal) {
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(label, mid, d - 6);
        } else {
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(label, this.rect.width - d + 8, mid);
        }
      }
      if (level < MAX_DEPTH && size > 40 && c.sym !== SPEAK) {
        this.drawNode(ctx, applySymbol(text, c.sym), a, b, level + 1);
      }
    }
  }
}

function applySymbol(text, sym) {
  if (sym === "." || sym === "?") return text.trimEnd() + sym + " ";
  return text + sym;
}

function boxColor(palette, sym, i, depth) {
  if (sym === SPACE) return palette.space[depth % 2];
  if (sym === SPEAK) return palette.speak;
  return (depth % 2 ? palette.odd : palette.even)[i % 2];
}
