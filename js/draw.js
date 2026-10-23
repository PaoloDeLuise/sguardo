// Scrittura a mano: il puntatore (testa, occhi o entrambi) disegna una lettera o una parola.
//
// Un puntatore non ha "pulsante": la penna si abbassa in uno di tre modi (penMode):
// - "wink" e "mouth": un gesto (occhiolino, bocca aperta: gestures.js; main.js chiama togglePen);
// - "cell": una cella "Penna" accanto al disegno (requestPen). La preparazione parte da quando il
//   puntatore rientra nell'area di disegno, non da quando si è scelta la cella; se si esce
//   durante la preparazione si torna ad aspettare il rientro.
// Abbassare la penna non è istantaneo: c'è una preparazione di `startDelayMs` in cui un puntatore
// "fantasma" mostra dove partirà il tratto, e ci si può posizionare; la penna scende alla fine,
// dove si trova il puntatore. Un altro gesto durante la preparazione annulla.
//
// Una volta giù, la penna aggiunge un punto al tratto a ogni fotogramma e si alza così:
// - occhiolino: solo con l'occhiolino di nuovo (e uscendo dall'area, senza tagliare niente);
// - bocca aperta: solo riaprendo la bocca (e uscendo dall'area, senza tagliare niente). Aprire la
//   bocca muove la testa e quindi il puntatore, perciò si tolgono dal tratto i punti da quando il
//   gesto è cominciato;
// - cella: stando fermi per `stillMs` (un cerchio si riempie attorno al puntatore, tenendo conto
//   del tremolio), oppure uscendo dall'area verso la cella: si tolgono i punti del percorso di
//   uscita, tornando all'ultima pausa a fine tratto.
// Da fermi (solo con la cella) la penna si alza solo se prima ci si è mossi: appena abbassata,
// restare fermi non la rialza. A penna alzata il puntatore si muove senza lasciare traccia (per raggiungere il tratto
// dopo); passato `gapMs` dall'ultimo tratto il disegno è finito e si riconosce.
// Con il mouse (?mouse nell'indirizzo) o il dito: tenere premuto abbassa la penna.

import { t } from "./i18n.js";

const MIN_POINT_GAP_PX = 2;  // punti più vicini di così non aggiungono nulla
const FLASH_MS = 1000;
const PAUSE_MS = 150;        // una pausa a fine tratto: fermi (entro stillPx) per almeno così
const EXIT_LOOKBACK_MS = 1500; // quanto indietro si cerca la pausa prima dell'uscita
const EXIT_FALLBACK_MS = 300;  // senza pausa si tolgono comunque gli ultimi istanti
const STILL_KEEP_MS = 100;     // alzando la penna da fermo si tiene del riposo solo l'inizio: il resto è tremolio

const PALETTES = {
  dark: { bg: "#0f1115", ink: "#4fc3f7", penUp: "#ffb300", text: "#9aa3b2", frame: "#262b36", flash: "#f2f4f8" },
  light: { bg: "#ffffff", ink: "#0277bd", penUp: "#b26a00", text: "#566070", frame: "#d4dae4", flash: "#11151c" },
};

export class DrawPad {
  // getGaze(): {x, y} in pixel della finestra o null; isPaused(): occhi chiusi.
  // onDrawing(strokes): tratti [[x, y], ...] relativi all'area, quando il disegno è finito.
  // onPen(down): la penna è cambiata (per il colore del puntatore). onWait(waiting): la cella "Penna" è pronta o no.
  constructor(canvas, { getGaze, isPaused, onDrawing, onPen, onWait }) {
    this.canvas = canvas;
    Object.assign(this, { getGaze, isPaused, onDrawing, onPen, onWait });
    this.gapMs = 2000;
    this.stillMs = 700;
    this.startDelayMs = 800;
    this.level = null;   // livello del gesto scelto (1 = soglia), per la barra; null = nessun gesto
    this.levelLabel = "";
    this.penMode = "wink"; // wink | mouth | cell
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
    this.arming = false; // preparazione dell'abbassamento (gesto o cella): ancora nessun segno
    this.waiting = false; // modo "cell": scelta la cella, si aspetta il rientro nell'area
    this.armedAt = 0;
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

  // Cella "Penna": a penna alzata si aspetta il rientro nell'area (poi la preparazione), oppure si annulla.
  requestPen() {
    if (this.pen) return;
    this.waiting = !this.waiting && !this.arming;
    this.arming = false;
    this.progress = 0;
    this.onWait?.(this.waiting);
  }

  // Gesto: alza la penna subito (togliendo da fine tratto gli ultimi backMs, disturbati dal gesto);
  // a penna alzata comincia (o annulla) la preparazione.
  togglePen(t = performance.now(), backMs = 0) {
    if (this.pen) return this.setPen(false, t, backMs);
    if (this.arming) {
      this.arming = false;
      this.progress = 0;
      this.penUpAt = t;
    } else if (this.cursor) {
      this.arming = true;
      this.armedAt = t;
      this.progress = 0;
    }
  }

  // Tratto senza il percorso di uscita: si torna all'ultima pausa (puntatore quasi fermo) degli
  // ultimi secondi; se non c'è, si tolgono solo gli ultimi istanti.
  trimExit(stroke, t) {
    const lastStillPoint = (end) => {
      let s = end;
      while (s > 0 && stroke[end][2] - stroke[s - 1][2] <= PAUSE_MS) s--;
      if (stroke[end][2] - stroke[s][2] < PAUSE_MS * 0.8) return false; // finestra troppo corta
      return stroke.slice(s, end + 1).every((q) => Math.hypot(q[0] - stroke[end][0], q[1] - stroke[end][1]) <= this.stillPx);
    };
    // Una pausa vale se prima c'è già un tratto: la quiete subito dopo l'abbassamento della penna
    // non è la fine del disegno (se no uscire senza pausa taglierebbe tutto).
    const drawn = (end) => {
      let d = 0;
      for (let i = 1; i <= end; i++) d += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
      return d;
    };
    for (let e = stroke.length - 1; e >= 1 && stroke.at(-1)[2] - stroke[e][2] <= EXIT_LOOKBACK_MS; e--) {
      if (lastStillPoint(e) && drawn(e) > this.stillPx * 3) {
        stroke.length = e + 1;
        return;
      }
    }
    while (stroke.length > 2 && stroke.at(-1)[2] > t - EXIT_FALLBACK_MS) stroke.pop();
  }

  setPen(down, t = performance.now(), backMs = 0, exit = false) {
    if (down === this.pen) return;
    this.pen = down;
    this.penUpAt = t;
    if (!this.arming) this.progress = 0;
    if (down) {
      const c = this.cursor;
      this.strokes.push(c ? [[c.x, c.y, t]] : []);
      // Per alzarla da ferma si deve prima muovere: appena abbassata il puntatore è ancora lì.
      this.anchor = c ? { x: c.x, y: c.y } : null;
      this.stillSince = t;
      this.armed = false;
    } else {
      const stroke = this.strokes.at(-1);
      if (exit && stroke.length > 2) this.trimExit(stroke, t);
      while (backMs && stroke.length > 2 && stroke.at(-1)[2] > t - backMs) stroke.pop();
    }
    if (!down && this.strokes.at(-1)?.length < 2) {
      this.strokes.pop(); // tratto fatto di un solo punto
    }
    this.onPen?.(down);
  }

  step(t) {
    const g = this.getGaze();
    const r = this.rect;
    const inside = g && g.x >= r.left && g.x <= r.right && g.y >= r.top && g.y <= r.bottom;
    this.cursor = inside ? { x: g.x - r.left, y: g.y - r.top } : null;
    // Uscendo dall'area la penna si alza; solo con la cella il percorso di uscita si toglie dal tratto.
    if (!inside && this.pen) this.setPen(false, t, 0, this.penMode === "cell");
    if (!inside && this.arming) {
      this.arming = false;
      this.penUpAt = t;
      if (this.penMode === "cell") { this.waiting = true; this.onWait?.(true); } // si ricomincia al rientro
    }
    if (inside && this.waiting) {
      // Rientrati nell'area: la preparazione parte adesso, per avere il tempo di posizionarsi.
      this.waiting = false;
      this.arming = true;
      this.armedAt = t;
      this.progress = 0;
      this.onWait?.(false);
    }

    const c = this.cursor;
    if (!c || this.isPaused()) {
      this.progress = 0;
      this.anchor = null;
    } else {
      if (this.pen) {
        const stroke = this.strokes.at(-1);
        const last = stroke.at(-1);
        if (!last || Math.hypot(c.x - last[0], c.y - last[1]) >= MIN_POINT_GAP_PX) stroke.push([c.x, c.y, t]);
      }
      // Con i gesti la penna si alza solo col gesto: l'alzata da fermi c'è solo con la cella.
      if (!this.pointerPens && this.pen && this.penMode === "cell") this.watchStill(c, t);
      if (this.arming) {
        this.progress = (t - this.armedAt) / this.startDelayMs;
        if (this.progress >= 1) {
          this.arming = false;
          this.progress = 0;
          this.setPen(true, t); // parte dal puntatore com'è adesso, non da com'era all'occhiolino
        }
      }
    }

    // Durante la preparazione il disegno non si chiude: si sta per aggiungere un tratto.
    if (!this.pen && !this.arming && this.strokes.length && t - this.penUpAt >= this.gapMs) this.finish();
  }

  // Fermo abbastanza a lungo (tenendo conto del tremolio): la penna si alza.
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
      this.setPen(false, t, Math.max(0, t - this.stillSince - STILL_KEEP_MS));
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

    // Preparazione: puntatore fantasma (dove partirà il tratto) con un cerchio che si riempie.
    if (this.arming && this.cursor) {
      const { x, y } = this.cursor;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(5, Math.min(W, H) * 0.014) / 2 + 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 22, y); ctx.lineTo(x + 22, y);
      ctx.moveTo(x, y - 22); ctx.lineTo(x, y + 22);
      ctx.stroke();
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(x, y, 30, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, this.progress));
      ctx.stroke();
    }

    // Cerchio che si riempie attorno al puntatore mentre sta fermo.
    if (!this.arming && this.cursor && this.progress > 0.12) {
      ctx.strokeStyle = this.pen ? p.penUp : p.ink;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(this.cursor.x, this.cursor.y, 30, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, this.progress));
      ctx.stroke();
    }

    // Rientro atteso: bordo tratteggiato attorno all'area.
    if (this.waiting) {
      ctx.strokeStyle = p.penUp;
      ctx.lineWidth = 4;
      ctx.setLineDash([14, 10]);
      ctx.strokeRect(3, 3, W - 6, H - 6);
      ctx.setLineDash([]);
    }

    // Barra di livello del gesto scelto: quanto lo si sta facendo rispetto alla soglia (il segno).
    if (this.level != null) {
      const w = Math.min(W * 0.5, 320), x = 16, y = H - 34, max = 1.5;
      ctx.fillStyle = p.frame;
      ctx.fillRect(x, y, w, 12);
      ctx.fillStyle = this.level >= 1 ? p.ink : p.text;
      ctx.fillRect(x, y, w * Math.min(1, this.level / max), 12);
      ctx.fillStyle = p.penUp;
      ctx.fillRect(x + w / max - 1, y - 5, 3, 22);
      ctx.font = "13px system-ui, sans-serif";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = p.text;
      ctx.fillText(t("pad.level", { label: this.levelLabel }), x, y - 8);
      ctx.textBaseline = "top";
    }

    // Stato della penna e, a penna alzata con un disegno da finire, il tempo che manca.
    ctx.font = `${Math.max(14, Math.min(22, W / 40))}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = this.pen ? p.ink : p.penUp;
    const gesture = this.penMode === "mouth" ? "Mouth" : "Wink";
    const how = this.pointerPens ? t("pad.howPointer") : this.penMode === "cell" ? t("pad.howCell") : t(`pad.how${gesture}`);
    const up = this.pointerPens ? t("pad.upPointer") : this.penMode === "cell" ? t("pad.upCell") : t(`pad.up${gesture}`);
    const cancel = this.penMode === "cell" ? t("pad.cancelCell") : t("pad.cancelGesture");
    ctx.fillText(this.waiting ? t("pad.waiting")
      : this.arming ? t("pad.arming", { cancel })
      : this.pen ? t("pad.down", { up }) : t("pad.idle", { how }), 16, 14);
    if (!this.pen && !this.arming && !this.waiting && this.strokes.length) {
      const left = Math.max(0, 1 - (now - this.penUpAt) / this.gapMs);
      ctx.fillStyle = p.frame;
      ctx.fillRect(16, 46, W - 32, 6);
      ctx.fillStyle = p.penUp;
      ctx.fillRect(16, 46, (W - 32) * left, 6);
    } else if (!this.strokes.length && !this.pen && !this.arming && !this.waiting) {
      ctx.fillStyle = p.text;
      ctx.fillText(t("pad.hint"), 16, 46);
    }
  }
}
