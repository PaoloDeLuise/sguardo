// Valuta l'algoritmo dell'app sulle registrazioni di calibrazione salvate, con lo stesso
// codice usato nel browser (features.js, regression.js, calibration.js).
//
//   node tools/evaluate.mjs                 -> tutte le registrazioni in recordings/
//   node tools/evaluate.mjs file1.json ...  -> solo quelle indicate
//
// Per ogni registrazione stampa:
//   verifica  errore medio (px) sui punti di verifica, addestrando sulla calibrazione (come l'app)
//   LOO       errore medio (px) su ogni punto escluso a turno, addestrando su tutti gli altri
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RAW_POINTS, gazeFeatures } from "../js/features.js";
import { expand, fitRidge, predict } from "../js/regression.js";
import { cleanSamples } from "../js/calibration.js";

const dir = fileURLToPath(new URL("../recordings/", import.meta.url));
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => join(dir, f));

const pos = new Map(RAW_POINTS.map((p, i) => [p, i]));

function features(sample) {
  const { lm, bs, m } = sample.raw;
  const P = (i) => ({ x: lm[pos.get(i)][0], y: lm[pos.get(i)][1] });
  return gazeFeatures(P, bs, m);
}

function points(d) {
  return [...d.calib, ...d.validation].map(({ point, samples }) =>
    ({ point, samples: cleanSamples(samples.filter((s) => !s.blink).map(features)) }));
}

function meanError(model, set, W, H) {
  const errs = set.flatMap(({ point, samples }) => samples.map((f) => {
    const [x, y] = predict(model, f);
    return Math.hypot((x - point[0]) * W, (y - point[1]) * H);
  }));
  return errs.reduce((s, e) => s + e, 0) / errs.length;
}

function train(set) {
  const X = [], Y = [];
  for (const { point, samples } of set) for (const f of samples) { X.push(expand(f)); Y.push(point); }
  return fitRidge(X, Y);
}

const totals = [];
for (const file of files) {
  const d = JSON.parse(readFileSync(file, "utf8"));
  const { w: W, h: H } = d.screen;
  const all = points(d);
  const calib = all.slice(0, d.calib.length);
  const valid = all.slice(d.calib.length);
  const ver = meanError(train(calib), valid, W, H);
  const loo = all.map((p, i) => meanError(train(all.filter((_, j) => j !== i)), [p], W, H))
    .reduce((s, e) => s + e, 0) / all.length;
  totals.push(ver, loo);
  console.log(`${file.split(/[\\/]/).pop().padEnd(40)} verifica ${ver.toFixed(0).padStart(4)} px   LOO ${loo.toFixed(0).padStart(4)} px`);
}
console.log(`${"media".padEnd(40)} ${(totals.reduce((s, e) => s + e, 0) / totals.length).toFixed(0)} px`);
