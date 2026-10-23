// Suggerimento delle parole: frequenze della lingua parlata (data/parole-it.txt, data/words-en.txt, ...)
// più quello che la persona scrive davvero, che col tempo pesa di più.

// "perche" trova "perché": il confronto ignora accenti e maiuscole.
// ß, œ ed æ non si scompongono in lettere più accenti: si scrivono come ss, oe, ae (tedesco, francese).
export function normalize(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/œ/g, "oe").replace(/æ/g, "ae");
}

// Parola in corso di scrittura e parola precedente, dato il testo.
// Per l'italiano l'apostrofo chiude una parola: in "l'acqua" la parola in corso è "acqua", la
// precedente "l'". Per l'inglese (apostropheInWord) fa parte della parola: "don't" è una parola sola.
export function context(text, apostropheInWord = false) {
  const partial = text.match(apostropheInWord ? /[^\s.,?!]*$/ : /[^\s'.,?!]*$/)[0];
  const before = text.slice(0, text.length - partial.length);
  const words = splitWords(before, apostropheInWord);
  const sentenceStart = /^\s*$|[.?!]\s*$/.test(before);
  return { partial, prev: sentenceStart ? null : words.at(-1) ?? null, sentenceStart };
}

// "Dammi l'acqua." -> ["dammi", "l'", "acqua"]  (inglese: "I don't know" -> ["i", "don't", "know"])
function splitWords(text, apostropheInWord = false) {
  return text.toLowerCase().match(apostropheInWord ? /[^\s.,?!]+/g : /[^\s.,?!']+'?/g) ?? [];
}

// Parole proposte all'inizio di una frase, prima che la persona ne abbia scritte (di default
// italiane: la lingua in uso le passa nelle opzioni).
const STARTERS = ["ho", "vorrei", "puoi", "grazie", "non", "io", "sono", "mi"];

export class Predictor {
  // words: parole ordinate per frequenza; store: { load(), save(data) } per ciò che si impara;
  // options: { apostropheInWord, starters } dalla lingua in uso.
  constructor(words, store = null, { apostropheInWord = false, starters = STARTERS } = {}) {
    this.apostropheInWord = apostropheInWord;
    this.starters = starters;
    this.words = words;
    this.norm = words.map(normalize);
    this.rank = new Map(words.map((w, i) => [w, i]));
    this.store = store;
    const saved = store?.load();
    this.user = saved?.uni && saved?.bi ? saved : { uni: {}, bi: {} };
  }

  // Punteggio: frequenza generale (legge di Zipf) + uso personale + coppie di parole personali.
  score(word, prev) {
    const rank = this.rank.get(word) ?? this.words.length;
    const uni = this.user.uni[word] ?? 0;
    const bi = prev ? this.user.bi[prev]?.[word] ?? 0 : 0;
    return -Math.log(rank + 10) + 2 * Math.log1p(uni) + 4 * Math.log1p(bi);
  }

  suggest(text, n = 3) {
    const { partial, prev, sentenceStart } = context(text, this.apostropheInWord);
    let candidates;
    if (partial) {
      const p = normalize(partial);
      candidates = new Set();
      for (let i = 0; i < this.words.length; i++) {
        if (this.norm[i].startsWith(p)) candidates.add(this.words[i]);
      }
      for (const w of Object.keys(this.user.uni)) if (normalize(w).startsWith(p)) candidates.add(w);
      candidates.delete(partial.toLowerCase());
    } else {
      candidates = new Set([
        ...Object.keys(prev ? this.user.bi[prev] ?? {} : {}),
        ...Object.keys(this.user.uni),
        ...(sentenceStart ? this.starters : this.words.slice(0, 50)),
      ]);
    }
    return [...candidates]
      .map((w) => [w, this.score(w, prev)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([w]) => w);
  }

  // Impara da una frase pronunciata.
  learn(sentence) {
    const words = splitWords(sentence, this.apostropheInWord);
    let prev = null;
    for (const w of words) {
      this.user.uni[w] = (this.user.uni[w] ?? 0) + 1;
      if (prev) {
        this.user.bi[prev] ??= {};
        this.user.bi[prev][w] = (this.user.bi[prev][w] ?? 0) + 1;
      }
      prev = w;
    }
    this.store?.save(this.user);
  }
}
