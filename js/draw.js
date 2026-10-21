// Scrittura a mano: il puntatore (testa, occhi o entrambi) disegna le lettere una alla volta.
//
// Un puntatore non ha "pulsante": la penna si alza e si abbassa con un battito di ciglia lungo
// (circa mezzo secondo, più di uno spontaneo e meno dei 2 secondi che aprono il menu).
// - penna alzata: il puntatore si muove senza lasciare traccia;
// - penna abbassata: ogni fotogramma aggiunge un punto al tratto;
// - penna alzata per `gapMs` dopo l'ultimo tratto: la lettera è finita e si riconosce.
// Se il puntatore esce dall'area di disegno (per esempio sulle celle accanto) la penna si alza.
// Con il mouse (?mouse nell'indirizzo) o il dito: tenere premuto abbassa la penna.

const STILL_LIFT_MS = 3000;  // penna abbassata e ferma da tanto: si alza da sola
const STILL_PX = 8;          // "ferma" = si muove meno di così
const MIN_POINT_GAP_PX = 2;  // punti più vicini di così non aggiungono nulla
const MIN_INK_FRACTION = 0.08; // un segno più piccolo di così (rispetto al lato corto) è rumore
const FLASH_MS = 1000;

const PALETTES = {
  dark: { bg: "#0f1115", ink: "#4fc3f7", penUp: "#ffb300", text: "#9aa3b2", frame: "#262b36", flash: "#f2f4f8" },
  light: { bg: "#ffffff", ink: "#0277bd", penUp: "#b26a00", text: "#566070", frame: "#d4dae4", flash: "#11151c" },
};

export class DrawPad {
  // getGaze(): {x, y} in pixel della finestra o null; isPaused(): occhi chiusi.
  // onLetter(strokes): tratti [[x, y], ...] relativi all'area di disegno, quando la lettera è finita.
  // onPen(down): la penna è cambiata (per il colore del puntatore).
  constructor(canvas, { getGaze, isPaused, onLetter, onPen }) {
    this.canvas = canvas;
    Object.assign(this, { getGaze, isPaused, onLetter, onPen });
    this.gapMs = 2500;
    this.palette = PALETTES.dark;
    this.pointerHint = "chiudi gli occhi mezzo secondo";
    this.running = false;
    this.clear();
    // Mouse o dito sull'area: tenere premuto = penna abbassata. In modalità occhi/testa non serve
    // ma non disturba: chi assiste può disegnare al posto della persona.
    canvas.addEventListener("pointerdown", (e) => { if (this.pointerPens) { canvas.setPointerCapture?.(e.pointerId); this.setPen(true); } });
    canvas.addEventListener("pointerup", () => { if (this.pointerPens) this.setPen(false); });
  }

  set light(on) { this.palette = on ? PALETTES.light : PALETTES.dark; }

  clear() {
    this.strokes = [];   // tratti finiti e in corso, in coordinate dell'area
    this.pen = false;
    this.penUpAt = 0;
    this.lastMoveAt = 0;
    this.flashUntil = 0;
    this.flashChar = "";
    this.cursor = null;
  }

  start() {
    this.resize();
    this.clear();
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
      this.step(t);
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    this.setPen(false);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio || 1;
    this.rect = r;
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Il battito lungo alterna penna alzata e abbassata.
  togglePen() { this.setPen(!this.pen); }

  setPen(down) {
    if (down === this.pen) return;
    this.pen = down;
    const now = performance.now();
    this.penUpAt = now;
    this.lastMoveAt = now;
    if (down) {
      const c = this.cursor;
      this.strokes.push(c ? [[c.x, c.y]] : []);
    } else if (this.strokes.at(-1)?.length < 2) {
      this.strokes.pop(); // tratto fatto di un solo punto
    }
    this.onPen?.(down);
  }

  step(t) {
    const g = this.getGaze();
    const r = this.rect;
    const inside = g && g.x >= r.left && g.x <= r.right && g.y >= r.top && g.y <= r.bottom;
    this.cursor = inside ? { x: g.x - r.left, y: g.y - r.top } : null;
    if (!inside && this.pen) this.setPen(false);

    if (this.pen && this.cursor && !this.isPaused()) {
      const stroke = this.strokes.at(-1);
      const last = stroke.at(-1);
      if (!last || Math.hypot(this.cursor.x - last[0], this.cursor.y - last[1]) >= MIN_POINT_GAP_PX) stroke.push([this.cursor.x, this.cursor.y]);
      if (!last || Math.hypot(this.cursor.x - last[0], this.cursor.y - last[1]) > STILL_PX) this.lastMoveAt = t;
      else if (t - this.lastMoveAt > STILL_LIFT_MS) this.setPen(false);
    }

    if (!this.pen && this.strokes.length && t - this.penUpAt >= this.gapMs) this.finish();
  }

  // Lettera finita: si consegnano i tratti, se non sono solo rumore, e si pulisce l'area.
  finish() {
    const strokes = this.strokes.filter((s) => s.length > 1);
    this.strokes = [];
    const pts = strokes.flat();
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (size < Math.min(this.rect.width, this.rect.height) * MIN_INK_FRACTION) return this.onLetter(null);
    this.onLetter(strokes);
  }

  // Mostra per un momento la lettera riconosciuta.
  flash(ch) {
    this.flashChar = ch;
    this.flashUntil = performance.now() + FLASH_MS;
  }

  draw() {
    const ctx = this.canvas.getContext("2d");
    const { width: W, height: H } = this.rect;
    const p = this.palette;
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, W, H);

    const now = performance.now();
    if (now < this.flashUntil) {
      ctx.globalAlpha = Math.min(0.35, ((this.flashUntil - now) / FLASH_MS) * 0.5);
      ctx.fillStyle = p.flash;
      ctx.font = `700 ${Math.min(H * 0.8, W * 0.8)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.flashChar, W / 2, H / 2);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = p.ink;
    ctx.lineWidth = Math.max(6, Math.min(W, H) * 0.02);
    ctx.lineCap = ctx.lineJoin = "round";
    for (const s of this.strokes) {
      if (s.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(s[0][0], s[0][1]);
      for (const q of s.slice(1)) ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }

    // Stato della penna e, a penna alzata con un segno da finire, il tempo che manca.
    ctx.font = `${Math.max(14, Math.min(22, W / 40))}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = this.pen ? p.ink : p.penUp;
    const how = this.pointerPens ? "tieni premuto" : this.pointerHint;
    ctx.fillText(this.pen ? `✎ penna abbassata: disegna (${how} per alzarla)` : `✎ penna alzata: ${how} per scrivere`, 16, 14);
    if (!this.pen && this.strokes.length) {
      const left = Math.max(0, 1 - (now - this.penUpAt) / this.gapMs);
      ctx.fillStyle = p.frame;
      ctx.fillRect(16, 46, W - 32, 6);
      ctx.fillStyle = p.penUp;
      ctx.fillRect(16, 46, (W - 32) * left, 6);
    }
  }
}
