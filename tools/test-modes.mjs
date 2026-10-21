// Prove delle modalità di controllo (occhi, testa, occhi + testa) con dati sintetici:
//   node tools/test-modes.mjs
// Controlla che le caratteristiche, l'archivio e la regressione funzionino per ogni modalità.
// Non misura la precisione con una testa vera (serve una calibrazione fatta muovendo la testa) e
// non dimostra la protezione di minStd (regression.js) contro la deriva della posizione della
// testa: quella si vede solo sui dati veri, con `node tools/evaluate.mjs --modes`.
import assert from "node:assert/strict";
import { CONTROL_MODES, STABILITY, CLEAN_INDICES, gazeFeatures } from "../js/features.js";
import { expand, fitRidge, minStd, predict } from "../js/regression.js";
import { CalibrationPool } from "../js/pool.js";

let seed = 99;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const memory = () => { let d; return { load: () => d, save: (x) => (d = structuredClone(x)) }; };

// 1) Lunghezza delle caratteristiche e indici validi per ogni modalità.
const P = (i) => ({ x: 100 + (i % 7) * 3, y: 80 + (i % 5) * 2 });
const m = Array.from({ length: 16 }, (_, i) => i / 10);
const lengths = Object.fromEntries(CONTROL_MODES.map((k) => [k, gazeFeatures(P, {}, m, k).length]));
assert.deepEqual(lengths, { eyes: 7, head: 4, both: 9 });
assert.deepEqual(gazeFeatures(P, {}, m, "head"), [m[8], m[9], m[12], m[13]], "con la testa servono rotazione e posizione");
assert.deepEqual(gazeFeatures(P, {}, null, "head"), [0, 0, 0, 0], "senza matrice non deve dare NaN");
for (const k of CONTROL_MODES) {
  const f = gazeFeatures(P, {}, m, k);
  assert.ok(STABILITY[k].indices.every((j) => j < f.length), `stabilità ${k}`);
  assert.ok(CLEAN_INDICES[k].every((j) => j < f.length), `pulizia ${k}`);
  const x = expand(f, k);
  assert.equal(x.length, f.length + 3, `espansione ${k}`);
  assert.ok(x.every(Number.isFinite), `espansione finita ${k}`);
  assert.equal(minStd(k)?.length ?? x.length, x.length, `limiti ${k} una per colonna`);
}

// 2) Testa: la testa guida davvero il puntatore (rotazione grande, posizione che la segue).
function headSession(points, nPer, headRange) {
  return points.map((point) => ({
    point,
    samples: Array.from({ length: nPer }, () => {
      const yaw = (point[0] - 0.5) * headRange + gauss() * 0.004;
      const pitch = (point[1] - 0.5) * headRange * 0.8 + gauss() * 0.004;
      return [yaw, pitch, yaw * 9 + gauss() * 0.15, pitch * 7 + gauss() * 0.15];
    }),
  }));
}
const grid = [0.08, 0.5, 0.92].flatMap((x) => [0.08, 0.5, 0.92].map((y) => [x, y]));
const test = [[0.3, 0.3], [0.7, 0.4], [0.5, 0.7], [0.2, 0.6]];
const pool = new CalibrationPool(memory(), "t", "head");
pool.add("full", headSession(grid, 30, 0.6), null);
const model = pool.train();
assert.equal(model.mode, "head");
let err = 0, n = 0;
for (const { point, samples } of headSession(test, 20, 0.6)) for (const f of samples) { const [x, y] = predict(model, f); err += Math.hypot(x - point[0], y - point[1]); n++; }
console.log(`testa, movimento vero: errore medio ${(err / n * 100).toFixed(1)}% della diagonale unitaria`);
assert.ok(err / n < 0.03, "con la testa che si muove il puntatore deve seguirla");

// 3) Occhi + testa con la posizione del viso che deriva lentamente: controllo di buon senso (la
//    stima resta finita e vicina a quella dei soli occhi).
function eyeSession(points, nPer, drift) {
  return points.map((point, idx) => ({
    point,
    samples: Array.from({ length: nPer }, () => {
      const eyes = [(point[0] - 0.5) * 0.3 + gauss() * 0.004, (point[1] - 0.5) * 0.1, -0.4 + (point[1] - 0.5) * 0.1 + gauss() * 0.004, 0, (0.5 - point[1]) + gauss() * 0.03, gauss() * 0.004, gauss() * 0.004];
      eyes[3] = (point[0] - 0.5) + gauss() * 0.03;
      return drift ? [...eyes, idx * 0.12 + gauss() * 0.15, idx * -0.08 + gauss() * 0.15] : eyes;
    }),
  }));
}
function looError(mode, drift) {
  const set = eyeSession(grid, 30, drift);
  let total = 0;
  for (let i = 0; i < set.length; i++) {
    const p = new CalibrationPool(memory(), "t", mode);
    p.add("full", set.filter((_, j) => j !== i), null);
    const mdl = p.train();
    const e = set[i].samples.map((f) => { const [x, y] = predict(mdl, f); return Math.hypot(x - set[i].point[0], y - set[i].point[1]); });
    total += e.reduce((a, b) => a + b, 0) / e.length;
  }
  return total / set.length;
}
const eyesOnly = looError("eyes", false), both = looError("both", true);
console.log(`occhi: ${(eyesOnly * 100).toFixed(1)}%, occhi + testa con deriva della posizione: ${(both * 100).toFixed(1)}%`);
assert.ok(Number.isFinite(both) && both < eyesOnly * 1.5 + 0.01, "con la deriva della testa la stima resta ragionevole");

// 4) Archivi separati: stesse chiavi, modalità diverse non si mescolano.
const store = memory();
const a = new CalibrationPool(store, "dev|orizzontale|head", "head");
a.add("full", headSession(grid, 10, 0.6), null);
const b = new CalibrationPool(store, "dev|orizzontale|head", "head");
assert.equal(b.size, 1, "l'archivio salvato si ricarica");
assert.equal(b.train().mode, "head");
assert.equal(new CalibrationPool(store, "dev|orizzontale", "eyes").size, 0, "un altro dispositivo/modalità non eredita");

console.log("ok");
