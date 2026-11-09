// Sagoma del viso al momento della calibrazione: chi assiste vede dove stava la persona e la
// riporta lì (spesso basta questo, senza ricalibrare). Solo disegno su canvas, nessun calcolo pesante.
//
// Il contorno è in coordinate normalizzate del video (0–1), lo stesso spazio di MediaPipe:
// vale finché fotocamera e dispositivo restano gli stessi (l'archivio è già per dispositivo e
// orientamento).

// Indici della mesh a 478 punti, in ordine lungo ciascun contorno.
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const EYE_A = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const EYE_B = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
const NOSE = [1];
const PARTS = [OVAL, EYE_A, EYE_B, NOSE];
const POINTS = PARTS.flat();

// Indicazioni: scarto del centro oltre il 12% della larghezza del viso, dimensione oltre il 10%.
const SHIFT_TOL = 0.12;
const SCALE_TOL = 0.1;

const round3 = (v) => Math.round(v * 1000) / 1000;

// lm: punti di MediaPipe (x, y normalizzati). Restituisce [x0, y0, x1, y1, ...].
export function outlineOf(lm) {
  const out = new Array(POINTS.length * 2);
  POINTS.forEach((i, k) => {
    out[2 * k] = round3(lm[i].x);
    out[2 * k + 1] = round3(lm[i].y);
  });
  return out;
}

// Accumula i contorni dei fotogrammi di una calibrazione e ne restituisce la media.
export class OutlineAverage {
  constructor() { this.sum = null; this.n = 0; }
  add(o) {
    if (!o) return;
    this.sum ??= new Array(o.length).fill(0);
    for (let i = 0; i < o.length; i++) this.sum[i] += o[i];
    this.n++;
  }
  get value() { return this.n ? this.sum.map((v) => round3(v / this.n)) : null; }
}

// Centro e larghezza dell'ovale del viso (coordinate normalizzate, larghezza in pixel del video
// divisa per la larghezza del video: il formato non conta perché si confrontano due contorni
// presi dalla stessa fotocamera).
function frame(o) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < OVAL.length; k++) {
    const x = o[2 * k], y = o[2 * k + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

// Cosa fare per tornare nella sagoma, visto nell'anteprima a specchio (come chi siede davanti
// allo schermo vede sé stesso): "left" vuol dire spostarsi verso il lato sinistro dello schermo.
// Restituisce chiavi: left, right, up, down, closer, farther.
export function outlineHints(ref, cur) {
  if (!ref || !cur) return [];
  const a = frame(ref), b = frame(cur);
  const hints = [];
  const scale = b.w / a.w;
  if (scale < 1 - SCALE_TOL) hints.push("closer");
  else if (scale > 1 + SCALE_TOL) hints.push("farther");
  // Nell'immagine a specchio x cresce verso sinistra: se il viso è più a destra nel video
  // (x maggiore) appare più a sinistra e deve tornare verso destra.
  const dx = (b.cx - a.cx) / a.w;
  const dy = (b.cy - a.cy) / a.h;
  if (dx > SHIFT_TOL) hints.push("right");
  else if (dx < -SHIFT_TOL) hints.push("left");
  if (dy > SHIFT_TOL) hints.push("up");
  else if (dy < -SHIFT_TOL) hints.push("down");
  return hints;
}

// Disegna sagoma (tratteggiata) e viso attuale (pieno) su un canvas che copre il video.
// fit: "cover" (miniatura con object-fit: cover) o "contain". Il canvas va specchiato via CSS
// come il video. color: colore del viso attuale.
export function drawOutlines(canvas, videoW, videoH, ref, cur, color, fit = "cover") {
  const dpr = devicePixelRatio || 1;
  const bw = canvas.clientWidth, bh = canvas.clientHeight;
  if (!bw || !bh) return;
  if (canvas.width !== Math.round(bw * dpr) || canvas.height !== Math.round(bh * dpr)) {
    canvas.width = Math.round(bw * dpr);
    canvas.height = Math.round(bh * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, bw, bh);
  if (!videoW || !videoH) return;
  const s = fit === "cover" ? Math.max(bw / videoW, bh / videoH) : Math.min(bw / videoW, bh / videoH);
  const ox = (bw - videoW * s) / 2, oy = (bh - videoH * s) / 2;
  const X = (v) => ox + v * videoW * s;
  const Y = (v) => oy + v * videoH * s;
  const lineW = Math.max(1, Math.min(bw, bh) / 60);

  const trace = (o) => {
    ctx.beginPath();
    let k = 0;
    for (const part of PARTS) {
      if (part.length === 1) {
        ctx.moveTo(X(o[2 * k]) + lineW * 1.5, Y(o[2 * k + 1]));
        ctx.arc(X(o[2 * k]), Y(o[2 * k + 1]), lineW * 1.5, 0, Math.PI * 2);
      } else {
        ctx.moveTo(X(o[2 * k]), Y(o[2 * k + 1]));
        for (let j = 1; j < part.length; j++) ctx.lineTo(X(o[2 * (k + j)]), Y(o[2 * (k + j) + 1]));
        ctx.closePath();
      }
      k += part.length;
    }
    ctx.stroke();
  };

  ctx.lineJoin = "round";
  if (ref) {
    ctx.setLineDash([lineW * 3, lineW * 2.5]);
    ctx.lineWidth = lineW * 1.2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = lineW * 2;
    trace(ref);
  }
  if (cur) {
    ctx.setLineDash([]);
    ctx.lineWidth = lineW;
    ctx.strokeStyle = color;
    ctx.shadowBlur = 0;
    trace(cur);
  }
}
