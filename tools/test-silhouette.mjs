// Sagoma della calibrazione: contorno, media e indicazioni per tornare in posizione.
// node tools/test-silhouette.mjs
import assert from "node:assert/strict";
import { OutlineAverage, outlineHints, outlineOf } from "../js/silhouette.js";
import { poseOffset } from "../js/posture.js";

// Un viso finto: ogni punto della mesh su un cerchio di raggio r intorno a (cx, cy).
const face = (cx, cy, r) => Array.from({ length: 478 }, (_, i) => ({
  x: cx + r * Math.cos(i), y: cy + r * Math.sin(i),
}));

const ref = outlineOf(face(0.5, 0.5, 0.15));
assert.equal(ref.length, (36 + 16 + 16 + 1) * 2);

// Stessa posizione: nessuna indicazione.
assert.deepEqual(outlineHints(ref, outlineOf(face(0.5, 0.5, 0.15))), []);

// Più piccolo = più lontano dalla fotocamera: deve avvicinarsi.
assert.deepEqual(outlineHints(ref, outlineOf(face(0.5, 0.5, 0.11))), ["closer"]);
assert.deepEqual(outlineHints(ref, outlineOf(face(0.5, 0.5, 0.19))), ["farther"]);

// Nel video x maggiore = a sinistra nell'anteprima a specchio: deve andare a destra.
assert.deepEqual(outlineHints(ref, outlineOf(face(0.6, 0.5, 0.15))), ["right"]);
assert.deepEqual(outlineHints(ref, outlineOf(face(0.4, 0.5, 0.15))), ["left"]);
// Più in basso nell'immagine: deve salire.
assert.deepEqual(outlineHints(ref, outlineOf(face(0.5, 0.6, 0.15))), ["up"]);
assert.deepEqual(outlineHints(ref, outlineOf(face(0.4, 0.4, 0.15))), ["left", "down"]);

// Senza sagoma salvata niente indicazioni.
assert.deepEqual(outlineHints(null, ref), []);

// Media dei contorni.
const avg = new OutlineAverage();
assert.equal(avg.value, null);
avg.add(outlineOf(face(0.4, 0.5, 0.15)));
avg.add(outlineOf(face(0.6, 0.5, 0.15)));
avg.add(null);
assert.ok(outlineHints(ref, avg.value).length === 0);
assert.ok(Math.abs(avg.value[0] - ref[0]) < 0.002);

// Scarto di posa in multipli delle soglie del controllo della postura.
const base = [0, 0, -50, 0, 0];
assert.equal(poseOffset(base, base).value, 0);
assert.ok(poseOffset([1, 0, -50, 0, 0], base).value < 0.6);
assert.ok(poseOffset([0, 0, -45, 0, 0], base).moved > 1);
assert.ok(poseOffset([0, 0, -50, 0.1, 0], base).turned > 1);
assert.equal(poseOffset(null, base), null);

console.log("silhouette: ok");
