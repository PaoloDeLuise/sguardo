// Scrittura a mano: il puntatore (testa, occhi o entrambi) disegna una lettera o una parola.
//
// Un puntatore non ha "pulsante": la penna si abbassa e si alza stando fermi.
// - ferma per `stillMs` (un cerchio si riempie attorno al puntatore): la penna cambia stato.
//   Nel momento del cambio il puntatore è fermo, quindi il tratto parte esattamente da lì;
// - penna abbassata: ogni fotogramma aggiunge un punto al tratto;
// - penna alzata: il puntatore si muove senza lasciare traccia (per raggiungere il tratto dopo);
// - penna alzata per `gapMs` dopo l'ultimo tratto: il disegno è finito e si riconosce.
// Dopo ogni cambio bisogna muoversi prima di poter cambiare ancora: restare fermi a penna alzata
// per finire non abbassa di nuovo la penna. Se il puntatore esce dall'area la penna si alza.
// Con il mouse (?mouse nell'indirizzo) o il dito: tenere premuto abbassa la penna.

const MIN_POINT_GAP_PX = 2;  // punti più vicini di così non aggiungono nulla
const FLASH_MS = 1000;

const PALETTES = {
  dark: { bg: "#0f1115", ink: "#4fc3f7", penUp: "#ffb300", text: "#9aa3b2", frame: "#262b36", flash: "#f2f4f8" },
  light: { bg: "#ffffff", ink: "#0277bd", penUp: "#b26a00", text: "#566070", frame: "#d4dae4", flash: "#11151c" },
};

export class DrawPad {
  // getGaze(): {x, y} in pixel della finestra o null; isPaused(): occhi chiusi.
  // onDrawing(strokes): tratti [[x, y], ...] relativi all'area, quando il disegno è finito.
  // onPen(down): la penna è cambiata (per il colore del puntatore).
  constructor(canvas, { getGaze, isPaused, onDrawing, onPen }) {
    this.canvas = canvas;
    Object.assign(this, { getGaze, isPaused, onDrawing, onPen });
    this.gapMs = 2000;
    this.stillMs = 700;
    this.palette = PALETTES.dark;
    this.running = false;
    this.pointerPens = false;
    this.clear();
    // Mouse o dito sull'area: tenere premuto = penna abbassata (prove, o chi assiste disegna per la persona).
    canvas.addEventListener("pointerdown", (e) => { if (this.pointerPens) { canvas.setPointerCapture?.(e.pointerId); this.setPen(true); } });
    canvas.addEventListener("pointerup", () => { if (this.pointerPens) this.setPen(false); });
  }

  set light(on) { this.palette = on ? PALETTES.light : PALETTES.dark; }

  clear() {
    this.strokes = [];   // tratti finiti e in corso, in coordinate dell'area
    this.pen = false;
    this.penUpAt = 0;
    this.anchor = null;  // dove il puntatore ha cominciato a stare fermo
    this.stillSince = 0;
    this.armed = true;   // dopo un cambio di penna serve un movimento prima del successivo
    this.progress = 0;
    this.flashUntil = 0;
    this.flashText = "";
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

  // Quanto ci si può muovere restando "fermi": il puntatore trema, e di più con testa e occhi.
  get stillPx() {
    return Math.max(14, Math.min(this.rect.width, this.rect.height) * 0.025);
  }

  setPen(down, t = performance.now()) {
    if (down === this.pen) return;
    this.pen = down;
    this.penUpAt = t;
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
    if (!inside && this.pen) this.setPen(false, t);

    const c = this.cursor;
    if (!c || this.isPaused()) {
      this.progress = 0;
      this.anchor = null;
    } else {
      if (this.pen) {
        const stroke = this.strokes.at(-1);
        const last = stroke.at(-1);
        if (!last || Math.hypot(c.x - last[0], c.y - last[1]) >= MIN_POINT_GAP_PX) stroke.push([c.x, c.y]);
      }
      if (!this.pointerPens) this.watchStill(c, t);
    }

    if (!this.pen && this.strokes.length && t - this.penUpAt >= this.gapMs) this.finish();
  }

  // Fermo abbastanza a lungo: la penna cambia stato.
  watchStill(c, t) {
    if (!this.anchor || Math.hypot(c.x - this.anchor.x, c.y - this.anchor.y) > this.stillPx) {
      this.anchor = { x: c.x, y: c.y };
      this.stillSince = t;
      this.armed = true;
      this.progress = 0;
      return;
    }
    if (!this.armed) return;
    this.progress = (t - this.stillSince) / this.stillMs;
    if (this.progress >= 1) {
      this.armed = false;
      this.progress = 0;
      this.setPen(!this.pen, t);
    }
  }

  // Disegno finito: si consegnano i tratti e si pulisce l'area.
  finish() {
    const strokes = this.strokes.filter((s) => s.length > 1);
    this.strokes = [];
    if (strokes.length) this.onDrawing(strokes);
  }

  // Mostra per un momento ciò che è stato riconosciuto.
  flash(text) {
    this.flashText = text;
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
      const size = Math.min(H * 0.8, (W * 1.6) / Math.max(1, this.flashText.length));
      ctx.font = `700 ${size}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.flashText, W / 2, H / 2);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = p.ink;
    ctx.lineWidth = Math.max(5, Math.min(W, H) * 0.014);
    ctx.lineCap = ctx.lineJoin = "round";
    for (const s of this.strokes) {
      if (s.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(s[0][0], s[0][1]);
      for (const q of s.slice(1)) ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }

    // Cerchio che si riempie attorno al puntatore mentre sta fermo.
    if (this.cursor && this.progress > 0.12) {
      ctx.strokeStyle = this.pen ? p.penUp : p.ink;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(this.cursor.x, this.cursor.y, 30, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, this.progress));
      ctx.stroke();
    }

    // Stato della penna e, a penna alzata con un disegno da finire, il tempo che manca.
    ctx.font = `${Math.max(14, Math.min(22, W / 40))}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = this.pen ? p.ink : p.penUp;
    const how = this.pointerPens ? "tieni premuto" : "fermo un attimo";
    ctx.fillText(this.pen ? `✎ penna abbassata: disegna (${this.pointerPens ? "rilascia" : "fermo un attimo"} per alzarla)` : `✎ penna alzata: ${how} per scrivere`, 16, 14);
    if (!this.pen && this.strokes.length) {
      const left = Math.max(0, 1 - (now - this.penUpAt) / this.gapMs);
      ctx.fillStyle = p.frame;
      ctx.fillRect(16, 46, W - 32, 6);
      ctx.fillStyle = p.penUp;
      ctx.fillRect(16, 46, (W - 32) * left, 6);
    } else if (!this.strokes.length && !this.pen) {
      ctx.fillStyle = p.text;
      ctx.fillText("Una lettera, oppure una parola: lettere in fila da sinistra a destra.", 16, 46);
    }
  }
}
