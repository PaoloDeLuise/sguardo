// Tastiera a due passaggi su griglia 3x4: prima si sceglie un gruppo di lettere, poi la lettera.
// Le celle restano grandi (circa 1/4 della larghezza e 1/3 dell'altezza): con l'errore
// tipico di una webcam (~100 px) la selezione resta affidabile.
// Gruppi di lettere, frasi rapide e testi dipendono dalla lingua (js/locales/).

import { locale, t } from "./i18n.js";
import { context } from "./predictor.js";

const COLS = 4;
const ROWS = 3;
const BACK_INDEX = COLS * ROWS - 1; // "Indietro" sempre nell'angolo in basso a destra
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "!"];
const MORE_INDEX = 10;

// Cancella: una lettera; continuando a guardare, una parola intera ogni 1,5 s.
const DELETE_HOLD = { key: "cancella", repeatMs: 1500 };

const PER_PAGE = 8; // le altre 4 celle: salva, togli, pagina successiva, tastiera
const SAVE_INDEX = 8;
const REMOVE_INDEX = 9;
const NEXT_INDEX = 10;

const PUNCTUATION = new Set([".", ",", "?", "!"]);

// Frasi rapide per i bisogni, nella lingua in uso. Le prime voci di "Le mie frasi" seguono.
export const quickPhrases = () => locale().phrases;
export const morePhrases = () => locale().morePhrases;
export const defaultPhrases = () => [...quickPhrases(), ...morePhrases()];

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
    const groups = locale().keyboard.groups;
    const suggestion = (w) => w && { label: w, kind: "suggest", action: () => this.applySuggestion(w) };
    const group = (g) => ({ label: g.label, kind: "group", action: () => this.showGroup(g) });
    this.board.setLayout(COLS, ROWS, [
      suggestion(s[0]), suggestion(s[1]), suggestion(s[2]),
      // A testo vuoto "Parla" diventa "Ripeti": ridice l'ultima frase (es. se non è stata capita).
      this.text.trim() || !this.lastSentence
        ? { label: t("kb.speak"), kind: "cmd speak", action: () => this.speakText() }
        : { label: t("kb.repeat"), kind: "cmd speak", action: () => this.onSpeak(this.lastSentence) },
      group(groups[0]), group(groups[1]), group(groups[2]), group(groups[3]),
      group(groups[4]),
      { label: t("kb.space"), kind: "cmd", action: () => this.space() },
      { label: t("kb.delete"), hint: t("kb.deleteHint"), kind: "cmd", hold: DELETE_HOLD,
        action: (count = 1) => (count <= 1 ? this.backspace() : this.deleteWord()) },
      { label: t("kb.phrases"), kind: "cmd", action: () => this.showPhrases() },
    ]);
    this.onChange(this.text);
  }

  showGroup(g) {
    const items = g.keys.map((k) => ({ label: k, kind: "letter", action: () => this.type(k) }));
    if (g.more) items[MORE_INDEX] = { label: t("kb.digits"), kind: "cmd", action: () => this.showDigits() };
    items[BACK_INDEX] = { label: t("kb.back"), kind: "cmd", action: () => this.showMain() };
    this.board.setLayout(COLS, ROWS, items);
  }

  showDigits() {
    const items = DIGITS.map((k) => ({ label: k, kind: "letter", action: () => this.type(k) }));
    items[BACK_INDEX] = { label: t("kb.back"), kind: "cmd", action: () => this.showMain() };
    this.board.setLayout(COLS, ROWS, items);
  }

  showPhrases() {
    const items = quickPhrases().map((p) => ({ label: p.label, kind: "phrase", action: () => this.onSpeak(p.say) }));
    items[NEXT_INDEX] = { label: t("kb.myPhrases"), kind: "cmd", action: () => this.showMyPhrases(0) };
    items[BACK_INDEX] = { label: t("kb.keyboard"), kind: "cmd", action: () => this.showMain() };
    this.board.setLayout(COLS, ROWS, items);
  }

  // "Le mie frasi": salvate dalla persona, a pagine di 8. Con removing si sceglie quale togliere.
  showMyPhrases(page, removing = false) {
    const more = morePhrases();
    const list = removing
      ? this.custom.map((p) => ({ label: p, say: p }))
      : [...more, ...this.custom.map((p) => ({ label: p, say: p }))];
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    page %= pages;
    const items = list.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map((p) => removing
      ? { label: `✕ ${short(display(p.label))}`, kind: "cmd remove", action: () => { this.removePhrase(p.say); this.showMyPhrases(0, this.custom.length > 0); } }
      : { label: short(display(p.label)), kind: "phrase", action: () => this.onSpeak(p.say) });

    if (!removing) {
      const s = this.lastSentence;
      if (s && !this.custom.includes(s) && !defaultPhrases().some((p) => p.say.toLowerCase() === s.toLowerCase())) {
        items[SAVE_INDEX] = { label: t("kb.save", { s: short(display(s), 28) }), kind: "cmd save", action: () => this.savePhrase(s) };
      }
      if (this.custom.length) {
        items[REMOVE_INDEX] = { label: t("kb.removePhrase"), kind: "cmd", action: () => this.showMyPhrases(0, true) };
      }
    }
    items[NEXT_INDEX] = page < pages - 1
      ? { label: t("kb.more"), kind: "cmd", action: () => this.showMyPhrases(page + 1, removing) }
      : { label: t("kb.backPhrases"), kind: "cmd", action: () => this.showPhrases() };
    items[BACK_INDEX] = removing
      ? { label: t("kb.done"), kind: "cmd", action: () => this.showMyPhrases(0) }
      : { label: t("kb.keyboard"), kind: "cmd", action: () => this.showMain() };
    this.board.setLayout(COLS, ROWS, items);
  }

  savePhrase(text) {
    this.custom = [...this.custom, text];
    this.phrasesStore?.save(this.custom);
    this.onPhraseSaved?.(text);
    this.showMyPhrases(Math.ceil((morePhrases().length + this.custom.length) / PER_PAGE) - 1); // pagina dove è finita
  }

  removePhrase(text) {
    this.custom = this.custom.filter((p) => p !== text);
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
    const { partial } = context(this.text, locale().apostropheInWord);
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
