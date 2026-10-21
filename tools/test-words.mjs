// Prove delle parole disegnate con disegni sintetici (lettere deformate, in fila):
//   node tools/test-words.mjs
// Misura (1) se le lettere si separano da sole dalla posizione, (2) quanto spesso la parola scelta
// nel dizionario è quella scritta, contro le sole lettere lette una per una.
// Come per le lettere: sono disegni sintetici, non una persona che scrive con la testa.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Lexicon, groupLetters, recognize, recognizeWord } from "../js/recognizer.js";
import { between, draw, rnd, setSeed } from "./synthetic-drawing.mjs";

const all = readFileSync(new URL("../data/parole-it.txt", import.meta.url), "utf8").split(/\r?\n/).filter(Boolean);
const lexicon = new Lexicon(all);
const pool = all.slice(0, 5000).filter((w) => /^[a-z]{3,8}$/.test(w));

// Parola scritta in fila: ogni lettera con la sua grandezza, la sua altezza e un piccolo scarto
// di posizione (la mano non è mai su una riga).
function writeWord(word, noise) {
  const letters = [];
  [...word.toUpperCase()].forEach((ch, i) => {
    const size = between(0.8, 1.2), dy = between(-0.1, 0.1), dx = i * 1.35 + between(-0.12, 0.12);
    letters.push(draw(ch, noise).map((s) => s.map(([x, y]) => [x * size + dx, y * size + dy])));
  });
  return letters.flat(); // i tratti nell'ordine in cui si disegnano, senza dire a quale lettera appartengono
}

const TRIALS = 60;
setSeed(21);
console.log("rumore | lettere separate bene | parola giusta top1 / top3 | solo lettere una per una");
let last = null;
for (const noise of [0.03, 0.06, 0.09]) {
  let split = 0, top1 = 0, top3 = 0, literal = 0;
  for (let i = 0; i < TRIALS; i++) {
    const word = pool[Math.floor(Math.pow(rnd(), 1.5) * pool.length)];
    const strokes = writeWord(word, noise);
    const letters = groupLetters(strokes);
    if (letters.length === word.length) split++;
    const cands = recognizeWord(letters, { lexicon });
    if (cands?.[0].text === word) top1++;
    if (cands?.slice(0, 3).some((c) => c.text === word)) top3++;
    // senza dizionario: ogni lettera per conto suo
    if (letters.map((l) => recognize(l)[0].ch).join("").toLowerCase() === word) literal++;
  }
  const pct = (n) => `${Math.round((n / TRIALS) * 100)}%`.padStart(4);
  console.log(`${noise.toFixed(2)}   |        ${pct(split)}           |        ${pct(top1)} / ${pct(top3)}        |        ${pct(literal)}`);
  last = { split: split / TRIALS, top1: top1 / TRIALS, literal: literal / TRIALS };
}

// Nomi che non sono nel dizionario: devono uscire com'è scritto se il disegno è buono.
setSeed(33);
let names = 0;
const NAMES = ["paolo", "zorik", "giada", "wanda", "ugo", "xavier"];
for (const name of NAMES) {
  const cands = recognizeWord(groupLetters(writeWord(name, 0.03)), { lexicon });
  if (cands[0].text === name || all.includes(name)) names++;
  else console.log(`  nome ${name}: letto ${cands.slice(0, 3).map((c) => c.text).join(", ")}`);
}
console.log(`nomi fuori dizionario letti bene: ${names}/${NAMES.length}`);

// Separazione delle lettere nei casi tipici
const L = (strokes, dx) => strokes.map((s) => s.map(([x, y]) => [x + dx, y]));
const bar = [[0, 0], [0.7, 0]], stem = [[0.35, 0], [0.35, 1]];
assert.equal(groupLetters([L([bar, stem], 0), L([bar, stem], 1.2)].flat()).length, 2, "due T vicine sono due lettere");
assert.equal(groupLetters([bar, stem]).length, 1, "la barra e il gambo della T sono una lettera");
assert.equal(groupLetters([stem, [[1.0, 0], [1.0, 1]]]).length, 2, "due I affiancate sono due lettere");
assert.equal(groupLetters([[[0, 0], [0.01, 0.01]], stem], 0.2).length, 1, "un segnetto è rumore");
const E = [[[0.65, 0], [0, 0], [0, 1], [0.65, 1]], [[0, 0.5], [0.5, 0.5]]];
assert.equal(groupLetters([...E, ...L(E, 1)].reverse()).length, 2, "l'ordine dei tratti non conta");

assert.ok(last.top1 > last.literal, "il dizionario deve aiutare quando il disegno è disturbato");
assert.ok(names >= NAMES.length - 1, "i nomi fuori dizionario devono restare leggibili");
console.log("ok");
