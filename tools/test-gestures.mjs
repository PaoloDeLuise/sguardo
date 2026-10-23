// Prove dei gesti della penna (occhiolino, bocca aperta) con fotogrammi simulati:
//   node tools/test-gestures.mjs
// Controlla soglie, isteresi, tempo di tenuta, scatto una sola volta, sensibilità e fotogrammi
// minimi. Non dice nulla sui valori reali di una faccia: per quelli c'è la barra di livello
// nell'area di disegno, con cui tarare la sensibilità sul proprio dispositivo.
import assert from "node:assert/strict";
import { GESTURE_MODES, GestureDetector } from "../js/gestures.js";

const FRAME = 33;

// Fotogrammi con i valori dati per `ms` millisecondi (a `frame` ms uno dall'altro); restituisce
// quante volte il gesto è scattato.
function run(det, values, ms, frame = FRAME) {
  let fired = 0;
  const t0 = det.clock ?? 0;
  let t = t0;
  for (; t < t0 + ms; t += frame) {
    if (det.update({ face: true, t, eyes: [0, 0], jaw: 0, ...values })) fired++;
  }
  det.clock = t;
  return fired;
}
const make = (mode, sensitivity = 1) => Object.assign(new GestureDetector(), { mode, sensitivity });

assert.deepEqual(GESTURE_MODES, ["wink", "mouth"]);

// Bocca aperta: sotto soglia niente, sopra scatta una sola volta dopo il tempo di tenuta.
let d = make("mouth");
assert.equal(run(d, { jaw: 0.2 }, 1000), 0, "bocca socchiusa: niente");
assert.ok(d.level > 0.5 && d.level < 1, "il livello cresce con l'apertura");
assert.equal(run(d, { jaw: 0.5 }, 100), 0, "troppo breve: non scatta");
assert.equal(run(d, { jaw: 0.5 }, 1500), 1, "tenuta: scatta una volta sola");
assert.equal(run(d, { jaw: 0.0 }, 500), 0);
assert.equal(run(d, { jaw: 0.5 }, 600), 1, "rilasciata e ripetuta: scatta ancora");

// Isteresi: appena sotto la soglia ma sopra il rilascio, il gesto resta attivo e non scatta di nuovo.
d = make("mouth");
assert.equal(run(d, { jaw: 0.5 }, 600), 1);
assert.equal(run(d, { jaw: 0.3 }, 600), 0, "tra rilascio e soglia: ancora lo stesso gesto");
assert.equal(d.active, true);
assert.equal(run(d, { jaw: 0.1 }, 300), 0);
assert.equal(d.active, false, "sotto il rilascio il gesto finisce");

// Sensibilità: con soglia più bassa scatta con un'apertura che prima non bastava.
d = make("mouth", 1);
assert.equal(run(d, { jaw: 0.25 }, 800), 0);
d = make("mouth", 1.6);
assert.equal(run(d, { jaw: 0.25 }, 800), 1, "gesto più facile");

// Occhiolino: un occhio chiuso scatta (destro o sinistro), tutti e due chiusi (battito) no.
d = make("wink");
assert.equal(run(d, { eyes: [0.9, 0.1] }, 600), 1, "occhio sinistro");
run(d, {}, 400);
assert.equal(run(d, { eyes: [0.05, 0.85] }, 600), 1, "occhio destro");
run(d, {}, 400);
assert.equal(run(d, { eyes: [0.9, 0.9] }, 1000), 0, "battito con due occhi: non è un occhiolino");
assert.equal(run(d, { eyes: [0.9, 0.5] }, 600), 0, "se anche l'altro è chiuso a metà non conta");
d = make("wink");
assert.equal(run(d, { eyes: [0.9, 0.1] }, 80), 0, "un guizzo di pochi fotogrammi non conta");

// Telefono, pochi fotogrammi al secondo: a 8 fps un solo fotogramma sopra soglia dura più di
// 150 ms ma non basta (rumore); due o tre fotogrammi di fila scattano.
d = make("wink");
assert.equal(run(d, { eyes: [0.9, 0.1] }, 125, 125), 0, "un fotogramma isolato a 8 fps non scatta");
run(d, {}, 400, 125);
assert.equal(run(d, { eyes: [0.9, 0.1] }, 600, 125), 1, "cinque fotogrammi di fila scattano");
d = make("wink");
let flicker = 0;
for (let i = 0; i < 12; i++) flicker += run(d, i % 2 ? {} : { eyes: [0.9, 0.1] }, 125, 125); // sì-no-sì-no
assert.equal(flicker, 0, "un segnale che salta non scatta");

// Un gesto lento trascina il puntatore prima di superare la soglia: i punti vanno tolti da quando
// il gesto è cominciato, non solo dagli ultimi istanti (apertura lenta della bocca).
d = make("mouth");
run(d, { jaw: 0 }, 500);
let firedAt = null, startedAt = null;
const base = d.clock;
for (let t = base; t < base + 3000; t += FRAME) {
  const jaw = Math.min(0.5, ((t - base) / 1000) * 0.4); // 0,4 al secondo
  if (startedAt === null && jaw >= 0.2) startedAt = t; // poco oltre metà della soglia
  if (d.update({ face: true, t, eyes: [0, 0], jaw }) && firedAt === null) firedAt = t;
}
assert.ok(firedAt !== null, "l'apertura lenta scatta");
const back = d.backMsAt(firedAt);
assert.ok(back > make("mouth").backMs, "si taglia più indietro del minimo");
assert.ok(back >= firedAt - startedAt, "fino a quando il gesto è cominciato");
assert.ok(back <= 800, "ma mai oltre il limite");
// Un gesto rapido taglia il minimo.
d = make("mouth");
run(d, { jaw: 0 }, 300);
let quick = null;
for (let t = d.clock, end = t + 600; t < end; t += FRAME) if (d.update({ face: true, t, eyes: [0, 0], jaw: 0.6 })) quick = t;
assert.ok(d.backMsAt(quick) < 450, "gesto rapido: poco da tagliare");

// Senza volto nessun gesto, e il livello è zero.
d = make("mouth");
assert.equal(d.update({ face: false, t: 0 }), false);
assert.equal(d.level, 0);

console.log("ok");
