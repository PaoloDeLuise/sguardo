// Prove della calibrazione con il punto in movimento: node tools/test-calibration.mjs
import assert from "node:assert/strict";
import { pursuitExamples } from "../js/calibration.js";

// Il punto va da (0,0) a (1,0) tra t=1000 e t=2000 ms; un fotogramma ogni 100 ms.
const segment = { t0: 1000, t1: 2000, from: [0, 0], to: [1, 0] };
const samples = Array.from({ length: 16 }, (_, i) => ({ t: 1000 + i * 100, features: [i] }));
const ex = pursuitExamples([{ segment, samples }], 200, 250);

// Si scartano i primi 250 ms (l'occhio sta ancora raggiungendo il punto)...
assert.equal(ex[0].samples[0][0], 3, "primo fotogramma usato: t=1300");
// ...e ogni fotogramma è etichettato con la posizione del punto 200 ms prima.
const at = (t) => ex.find((e) => e.samples[0][0] === (t - 1000) / 100).point[0];
assert.ok(Math.abs(at(1300) - 0.1) < 1e-9, "t=1300 -> punto a t=1100 -> x=0.1");
assert.ok(Math.abs(at(1800) - 0.6) < 1e-9, "t=1800 -> x=0.6");
// Dopo l'arrivo l'occhio ci arriva con ritardo: si usano i fotogrammi fino a t1+ritardo, poi stop.
assert.ok(Math.abs(at(2200) - 1) < 1e-9, "t=2200 -> x=1 (fine tratto)");
assert.ok(!ex.some((e) => e.samples[0][0] > 12), "niente fotogrammi oltre t1+ritardo");
console.log(`ok (${ex.length} esempi da 16 fotogrammi)`);
