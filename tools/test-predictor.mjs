// Prove del suggerimento parole: node tools/test-predictor.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Predictor, context } from "../js/predictor.js";
import { display } from "../js/keyboard.js";

const words = readFileSync(new URL("../data/parole-it.txt", import.meta.url), "utf8").split("\n").filter(Boolean);
const p = new Predictor(words);

assert.deepEqual(context("ho fa"), { partial: "fa", prev: "ho", sentenceStart: false });
assert.deepEqual(context("dammi l'ac"), { partial: "ac", prev: "l'", sentenceStart: false });
assert.deepEqual(context("grazie. "), { partial: "", prev: null, sentenceStart: true });
assert.ok(p.suggest("perch").includes("perché"), "perché manca");
assert.ok(p.suggest("perche").includes("perché"), "accenti ignorati");
assert.equal(display("ciao. come stai? bene"), "Ciao. Come stai? Bene");

for (const t of ["", "c", "vo", "ho bisogno d", "dammi l'ac", "grazie. "]) console.log(JSON.stringify(t).padEnd(18), "->", p.suggest(t).join(", "));

// Impara: dopo averla usata, "ho fame" viene proposta subito dopo "ho".
const before = p.suggest("ho ");
p.learn("ho fame"); p.learn("ho fame"); p.learn("ho sete");
console.log('"ho " prima       ->', before.join(", "), "| dopo ->", p.suggest("ho ").join(", "));
assert.equal(p.suggest("ho ")[0], "fame");
console.log("ok");
