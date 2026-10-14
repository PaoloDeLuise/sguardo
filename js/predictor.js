// Suggerimento delle parole: frequenze dell'italiano parlato (data/parole-it.txt)
// più quello che la persona scrive davvero, che col tempo pesa di più.

// "perche" trova "perché": il confronto ignora accenti e maiuscole.
export function normalize(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Parola in corso di scrittura e parola precedente, dato il testo.
// L'apostrofo chiude una parola: in "l'acqua" la parola in corso è "acqua", la precedente "l'".
export function context(text) {
  const partial = text.match(/[^\s'.,?!]*$/)[0];
  const before = text.slice(0, text.length - partial.length);
  const words = splitWords(before);
  const sentenceStart = /^\s*$|[.?!]\s*$/.test(before);
  return { partial, prev: sentenceStart ? null : words.at(-1) ?? null, sentenceStart };
}

// "Dammi l'acqua." -> ["dammi", "l'", "acqua"]
function splitWords(text) {
  return text.toLowerCase().match(/[^\s.,?!']+'?/g) ?? [];
}

// Parole proposte all'inizio di una frase, prima che la persona ne abbia scritte.
const STARTERS = ["ho", "vorrei", "puoi", "grazie", "non", "io", "sono", "mi"];

export class Predictor {
  // words: parole ordinate per frequenza; store: { load(), save(data) } per ciò che si impara.
  constructor(words, store = null) {
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
    const { partial, prev, sentenceStart } = context(text);
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
        ...(sentenceStart ? STARTERS : this.words.slice(0, 50)),
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
    const words = splitWords(sentence);
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
