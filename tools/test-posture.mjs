// Prove su registrazioni vere: il controllo della postura e l'archivio delle calibrazioni.
//   node tools/test-posture.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { RAW_POINTS, gazeFeatures } from "../js/features.js";
import { predict } from "../js/regression.js";
import { QUICK_POINTS } from "../js/calibration.js";
import { PostureMonitor, meanPose } from "../js/posture.js";
import { CalibrationPool } from "../js/pool.js";

const dir = fileURLToPath(new URL("../recordings/", import.meta.url));
const pos = new Map(RAW_POINTS.map((p, i) => [p, i]));
const sessions = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
  const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const frames = [...d.calib, ...d.validation].flatMap(({ point, samples }) => samples.filter((s) => !s.blink).map((s) => ({
    point,
    t: s.t,
    features: gazeFeatures((i) => ({ x: s.raw.lm[pos.get(i)][0], y: s.raw.lm[pos.get(i)][1] }), s.raw.bs, s.raw.m),
    pose: [s.raw.m[12], s.raw.m[13], s.raw.m[14], s.raw.m[8], s.raw.m[9]],
  })));
  return { name: f.slice(13, 28), W: d.screen.w, H: d.screen.h, frames };
});

// 1) Postura: la stessa sessione non deve far scattare l'avviso, un'altra sì.
// I fotogrammi sono riprodotti a 30 al secondo, di seguito.
function triggers(baselineSession, streamSession) {
  const m = new PostureMonitor();
  m.setBaseline(meanPose(baselineSession.frames.map((f) => f.pose)));
  return streamSession.frames.some((f, i) => m.update(f.pose, i * 33));
}
for (const A of sessions) for (const B of sessions) {
  const fired = triggers(A, B);
  console.log(`postura: calibrato in ${A.name}, uso in ${B.name}: ${fired ? "avviso" : "nessun avviso"}`);
  assert.equal(fired, A !== B);
}

// 2) Archivio: sessioni precedenti + ricalibrazione rapida sulla sessione nuova.
const memory = () => { let data; return { load: () => data, save: (d) => (data = structuredClone(d)) }; };
const groupByPoint = (frames) => {
  const m = new Map();
  for (const f of frames) { const k = f.point.join(); if (!m.has(k)) m.set(k, { point: f.point, samples: [] }); m.get(k).samples.push(f.features); }
  return [...m.values()];
};
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.06;
for (const B of sessions) {
  const pool = new CalibrationPool(memory(), "test");
  for (const A of sessions.filter((s) => s !== B)) pool.add("full", groupByPoint(A.frames), meanPose(A.frames.map((f) => f.pose)));
  const pts = groupByPoint(B.frames);
  const quick = QUICK_POINTS.map((q) => pts.find((p) => near(p.point, q))).filter(Boolean);
  const test = pts.filter((p) => !quick.includes(p));
  const err = (model) => {
    const e = test.flatMap(({ point, samples }) => samples.map((f) => { const [x, y] = predict(model, f); return Math.hypot((x - point[0]) * B.W, (y - point[1]) * B.H); }));
    return e.reduce((s, v) => s + v, 0) / e.length;
  };
  const before = err(pool.train());
  pool.add("quick", quick, null);
  const after = err(pool.train());
  console.log(`archivio, sessione nuova ${B.name}: senza punti nuovi ${before.toFixed(0)} px, dopo la ricalibrazione rapida ${after.toFixed(0)} px`);
}
console.log("ok");
