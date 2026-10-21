// Prove della penna (stare fermi alza e abbassa) con un puntatore simulato:
//   node tools/test-draw-pen.mjs
// Niente fotocamera né pagina: un finto canvas e un puntatore che si muove a comando.
import assert from "node:assert/strict";
import { DrawPad } from "../js/draw.js";

const canvas = {
  addEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
  getContext: () => ({ setTransform() {} }),
};
let gaze = null;
const finished = [];
const pad = new DrawPad(canvas, { getGaze: () => gaze, isPaused: () => false, onDrawing: (s) => finished.push(s), onPen: () => {} });
pad.rect = canvas.getBoundingClientRect();
pad.gapMs = 2000;
pad.stillMs = 700;

let t = 1000;
const FRAME = 33;
// Sta fermo (con un piccolo tremolio) per ms millisecondi.
function rest(x, y, ms) {
  for (let end = t + ms; t < end; t += FRAME) {
    gaze = { x: x + Math.sin(t / 50) * 3, y: y + Math.cos(t / 70) * 3 };
    pad.step(t);
  }
}
// Si muove in linea retta verso (x, y) in ms millisecondi.
function move(x, y, ms) {
  const from = gaze ?? { x, y };
  const n = Math.max(1, Math.round(ms / FRAME));
  for (let i = 1; i <= n; i++, t += FRAME) {
    gaze = { x: from.x + ((x - from.x) * i) / n, y: from.y + ((y - from.y) * i) / n };
    pad.step(t);
  }
}

// 1) Ferma 0,7 s: la penna si abbassa lì dove il puntatore sta fermo.
rest(200, 100, 900);
assert.equal(pad.pen, true, "fermo abbastanza: penna abbassata");
const start = pad.strokes.at(-1)[0];
assert.ok(Math.hypot(start[0] - 200, start[1] - 100) < 6, "il tratto parte da dove il puntatore era fermo");

// 2) Appena abbassata, restare fermi non la rialza subito: serve un movimento.
rest(200, 100, 1500);
assert.equal(pad.pen, true, "senza muoversi la penna non cambia ancora");

// 3) Movimento (una "L") e poi fermo: la penna si alza; il tratto contiene il movimento.
move(200, 400, 600);
move(500, 400, 600);
assert.equal(pad.pen, true, "durante il movimento la penna resta giù");
rest(500, 400, 900);
assert.equal(pad.pen, false, "fermo alla fine del tratto: penna alzata");
assert.ok(pad.strokes[0].length > 20, "il tratto ha registrato il movimento");

// 4) A penna alzata, restare fermi finisce il disegno e NON riabbassa la penna.
rest(500, 400, 2600);
assert.equal(pad.pen, false, "restare fermi a penna alzata non scrive");
assert.equal(finished.length, 1, "passata la pausa il disegno è consegnato");
assert.equal(finished[0].length, 1, "un solo tratto");

// 5) Due tratti: si raggiunge l'inizio del secondo con la penna alzata (niente segno nel mezzo).
move(100, 100, 300); rest(100, 100, 900);   // abbassa
move(300, 100, 400); rest(300, 100, 900);   // alza
move(200, 300, 400); rest(200, 300, 900);   // sposta e abbassa
move(200, 500, 400); rest(200, 500, 900);   // alza
rest(200, 500, 2600);
assert.equal(finished.length, 2);
assert.equal(finished[1].length, 2, "due tratti");
const bridge = finished[1].some((s) => s.some(([x, y]) => x > 120 && x < 280 && y > 150 && y < 280 && Math.abs(x - 200) > 40));
assert.ok(!bridge, "il trasferimento tra i due tratti non lascia segno");

// 6) Fuori dall'area la penna si alza.
rest(200, 100, 900);
assert.equal(pad.pen, true);
move(900, 100, 200);
assert.equal(pad.pen, false, "uscendo dall'area la penna si alza");

console.log("ok");
