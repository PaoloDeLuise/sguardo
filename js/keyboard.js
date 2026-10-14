// Tastiera a due passaggi su griglia 3x4: prima si sceglie un gruppo di lettere, poi la lettera.
// Le celle restano grandi (circa 1/4 della larghezza e 1/3 dell'altezza): con l'errore
// tipico di una webcam (~100 px) la selezione resta affidabile.

const COLS = 4;
const ROWS = 3;
const BACK_INDEX = COLS * ROWS - 1; // "Indietro" sempre nell'angolo in basso a destra

// Lettere in ordine alfabetico (più facile da imparare), vocali accentate vicino alla vocale.
const GROUPS = [
  { label: "A B C D E", keys: ["A", "À", "B", "C", "D", "E", "È", "É"] },
  { label: "F G H I L", keys: ["F", "G", "H", "I", "Ì", "L"] },
  { label: "M N O P Q", keys: ["M", "N", "O", "Ò", "P", "Q"] },
  { label: "R S T U V", keys: ["R", "S", "T", "U", "Ù", "V"] },
  // Lettere rare e punteggiatura; da qui "123" apre i numeri.
  { label: "Z J K W X Y\n. , ? 123", keys: ["Z", "J", "K", "W", "X", "Y", "'", ".", ",", "?"], more: true },
];
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "!"];
const MORE_INDEX = 10;

// Cancella: una lettera; continuando a guardare, una parola intera ogni 1,5 s.
const DELETE_HOLD = { key: "cancella", repeatMs: 1500 };

// Frasi rapide per i bisogni. Sì e No negli angoli in alto: sono le posizioni più facili da raggiungere.
export const PHRASES = [
  { label: "Sì", say: "Sì" },
  { label: "Aiuto", say: "Ho bisogno di aiuto" },
  { label: "Acqua", say: "Vorrei dell'acqua" },
  { label: "No", say: "No" },
  { label: "Dolore", say: "Ho dolore" },
  { label: "Bagno", say: "Devo andare in bagno" },
  { label: "Girami", say: "Puoi girarmi, per favore?" },
  { label: "Grazie", say: "Grazie" },
  { label: "Caldo", say: "Ho caldo" },
  { label: "Freddo", say: "Ho freddo" },
];

// Prime voci di "Le mie frasi"; seguono quelle salvate dalla persona.
const MORE_PHRASES = [{ label: "Ti voglio bene", say: "Ti voglio bene" }];
export const DEFAULT_PHRASES = [...PHRASES, ...MORE_PHRASES];

const PER_PAGE = 8; // le altre 4 celle: salva, togli, pagina successiva, tastiera
const SAVE_INDEX = 8;
const REMOVE_INDEX = 9;
const NEXT_INDEX = 10;

const PUNCTUATION = new Set([".", ",", "?", "!"]);

export class Keyboard {
  // onChange(text) a ogni modifica del testo; onSpeak(text) per leggere ad alta voce.
  // phrases: { load(), save(list) } per le frasi salvate; onPhraseSaved(text) per prepararne la voce.
  constructor(board, predictor, { onChange, onSpeak, phrases, onPhraseSaved }) {
    this.board = board;
    this.predictor = predictor;
    this.onChange = onChange;
    this.onSpeak = onSpeak;
    this.phrasesStore = phrases;
    this.onPhraseSaved = onPhraseSaved;
    this.custom = phrases?.load() ?? [];
    this.lastSentence = null; // ultima frase scritta e letta: si può salvare tra le frasi
    this.text = "";
  }

  // Usato dalla scrittura continua, che condivide il testo con la tastiera.
  setText(text) {
    this.text = text;
    this.onChange(text);
  }

  showMain() {
    const s = this.predictor.suggest(this.text);
    const suggestion = (w) => w && { label: w, kind: "suggest", action: () => this.applySuggestion(w) };
    const group = (g) => ({ label: g.label, kind: "group", action: () => this.showGroup(g) });
    this.board.setLayout(COLS, ROWS, [
      suggestion(s[0]), suggestion(s[1]), suggestion(s[2]),
      // A testo vuoto "Parla" diventa "Ripeti": ridice l'ultima frase (es. se non è stata capita).
      this.text.trim() || !this.lastSentence
        ? { label: "Parla", kind: "cmd speak", action: () => this.speakText() }
        : { label: "Ripeti", kind: "cmd speak", action: () => this.onSpeak(this.lastSentence) },
      group(GROUPS[0]), group(GROUPS[1]), group(GROUPS[2]), group(GROUPS[3]),
      group(GROUPS[4]),
      { label: "Spazio", kind: "cmd", action: () => this.space() },
      { label: "Cancella", hint: "continua a guardare: parole intere", kind: "cmd", hold: DELETE_HOLD,
        action: (count = 1) => (count <= 1 ? this.backspace() : this.deleteWord()) },
      { label: "Frasi", kind: "cmd", action: () => this.showPhrases() },
    ]);
    this.onChange(this.text);
  }

  showGroup(g) {
    const items = g.keys.map((k) => ({ label: k, kind: "letter", action: () => this.type(k) }));
    if (g.more) items[MORE_INDEX] = { label: "123 ▸", kind: "cmd", action: () => this.showDigits() };
    items[BACK_INDEX] = { label: "Indietro", kind: "cmd", action: () => this.showMain() };
    this.board.setLayout(COLS, ROWS, items);
  }

  showDigits() {
    const items = DIGITS.map((k) => ({ label: k, kind: "letter", action: () => this.type(k) }));
    items[BACK_INDEX] = { label: "Indietro", kind: "cmd", action: () => this.showMain() };
    this.board.setLayout(COLS, ROWS, items);
  }

  showPhrases() {
    const items = PHRASES.map((p) => ({ label: p.label, kind: "phrase", action: () => this.onSpeak(p.say) }));
    items[NEXT_INDEX] = { label: "Le mie frasi ▸", kind: "cmd", action: () => this.showMyPhrases(0) };
    items[BACK_INDEX] = { label: "Tastiera", kind: "cmd", action: () => this.showMain() };
    this.board.setLayout(COLS, ROWS, items);
  }

  // "Le mie frasi": salvate dalla persona, a pagine di 8. Con removing si sceglie quale togliere.
  showMyPhrases(page, removing = false) {
    const list = removing
      ? this.custom.map((t) => ({ label: t, say: t }))
      : [...MORE_PHRASES, ...this.custom.map((t) => ({ label: t, say: t }))];
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    page %= pages;
    const items = list.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map((p) => removing
      ? { label: `✕ ${short(display(p.label))}`, kind: "cmd remove", action: () => { this.removePhrase(p.say); this.showMyPhrases(0, this.custom.length > 0); } }
      : { label: short(display(p.label)), kind: "phrase", action: () => this.onSpeak(p.say) });

    if (!removing) {
      const s = this.lastSentence;
      if (s && !this.custom.includes(s) && !DEFAULT_PHRASES.some((p) => p.say.toLowerCase() === s.toLowerCase())) {
        items[SAVE_INDEX] = { label: `Salva:\n«${short(display(s), 28)}»`, kind: "cmd save", action: () => this.savePhrase(s) };
      }
      if (this.custom.length) {
        items[REMOVE_INDEX] = { label: "Togli una frase", kind: "cmd", action: () => this.showMyPhrases(0, true) };
      }
    }
    items[NEXT_INDEX] = page < pages - 1
      ? { label: "Altre ▸", kind: "cmd", action: () => this.showMyPhrases(page + 1, removing) }
      : { label: "◂ Frasi", kind: "cmd", action: () => this.showPhrases() };
    items[BACK_INDEX] = removing
      ? { label: "Fine", kind: "cmd", action: () => this.showMyPhrases(0) }
      : { label: "Tastiera", kind: "cmd", action: () => this.showMain() };
    this.board.setLayout(COLS, ROWS, items);
  }

  savePhrase(text) {
    this.custom = [...this.custom, text];
    this.phrasesStore?.save(this.custom);
    this.onPhraseSaved?.(text);
    this.showMyPhrases(Math.ceil((MORE_PHRASES.length + this.custom.length) / PER_PAGE) - 1); // pagina dove è finita
  }

  removePhrase(text) {
    this.custom = this.custom.filter((t) => t !== text);
    this.phrasesStore?.save(this.custom);
  }

  type(key) {
    if (PUNCTUATION.has(key)) this.text = this.text.trimEnd() + key + " ";
    else this.text += key.toLowerCase();
    this.showMain();
  }

  space() {
    if (this.text && !this.text.endsWith(" ")) this.text += " ";
    this.showMain();
  }

  backspace() {
    this.text = this.text.slice(0, -1);
    this.showMain();
  }

  // L'ultima parola (con gli spazi dopo), oppure la punteggiatura finale.
  deleteWord() {
    this.text = this.text.replace(/\s+$/, "").replace(/(\S+|[.,?!])$/, "");
    this.showMain();
  }

  applySuggestion(word) {
    const partial = this.text.match(/[^\s'.,?!]*$/)[0];
    this.text = this.text.slice(0, this.text.length - partial.length) + word + (word.endsWith("'") ? "" : " ");
    this.showMain();
  }

  speakText() {
    const sentence = this.text.trim();
    if (!sentence) return;
    this.onSpeak(sentence);
    this.predictor.learn(sentence);
    this.lastSentence = sentence;
    this.text = "";
    this.showMain();
  }
}

function short(text, max = 40) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// Maiuscola a inizio frase, solo per la visualizzazione.
export function display(text) {
  return text.replace(/(^\s*|[.?!]\s+)(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}
