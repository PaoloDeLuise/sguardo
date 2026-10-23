// Prove delle lingue dell'interfaccia:
//   node tools/test-i18n.mjs
// Controlla che ogni lingua abbia le stesse chiavi e gli stessi segnaposto, che tutti i testi usati
// nel codice e nella pagina esistano, che la tastiera abbia tutte le lettere e che il dizionario
// funzioni con le regole della lingua (apostrofo). Non giudica la qualità delle traduzioni.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FALLBACK_LANG, LOCALES, detectLanguage, locale, setLanguage, t } from "../js/i18n.js";
import { Predictor, context, normalize } from "../js/predictor.js";
import { Lexicon } from "../js/recognizer.js";
import { LetterModel } from "../js/dasher.js";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const codes = Object.keys(LOCALES);
assert.ok(codes.includes("it") && codes.includes("en"), "italiano e inglese ci sono");

// 1) Stesse chiavi, stessi segnaposto, stessi tipi in tutte le lingue.
const it = LOCALES.it;
const placeholders = (v) => (typeof v === "string" ? [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",") : "fn");
for (const code of codes) {
  const l = LOCALES[code];
  for (const key of Object.keys(it.ui)) assert.ok(key in l.ui, `${code}: manca "${key}"`);
  for (const key of Object.keys(l.ui)) assert.ok(key in it.ui, `${code}: "${key}" non esiste in italiano`);
  for (const [key, value] of Object.entries(l.ui)) {
    // Un testo può essere una funzione (plurali diversi da lingua a lingua): deve dare un testo con i numeri.
    if (typeof value === "function") {
      const out = value({ n: 2, s: 7 });
      assert.ok(typeof out === "string" && out.includes("2"), `${code}: "${key}" (funzione) non dà un testo con il numero`);
      continue;
    }
    assert.equal(typeof value, "string", `${code}: "${key}" deve essere un testo o una funzione`);
    assert.ok(value.trim() !== "", `${code}: "${key}" è vuoto`);
    if (typeof it.ui[key] === "string") assert.equal(placeholders(value), placeholders(it.ui[key]), `${code}: "${key}" ha segnaposto diversi dall'italiano`);
  }
  for (const field of ["code", "name", "speech", "xtts", "wordsFile", "starters", "accents", "keyboard", "phrases", "morePhrases"]) {
    assert.ok(l[field] !== undefined, `${code}: manca il campo ${field}`);
  }
  assert.equal(l.code, code, `${code}: il codice nel file è diverso`);
  assert.equal(typeof l.apostropheInWord, "boolean", `${code}: apostropheInWord`);
}

// 2) Tastiera: 5 gruppi di al più 10 tasti, un solo gruppo "more", tutte le 26 lettere, nessuna ripetuta.
for (const code of codes) {
  const { groups } = LOCALES[code].keyboard;
  assert.equal(groups.length, 5, `${code}: servono 5 gruppi`);
  assert.equal(groups.filter((g) => g.more).length, 1, `${code}: un solo gruppo con "123"`);
  // La griglia è 4x3: l'ultima cella è "Indietro" e nel gruppo con "123" la penultima apre i numeri.
  for (const g of groups) assert.ok(g.keys.length <= (g.more ? 10 : 11), `${code}: "${g.label}" ha troppi tasti`);
  const base = groups.flatMap((g) => g.keys).map((k) => k.normalize("NFD").replace(/[̀-ͯ]/g, "")).filter((k) => /^[A-Z]$/.test(k));
  assert.equal(new Set(base).size, 26, `${code}: mancano lettere (${[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].filter((c) => !base.includes(c)).join("")})`);
  // Le lettere accentate possono ripetere la base (A À): senza accenti ogni lettera è comunque presente.
  assert.equal(LOCALES[code].phrases.length, 10, `${code}: dieci frasi rapide`);
  for (const p of [...LOCALES[code].phrases, ...LOCALES[code].morePhrases]) assert.ok(p.label && p.say, `${code}: frase incompleta`);
  assert.equal(new Set(LOCALES[code].phrases.map((p) => p.label)).size, 10, `${code}: etichette ripetute`);
}

// 3) Tutti i testi usati nel codice e nella pagina esistono.
const used = new Set();
for (const file of readdirSync(new URL("js/", root)).filter((f) => f.endsWith(".js") && f !== "i18n.js")) {
  const src = read(`js/${file}`);
  for (const m of src.matchAll(/\bt\("([\w.]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bstep\("([\w.]+)"/g)) used.add(m[1]);
  // t(condizione ? "chiave.a" : "chiave.b")
  for (const m of src.matchAll(/\bt\([^"'`)]*\?\s*"([\w.]+)"\s*:\s*"([\w.]+)"/g)) { used.add(m[1]); used.add(m[2]); }
}
const html = read("index.html");
for (const m of html.matchAll(/data-i18n(?:-html|-title|-aria|-value)?="([\w.]+)"/g)) used.add(m[1]);
// chiavi composte a runtime
for (const m of ["wink", "mouth", "cell"]) used.add(`penmode.${m}`);
for (const m of ["eyes", "head", "both"]) for (const k of ["control", "control.hint", "bar.control", "start.control"]) used.add(`${k}.${m}`);
for (const m of ["eyes", "head", "both"]) for (const k of ["quick", "full"]) used.add(`calib.intro.${m}.${k}`);
for (const m of ["auto", "light", "dark"]) used.add(`background.${m}`);
for (const m of ["auto", "horizontal", "vertical"]) used.add(`dasher.layout.${m}`);
for (const m of ["Wink", "Mouth"]) { used.add(`pad.how${m}`); used.add(`pad.up${m}`); }
for (const key of used) assert.ok(key in it.ui, `usata nel codice ma non definita: "${key}"`);
console.log(`${used.size} testi usati, ${Object.keys(it.ui).length} definiti per lingua (${codes.join(", ")})`);
const unused = Object.keys(it.ui).filter((k) => !used.has(k));
if (unused.length) console.log(`  non usati (da controllare): ${unused.join(", ")}`);

// 4) t(): variabili, funzioni, ripiego sull'italiano, chiave sconosciuta.
setLanguage("en");
assert.equal(t("draw.forget", { n: 3 }), "Forget learned\nletters (3)");
assert.equal(t("voice.recordings", { n: 1, s: 4 }), "1 recording (4 s)");
assert.equal(t("voice.recordings", { n: 2, s: 9 }), "2 recordings (9 s)");
assert.equal(t("chiave.che.non.esiste"), "chiave.che.non.esiste");
assert.equal(t("bar.dot", {}), "Dot: {v}", "una variabile mancante resta visibile");
setLanguage("it");
assert.equal(t("voice.recordings", { n: 1, s: 4 }), "1 registrazione (4 s)");
assert.equal(t("voice.recordings", { n: 3, s: 4 }), "3 registrazioni (4 s)");
assert.equal(locale().code, "it");

// 5) Scelta della lingua: quella salvata, poi quella del browser, poi l'inglese.
assert.equal(detectLanguage("it", ["en-US"]), "it", "la scelta salvata vince");
assert.equal(detectLanguage(undefined, ["it-IT", "en"]), "it");
assert.equal(detectLanguage(undefined, ["ru-RU", "pt-BR", "en-GB"]), "pt", "la prima lingua del browser che esiste (il russo no)");
assert.equal(detectLanguage(undefined, ["fr-CA"]), "fr");
assert.equal(detectLanguage(undefined, ["de-AT", "en"]), "de");
assert.equal(detectLanguage(undefined, ["es-MX"]), "es");
assert.equal(detectLanguage(undefined, ["ja-JP", "zh"]), FALLBACK_LANG, "nessuna disponibile: inglese");
assert.equal(detectLanguage("xx", ["it"]), "it", "una lingua salvata che non esiste si ignora");
assert.equal(detectLanguage(undefined, []), FALLBACK_LANG);

// 6) Dizionari e regole delle parole.
for (const code of codes) {
  const l = LOCALES[code];
  const words = read(l.wordsFile).split(/\r?\n/).filter(Boolean);
  assert.ok(words.length >= 20000, `${code}: dizionario troppo corto (${words.length})`);
  assert.equal(new Set(words).size, words.length, `${code}: parole ripetute`);
  for (const w of l.starters) assert.ok(words.includes(w), `${code}: la parola iniziale "${w}" non è nel dizionario`);
  assert.ok(/^[\p{L}']+$/u.test(words.slice(0, 2000).join("")), `${code}: caratteri strani nelle prime parole`);
  for (const p of l.phrases) assert.ok(p.say.length < 80, `${code}: frase lunga`);
}

// Inglese: l'apostrofo fa parte della parola; italiano: la chiude.
const en = LOCALES.en;
const enWords = read(en.wordsFile).split(/\r?\n/).filter(Boolean);
assert.ok(enWords.includes("don't") && enWords.includes("i'm") && enWords.includes("hello"), "contrazioni nel dizionario inglese");
assert.deepEqual(context("i don't kn", true), { partial: "kn", prev: "don't", sentenceStart: false });
assert.deepEqual(context("l'acq", false), { partial: "acq", prev: "l'", sentenceStart: false });
const enPredictor = new Predictor(enWords, null, { apostropheInWord: true, starters: en.starters });
assert.ok(enPredictor.suggest("i don't kn").includes("know"), "suggerisce 'know' dopo 'i don't kn'");
assert.ok(enPredictor.suggest("don'").some((w) => w.startsWith("don'")), "dopo l'apostrofo suggerisce la contrazione");
assert.ok(enPredictor.suggest("").every((w) => typeof w === "string") && enPredictor.suggest("").length === 3, "a testo vuoto propone le parole iniziali");
const itWords = read(it.wordsFile).split(/\r?\n/).filter(Boolean);
const itPredictor = new Predictor(itWords, null, { apostropheInWord: false, starters: it.starters });
assert.ok(itPredictor.suggest("dammi l'acq").some((w) => w.startsWith("acq")), "italiano: dopo l'apostrofo la parola riparte");

// Scrittura continua: l'inglese non ha lettere accentate e tiene l'apostrofo nella parola.
const enModel = new LetterModel(enWords, {}, { accents: en.accents, apostropheInWord: true });
const enSyms = enModel.children("").map((c) => c.sym);
assert.ok(!enSyms.some((s) => /[àèéìòù]/.test(s)), "niente accenti in inglese");
const afterDon = enModel.children("don");
assert.ok(afterDon.find((c) => c.sym === "'").end - afterDon.find((c) => c.sym === "'").start > 0.05, "dopo 'don' l'apostrofo è probabile");
const itModel = new LetterModel(itWords, {}, { accents: it.accents, apostropheInWord: false });
assert.ok(itModel.children("").some((c) => c.sym === "è"), "italiano: ci sono le lettere accentate");

// 7) Ogni lingua: regole dell'apostrofo coerenti con il dizionario, parole di tutti i giorni presenti
//    e trovabili con le prime lettere, scrittura a mano (dizionario per lunghezza) e scrittura continua.
const probes = {
  it: ["acq", "acqua"], en: ["wat", "water"], es: ["agu", "agua"], fr: ["dou", "douleur"], de: ["schm", "schmerzen"], pt: ["banh", "banheiro"],
};
for (const code of codes) {
  const l = LOCALES[code];
  const words = read(l.wordsFile).split(/\r?\n/).filter(Boolean);
  if (l.apostropheInWord) {
    assert.ok(words.every((w) => !w.startsWith("'") && !w.endsWith("'")), `${code}: parole con apostrofo all'inizio o alla fine`);
  } else {
    // L'apostrofo chiude la parola: può stare solo alla fine (elisioni: l', d', qu').
    assert.ok(words.every((w) => !/'./.test(w)), `${code}: parola con apostrofo in mezzo: ${words.find((w) => /'./.test(w))}`);
  }
  const predictor = new Predictor(words, null, { apostropheInWord: l.apostropheInWord, starters: l.starters });
  const [prefix, word] = probes[code];
  assert.ok(predictor.suggest(prefix, 50).includes(word), `${code}: "${word}" non esce scrivendo "${prefix}"`);
  assert.equal(predictor.suggest("").length, 3, `${code}: servono tre suggerimenti a testo vuoto`);
  // Scrittura a mano: la parola è nel dizionario per lunghezza con le lettere senza accenti.
  const lexicon = new Lexicon(words);
  const key = normalize(word).toUpperCase();
  assert.ok(lexicon.byLength.get(key.length)?.some((e) => e.word === word && e.key === key), `${code}: "${word}" non è nel dizionario della scrittura a mano`);
  // Scrittura continua: le lettere accentate della lingua sono tra i simboli, le altre no.
  const model = new LetterModel(words, {}, { accents: l.accents, apostropheInWord: l.apostropheInWord });
  const symbols = model.children("").map((c) => c.sym);
  for (const accented of Object.values(l.accents).flat()) assert.ok(symbols.includes(accented), `${code}: manca "${accented}" nella scrittura continua`);
  assert.ok(symbols.includes("a") && symbols.includes("z"), `${code}: lettere base`);
  // La tastiera ha tutte le lettere accentate della lingua.
  const keys = l.keyboard.groups.flatMap((g) => g.keys).map((k) => k.toLowerCase());
  for (const accented of Object.values(l.accents).flat()) {
    if (accented === "œ" || accented === "ë" || accented === "ÿ") continue; // rare: si scrivono senza e il suggerimento le completa
    assert.ok(keys.includes(accented), `${code}: "${accented}" non è sulla tastiera`);
  }
}
assert.equal(normalize("Straße"), "strasse", "ß si confronta come ss");
assert.equal(normalize("cœur"), "coeur", "œ si confronta come oe");
assert.equal(normalize("Çà été, ñandú, über"), "ca ete, nandu, uber");

console.log("ok");
