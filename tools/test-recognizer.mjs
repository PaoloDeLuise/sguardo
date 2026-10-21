// Prove del riconoscimento delle lettere disegnate con disegni sintetici:
//   node tools/test-recognizer.mjs
// I disegni sono i modelli delle lettere deformati (proporzioni, inclinazione, tremolio lento e
// veloce, punti sparsi): misura quanto reggono al disturbo e quanto aiuta il linguaggio, NON la
// precisione con una persona vera (i modelli sono gli stessi da cui nascono i disegni).
// Con una mano vera il disturbo è diverso: serve provare e, quando c'è, valutare su disegni salvati.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LETTER_SHAPES, TUNING, addPersonal, inkSize, priorFromChildren, recognize, toCloud } from "../js/recognizer.js";
import { LetterModel } from "../js/dasher.js";

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const between = (a, b) => a + (b - a) * rnd();

// Disegno "a mano" di una lettera: sceglie un modo di scriverla e lo deforma.
// noise: grandezza del disturbo in lunghezze della lettera (0.05 = 5% dell'altezza).
function draw(ch, noise) {
  const variants = LETTER_SHAPES[ch];
  const strokes = variants[Math.floor(rnd() * variants.length)];
  const sx = between(0.75, 1.35), shear = between(-0.15, 0.15), rot = between(-0.2, 0.2);
  const phase = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
  const out = strokes.map((s) => {
    // punti a intervalli irregolari lungo il tratto (il puntatore va a scatti)
    const m = Math.floor(between(25, 70));
    const lens = [0];
    for (let i = 1; i < s.length; i++) lens.push(lens[i - 1] + Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]));
    const ts = Array.from({ length: m }, (_, i) => (i + between(-0.3, 0.3)) / (m - 1)).map((t) => Math.min(1, Math.max(0, t))).sort((a, b) => a - b);
    return ts.map((t, k) => {
      const d = t * lens.at(-1);
      let i = 1;
      while (i < s.length - 1 && lens[i] < d) i++;
      const u = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
      let x = s[i - 1][0] + u * (s[i][0] - s[i - 1][0]), y = s[i - 1][1] + u * (s[i][1] - s[i - 1][1]);
      x = x * sx + shear * y;
      const [rx, ry] = [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
      // deriva lenta (ampia) + tremolio veloce
      const wob = noise * (Math.sin(k / 6 + phase[0]) + 0.6 * Math.sin(k / 3 + phase[1]));
      const wob2 = noise * (Math.cos(k / 5 + phase[2]) + 0.6 * Math.sin(k / 2.5 + phase[3]));
      return [rx + wob + gauss() * noise * 0.5, ry + wob2 + gauss() * noise * 0.5];
    });
  });
  return out;
}

// Parole vere, pesate per frequenza, per provare il linguaggio (lettera da disegnare dopo il prefisso).
const words = readFileSync(new URL("../data/parole-it.txt", import.meta.url), "utf8").split(/\r?\n/).filter((w) => /^[a-z]{3,}$/.test(w)).slice(0, 3000);
const model = new LetterModel(words);
function pickCase() {
  const w = words[Math.floor(Math.pow(rnd(), 2) * words.length)];
  const k = Math.floor(rnd() * w.length);
  return { prefix: w.slice(0, k), ch: w[k].toUpperCase() };
}

const TRIALS = 400;
const NOISES = [0.02, 0.04, 0.06, 0.09];
const cases = NOISES.map((noise) => Array.from({ length: TRIALS }, () => {
  const { prefix, ch } = pickCase();
  return { ch, strokes: draw(ch, noise), prior: priorFromChildren(model.children(prefix)) };
}));

function score(set) {
  let top1 = 0, top3 = 0;
  const confusions = {};
  for (const { ch, strokes, prior } of set) {
    const r = recognize(strokes, { prior });
    if (r[0].ch === ch) top1++;
    else confusions[`${ch}→${r[0].ch}`] = (confusions[`${ch}→${r[0].ch}`] ?? 0) + 1;
    if (r.slice(0, 3).some((x) => x.ch === ch)) top3++;
  }
  return { top1: top1 / set.length, top3: top3 / set.length, confusions };
}
const pct = (v) => `${(v * 100).toFixed(0)}%`.padStart(4);

// Pesi: con --tune si provano più combinazioni; altrimenti restano quelli scelti in recognizer.js.
const grid = process.argv.includes("--tune") ? [[0.08, 0], [0.04, 1], [0.03, 1], [0.02, 1], [0.015, 1], [0.01, 1], [0.02, 0.5]] : [[TUNING.tau, TUNING.language]];
console.log("tau    lingua | " + NOISES.map((n) => `rumore ${n.toFixed(2)} top1/top3`).join(" | "));
let last = null;
for (const [tau, language] of grid) {
  Object.assign(TUNING, { tau, language });
  const res = cases.map(score);
  console.log(`${String(tau).padEnd(6)} ${String(language).padEnd(5)} | ` + res.map((r) => `${pct(r.top1)} / ${pct(r.top3)}`.padEnd(18)).join(" | "));
  last = res;
}
const top = Object.entries(last[2].confusions).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(", ");
console.log(`errori più frequenti a rumore 0.06: ${top}`);
Object.assign(TUNING, { tau: 0.08, language: 0 });
const shapeOnly = cases.map(score);
Object.assign(TUNING, { tau: grid.at(-1)[0], language: grid.at(-1)[1] });
console.log("solo forma (senza linguaggio): " + shapeOnly.map((r) => pct(r.top1)).join(" "));

// Controlli di buon senso
seed = 11;
let clean = 0;
for (const ch of Object.keys(LETTER_SHAPES)) if (recognize(draw(ch, 0.005))[0].ch === ch) clean++;
assert.ok(clean >= 25, `senza disturbo quasi tutte le lettere devono uscire giuste (${clean}/26)`);
assert.equal(recognize([[[0, 0], [0.5, 0.2]]].map((s) => s.slice(0, 1))), null, "un solo punto non è un disegno");
assert.ok(inkSize([[[0, 0], [30, 40]]]) === 50, "diagonale del segno");
assert.ok(toCloud([[[0, 0], [0, 100]]]).length === 32, "32 punti");

// Modelli personali: un disegno insolito, scelto a mano, la volta dopo viene riconosciuto.
seed = 5;
const odd = [[[0, 0], [0.3, 0.0], [0.3, 0.5], [0.0, 0.5], [0.3, 0.5], [0.3, 1.0], [0, 1.0]]]; // una "S" quadrata
const personal = {};
const before = recognize(odd, { personal }).findIndex((r) => r.ch === "S");
addPersonal(personal, "S", odd);
const after = recognize(odd, { personal }).findIndex((r) => r.ch === "S");
console.log(`S quadrata: posizione prima ${before + 1}, dopo averla insegnata ${after + 1}`);
assert.equal(after, 0, "il disegno insegnato deve diventare il primo");

assert.ok(last[3].top1 >= shapeOnly[3].top1, "il linguaggio deve aiutare quando il disegno è molto disturbato");
console.log("ok");
