// Quanto peggiora la stima se la postura cambia dopo la calibrazione, e quanto recupera
// una correzione rapida su pochi punti. Usa sessioni diverse come "posture" diverse:
// calibrazione completa sulla sessione A, uso sulla sessione B.
//   node tools/evaluate-drift.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RAW_POINTS, gazeFeatures } from "../js/features.js";
import { expand, fitRidge, predict, fitAffine, applyAffine } from "../js/regression.js";
import { cleanSamples, QUICK_POINTS } from "../js/calibration.js";

const dir = fileURLToPath(new URL("../recordings/", import.meta.url));
const pos = new Map(RAW_POINTS.map((p, i) => [p, i]));
const sessions = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
  const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const pts = [...d.calib, ...d.validation].map(({ point, samples }) => ({
    point,
    samples: cleanSamples(samples.filter((s) => !s.blink).map((s) => {
      const P = (i) => ({ x: s.raw.lm[pos.get(i)][0], y: s.raw.lm[pos.get(i)][1] });
      return gazeFeatures(P, s.raw.bs, s.raw.m);
    })),
  }));
  return { name: f, W: d.screen.w, H: d.screen.h, pts };
});

const train = (pts) => {
  const X = [], Y = [];
  for (const { point, samples } of pts) for (const f of samples) { X.push(expand(f)); Y.push(point); }
  return fitRidge(X, Y);
};
const err = (fn, pts, W, H) => {
  const e = pts.flatMap(({ point, samples }) => samples.map((f) => { const [x, y] = fn(f); return Math.hypot((x - point[0]) * W, (y - point[1]) * H); }));
  return e.reduce((s, v) => s + v, 0) / e.length;
};
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.06;

let rows = [];
for (const A of sessions) for (const B of sessions) {
  if (A === B) continue;
  const model = train(A.pts);
  // punti della sessione B usati per la correzione rapida (i più vicini a QUICK_POINTS)
  const quick = QUICK_POINTS.map((q) => B.pts.find((p) => near(p.point, q))).filter(Boolean);
  const test = B.pts.filter((p) => !quick.includes(p));
  const pairs = quick.flatMap(({ point, samples }) => samples.map((f) => [predict(model, f), point]));
  const aff = fitAffine(pairs);
  const no = err((f) => predict(model, f), test, B.W, B.H);
  const yes = err((f) => applyAffine(aff, predict(model, f)), test, B.W, B.H);
  rows.push([no, yes]);
  console.log(`${A.name.slice(13, 28)} -> ${B.name.slice(13, 28)}   senza correzione ${no.toFixed(0).padStart(4)} px   con correzione (${quick.length} punti) ${yes.toFixed(0).padStart(4)} px`);
}
const m = (i) => (rows.reduce((s, r) => s + r[i], 0) / rows.length).toFixed(0);
console.log(`media                              senza ${m(0)} px   con ${m(1)} px`);
