// Prove della penna (stare fermi alza e abbassa) con un puntatore simulato:
//   node tools/test-draw-pen.mjs
// Niente fotocamera né pagina: un finto canvas e un puntatore che si muove a comando.
import assert from "node:assert/strict";
import { DrawPad } from "../js/draw.js";
import { eyeState } from "../js/features.js";

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
pad.penMode = "still";

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

// 7) Occhiolino: da fermo la penna non cambia più; togglePen la abbassa e la alza.
pad.penMode = "wink";
rest(300, 300, 1500);
assert.equal(pad.pen, false, "in modalità occhiolino stare fermi non abbassa la penna");
pad.startDelayMs = 800;
const strokesBefore = pad.strokes.length;
pad.togglePen(t);
assert.equal(pad.pen, false, "l'occhiolino non abbassa la penna all'istante");
assert.equal(pad.arming, true, "comincia la preparazione (puntatore fantasma)");
rest(300, 300, 400);
assert.equal(pad.pen, false, "a metà preparazione la penna è ancora su");
assert.equal(pad.strokes.length, strokesBefore, "e nessun segno");
// durante la preparazione ci si posiziona meglio: il tratto parte da dove si arriva, non dal punto dell'occhiolino
move(380, 340, 300);
rest(380, 340, 400);
assert.equal(pad.pen, true, "finita la preparazione la penna scende");
const first = pad.strokes.at(-1)[0];
assert.ok(Math.hypot(first[0] - 380, first[1] - 340) < 6, "il tratto parte dal puntatore dopo l'assestamento");
pad.togglePen(t);
assert.equal(pad.pen, false, "alzare la penna con l'occhiolino vale subito");

// Un secondo occhiolino durante la preparazione la annulla.
rest(300, 300, 300);
pad.togglePen(t);
rest(300, 300, 300);
pad.togglePen(t);
assert.equal(pad.arming, false, "il secondo occhiolino annulla la preparazione");
rest(300, 300, 1200);
assert.equal(pad.pen, false, "annullata: la penna non scende");

// Durante la preparazione il disegno già fatto non si chiude per la pausa.
pad.strokes = [[[0, 0], [50, 50]]];
pad.penUpAt = t;
const before = finished.length;
pad.togglePen(t);
rest(300, 300, 700);
assert.equal(finished.length, before, "la pausa tra i disegni non scatta mentre ci si prepara");
pad.togglePen(t);
pad.strokes = [];

// 8) Occhiolino o battito? Uno solo chiuso è occhiolino, anche con l'occhio molto chiuso.
assert.deepEqual(eyeState({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1 }), { wink: true, blink: false });
assert.deepEqual(eyeState({ eyeBlinkLeft: 1, eyeBlinkRight: 0.25 }), { wink: true, blink: false }, "la media supera 0,6 ma è un occhiolino");
assert.deepEqual(eyeState({ eyeBlinkLeft: 0.1, eyeBlinkRight: 0.8 }), { wink: true, blink: false }, "vale con entrambi gli occhi");
assert.deepEqual(eyeState({ eyeBlinkLeft: 0.8, eyeBlinkRight: 0.9 }), { wink: false, blink: true });
assert.deepEqual(eyeState({ eyeBlinkLeft: 0.2, eyeBlinkRight: 0.1 }), { wink: false, blink: false });
assert.deepEqual(eyeState({ eyeBlinkLeft: 0.5, eyeBlinkRight: 0.5 }), { wink: false, blink: false }, "a metà non è niente");

// 9) Cella "Penna": la preparazione parte da quando il puntatore rientra nell'area, non dalla scelta.
pad.penMode = "cell";
pad.strokes = [];
pad.pen = false;
pad.arming = false;
rest(900, 300, 300); // il puntatore è sulla cella, fuori dall'area
let waits = [];
pad.onWait = (w) => waits.push(w);
pad.requestPen();
assert.equal(pad.waiting, true, "scelta la cella la penna è pronta e aspetta");
rest(900, 300, 2000); // resta sulla cella a lungo: niente preparazione
assert.equal(pad.arming, false, "fuori dall'area la preparazione non parte");
assert.equal(pad.pen, false);
move(500, 300, 200); // rientra
assert.equal(pad.arming, true, "al rientro parte la preparazione");
assert.equal(pad.waiting, false);
rest(500, 300, 500);
assert.equal(pad.pen, false, "dopo 0,5 s la preparazione non è finita");
rest(500, 300, 500);
assert.equal(pad.pen, true, "finita la preparazione la penna scende");
move(900, 300, 200); // esce dall'area: si alza
assert.equal(pad.pen, false, "uscendo dall'area la penna si alza");
assert.deepEqual(waits, [true, false], "la cella viene avvisata (pronta, poi non più pronta)");

// Uscire durante la preparazione: si torna ad aspettare il rientro.
pad.requestPen();
move(500, 300, 200);
assert.equal(pad.arming, true);
move(900, 300, 200);
assert.equal(pad.arming, false);
assert.equal(pad.waiting, true, "uscita durante la preparazione: si riaspetta il rientro");
// Scegliere di nuovo la cella annulla.
pad.requestPen();
assert.equal(pad.waiting, false, "seconda scelta: annullata");

// 10) Alzare la penna con un gesto toglie dalla fine del tratto i punti disturbati dal gesto.
pad.penMode = "wink";
pad.strokes = [];
pad.pen = false;
pad.arming = false;
move(100, 100, 100);
pad.togglePen(t); // preparazione
rest(100, 100, 900); // penna giù
assert.equal(pad.pen, true);
move(400, 100, 600); // tratto regolare
const gestureAt = t;
for (let k = 0; k < 8; k++, t += FRAME) { gaze = { x: 400, y: 100 + k * 12 }; pad.step(t); } // il gesto sposta il puntatore
pad.togglePen(t, 270); // alza, togliendo gli ultimi 270 ms
const kept = pad.strokes.at(-1);
assert.equal(pad.pen, false);
assert.ok(kept.every(([, y]) => y < 130), "i punti spostati dal gesto non sono nel tratto");
assert.ok(kept.at(-1)[0] > 380, "il tratto regolare resta");
void gestureAt;

console.log("ok");
