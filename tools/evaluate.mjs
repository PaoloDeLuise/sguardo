// Valuta l'algoritmo dell'app sulle registrazioni di calibrazione salvate, con lo stesso
// codice usato nel browser (features.js, regression.js, calibration.js).
//
//   node tools/evaluate.mjs                 -> tutte le registrazioni in recordings/
//   node tools/evaluate.mjs file1.json ...  -> solo quelle indicate
//   node tools/evaluate.mjs --modes         -> confronta occhi, testa e occhi + testa
//
// Per ogni registrazione stampa:
//   verifica  errore medio (px) sui punti di verifica, addestrando sulla calibrazione (come l'app)
//   LOO       errore medio (px) su ogni punto escluso a turno, addestrando su tutti gli altri
// Le registrazioni fatte con la testa o con occhi + testa portano il campo "control": si valutano
// con le caratteristiche della loro modalità. Con --modes si ricalcolano tutte le modalità sugli
// stessi dati: le registrazioni fatte a testa ferma non dicono nulla sulla modalità "testa"
// (nessun movimento da cui imparare) ma mostrano se aggiungere la posizione della testa agli
// occhi peggiora la stima (a testa ferma deve restare uguale).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLEAN_INDICES, CONTROL_MODES, RAW_POINTS, gazeFeatures } from "../js/features.js";
import { expand, fitRidge, minStd, predict } from "../js/regression.js";
import { cleanSamples } from "../js/calibration.js";

const args = process.argv.slice(2);
const compareModes = args.includes("--modes");
const dir = fileURLToPath(new URL("../recordings/", import.meta.url));
const given = args.filter((a) => !a.startsWith("--"));
const files = given.length
  ? given
  : readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => join(dir, f));

const pos = new Map(RAW_POINTS.map((p, i) => [p, i]));

function features(sample, mode) {
  const { lm, bs, m } = sample.raw;
  const P = (i) => ({ x: lm[pos.get(i)][0], y: lm[pos.get(i)][1] });
  return gazeFeatures(P, bs, m, mode);
}

function points(d, mode) {
  return [...d.calib, ...d.validation].map(({ point, samples }) =>
    ({ point, samples: cleanSamples(samples.filter((s) => !s.blink).map((s) => features(s, mode)), CLEAN_INDICES[mode]) }));
}

function meanError(model, set, W, H) {
  const errs = set.flatMap(({ point, samples }) => samples.map((f) => {
    const [x, y] = predict(model, f);
    return Math.hypot((x - point[0]) * W, (y - point[1]) * H);
  }));
  return errs.reduce((s, e) => s + e, 0) / errs.length;
}

function train(set, mode) {
  const X = [], Y = [];
  for (const { point, samples } of set) for (const f of samples) { X.push(expand(f, mode)); Y.push(point); }
  const model = fitRidge(X, Y, 0.03, null, minStd(mode));
  model.mode = mode;
  return model;
}

function evaluate(d, mode) {
  const { w: W, h: H } = d.screen;
  const all = points(d, mode);
  const calib = all.slice(0, d.calib.length);
  const valid = all.slice(d.calib.length);
  const ver = meanError(train(calib, mode), valid, W, H);
  const loo = all.map((p, i) => meanError(train(all.filter((_, j) => j !== i), mode), [p], W, H))
    .reduce((s, e) => s + e, 0) / all.length;
  return { ver, loo };
}

const totals = [];
const perMode = Object.fromEntries(CONTROL_MODES.map((m) => [m, []]));
for (const file of files) {
  const d = JSON.parse(readFileSync(file, "utf8"));
  const name = file.split(/[\\/]/).pop().padEnd(40);
  if (compareModes) {
    const row = CONTROL_MODES.map((mode) => {
      const { ver, loo } = evaluate(d, mode);
      perMode[mode].push(ver, loo);
      return `${mode} ${ver.toFixed(0).padStart(4)}/${loo.toFixed(0).padStart(4)}`;
    });
    console.log(`${name} ${row.join("   ")} px (verifica/LOO)`);
  } else {
    const mode = CONTROL_MODES.includes(d.control) ? d.control : "eyes";
    const { ver, loo } = evaluate(d, mode);
    totals.push(ver, loo);
    console.log(`${name} verifica ${ver.toFixed(0).padStart(4)} px   LOO ${loo.toFixed(0).padStart(4)} px${mode === "eyes" ? "" : `   (${mode})`}`);
  }
}
const avg = (a) => (a.reduce((s, e) => s + e, 0) / a.length).toFixed(0);
if (compareModes) {
  console.log(`${"media".padEnd(40)} ${CONTROL_MODES.map((m) => `${m} ${avg(perMode[m])} px`).join("   ")}`);
} else {
  console.log(`${"media".padEnd(40)} ${avg(totals)} px`);
}
