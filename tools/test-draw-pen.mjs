// Prove della penna (gesto o cella per abbassarla, fermi per alzarla) con un puntatore simulato:
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
pad.penMode = "wink";

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

// 1) Occhiolino: stare fermi non abbassa la penna; togglePen avvia la preparazione e poi la abbassa.
rest(300, 300, 1500);
assert.equal(pad.pen, false, "stare fermi non abbassa la penna");
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

// 11) Uscire dall'area per la cella: il percorso di uscita non resta nel tratto. Si torna
// all'ultima pausa a fine tratto, così il tratto finisce dove la persona si è fermata.
pad.penMode = "cell";
pad.strokes = [];
pad.pen = false;
pad.arming = false;
pad.waiting = false;
move(100, 200, 100);
pad.requestPen();
move(120, 200, 100); // rientra
rest(120, 200, 900); // preparazione: la penna scende
assert.equal(pad.pen, true);
move(120, 400, 500);
move(400, 400, 500); // una "L"
rest(400, 400, 400); // pausa a fine tratto
move(780, 400, 250); // percorso veloce verso destra...
move(900, 400, 80); // ...fino a uscire dall'area
assert.equal(pad.pen, false, "uscendo la penna si alza");
const exited = pad.strokes.at(-1);
assert.ok(exited.every(([x]) => x < 440), "il percorso di uscita non è nel tratto");
assert.ok(exited.some(([x, y]) => x > 380 && y > 380), "ma la L fino alla pausa sì");

// Senza pausa non si sa dove finisce il tratto: si tolgono gli ultimi istanti.
pad.requestPen();
move(120, 200, 100);
rest(120, 200, 900);
assert.equal(pad.pen, true);
move(120, 400, 500);
move(600, 400, 500);
move(900, 400, 300); // esce senza fermarsi
assert.equal(pad.pen, false);
const cut = pad.strokes.at(-1);
assert.ok(cut.at(-1)[0] < 790, "gli ultimi istanti prima dell'uscita sono tolti");
assert.ok(cut.length > 10, "il resto del tratto resta");

// 12) Con i gesti e con la cella la penna si alza anche stando fermi (senza gesto): niente drift.
for (const mode of ["wink", "cell"]) {
  pad.penMode = mode;
  pad.strokes = [];
  pad.pen = false;
  pad.arming = false;
  pad.waiting = false;
  move(100, 200, 100);
  if (mode === "cell") { pad.requestPen(); move(120, 200, 100); } else pad.togglePen(t);
  rest(120, 200, 900); // preparazione: la penna scende
  assert.equal(pad.pen, true, `${mode}: penna giù`);
  rest(120, 200, 1500);
  assert.equal(pad.pen, true, `${mode}: appena abbassata, restare fermi non la alza (prima ci si muove)`);
  move(120, 400, 500);
  move(400, 400, 500); // una "L"
  assert.equal(pad.pen, true);
  rest(400, 400, 400); // pausa breve a metà: non basta
  assert.equal(pad.pen, true, `${mode}: una pausa breve non alza la penna`);
  move(500, 400, 200);
  rest(500, 400, 1200);
  assert.equal(pad.pen, false, `${mode}: fermi abbastanza a lungo la penna si alza`);
  const lifted = pad.strokes.at(-1);
  assert.ok(lifted.at(-1)[0] > 480 && lifted.at(-1)[0] < 520, `${mode}: il tratto finisce dove si è fermato`);
  assert.ok(lifted.filter(([x]) => x > 490).length < 12, `${mode}: il tremolio del riposo finale non riempie il tratto`);
  // ora si può andare a una cella senza lasciare segno
  const n = lifted.length;
  move(900, 400, 300);
  assert.equal(pad.strokes.at(-1).length, n, `${mode}: a penna alzata spostarsi non disegna`);
}

// 13) Passata la pausa tra i disegni, il disegno finito viene consegnato.
rest(900, 400, 2600);
assert.ok(finished.length > 0, "il disegno viene consegnato a penna alzata");

// 14) La penna non si abbassa da ferma in nessun modo: da fermi con la penna alzata non succede niente.
for (const mode of ["wink", "mouth", "cell"]) {
  pad.penMode = mode;
  pad.strokes = [];
  pad.pen = false;
  pad.arming = false;
  pad.waiting = false;
  rest(300, 300, 2000);
  assert.equal(pad.pen, false, `${mode}: stare fermi a penna alzata non scrive`);
}

console.log("ok");
