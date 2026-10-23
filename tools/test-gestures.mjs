// Prove dei gesti della penna (occhiolino, bocca aperta, inclinazione) con fotogrammi simulati:
//   node tools/test-gestures.mjs
// Controlla soglie, isteresi, tempo di tenuta, scatto una sola volta, sensibilità e posizione
// "dritta" della testa. Non dice nulla sui valori reali di una faccia: per quelli c'è la barra di
// livello nell'area di disegno, con cui tarare la sensibilità sul proprio dispositivo.
import assert from "node:assert/strict";
import { GESTURE_MODES, GestureDetector } from "../js/gestures.js";

const FRAME = 33;

// Fotogrammi con i valori dati per `ms` millisecondi; restituisce quante volte il gesto è scattato.
function run(det, values, ms, start = 0) {
  let fired = 0;
  const t0 = det.clock ?? start;
  let t = t0;
  for (; t < t0 + ms; t += FRAME) {
    if (det.update({ face: true, t, eyes: [0, 0], jaw: 0, roll: 0, ...values })) fired++;
  }
  det.clock = t;
  return fired;
}
const make = (mode, sensitivity = 1) => Object.assign(new GestureDetector(), { mode, sensitivity });

assert.deepEqual(GESTURE_MODES, ["wink", "mouth", "tilt"]);

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

// Inclinazione: dritta, inclina sopra soglia (da una parte o dall'altra), poi torna.
d = make("tilt");
assert.equal(run(d, { roll: 5 }, 1000), 0, "piccola inclinazione: niente");
assert.equal(run(d, { roll: 25 }, 1000), 1, "inclinata a destra: scatta");
run(d, { roll: 3 }, 800);
assert.equal(run(d, { roll: -22 }, 1000), 1, "inclinata a sinistra: scatta");

// La posizione "dritta" non è lo zero: chi tiene la testa già un po' inclinata non scatta di continuo,
// e segue lentamente (un cambio di postura non resta un gesto per sempre).
d = make("tilt");
assert.equal(run(d, { roll: 12 }, 500), 0, "parte già inclinato di 12°: quella è la sua posizione dritta");
assert.equal(run(d, { roll: 12 }, 5000), 0);
assert.equal(run(d, { roll: 12 + 25 }, 1000), 1, "ma 25° oltre la sua posizione scatta");
// Rotazione che attraversa ±180° (matrice con asse invertito): lo scarto si calcola correttamente.
d = make("tilt");
run(d, { roll: 178 }, 500);
assert.equal(run(d, { roll: -157 }, 1000), 1, "da 178° a -157° sono 25° di inclinazione, non 335°");

// Senza volto nessun gesto, e il livello è zero.
d = make("mouth");
assert.equal(d.update({ face: false, t: 0 }), false);
assert.equal(d.level, 0);

// Gli ultimi punti del tratto, disturbati dal gesto, si tolgono: backMs copre tenuta + un margine.
assert.ok(make("wink").backMs > 150 && make("mouth").backMs > 200 && make("tilt").backMs > 250);

console.log("ok");
