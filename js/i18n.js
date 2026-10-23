// Lingue dell'interfaccia. Una lingua è un file in js/locales/ (testi dell'interfaccia, frasi
// rapide, tastiera, codici della voce) più un elenco di parole per frequenza in data/.
// Per aggiungerne una: copiare js/locales/en.js, tradurre, registrarla qui sotto.
//
// t("chiave", { variabile: valore }) restituisce il testo nella lingua scelta. Nei testi {nome} è
// sostituito dalla variabile; un testo può essere anche una funzione (vars) => stringa, per i
// plurali. Se una chiave manca nella lingua scelta si usa l'italiano (la lingua di partenza).
import it from "./locales/it.js";
import en from "./locales/en.js";
import es from "./locales/es.js";
import fr from "./locales/fr.js";
import de from "./locales/de.js";
import pt from "./locales/pt.js";

export const LOCALES = { it, en, es, fr, de, pt };
export const FALLBACK_LANG = "en"; // lingua del browser non disponibile

let current = it;

// Lingua di partenza: quella salvata, altrimenti la prima del browser che esiste, altrimenti l'inglese.
export function detectLanguage(saved, preferred = globalThis.navigator?.languages ?? []) {
  if (saved && saved in LOCALES) return saved;
  for (const tag of preferred) {
    const code = String(tag).toLowerCase().split("-")[0];
    if (code in LOCALES) return code;
  }
  return FALLBACK_LANG;
}

export function setLanguage(code) {
  current = LOCALES[code] ?? LOCALES[FALLBACK_LANG];
  if (globalThis.document) document.documentElement.lang = current.code;
  return current;
}

// La lingua in uso: codici per la voce, tastiera, frasi, regole delle parole.
export function locale() { return current; }

export function t(key, vars = {}) {
  const value = current.ui[key] ?? it.ui[key];
  if (value === undefined) return key;
  if (typeof value === "function") return value(vars);
  return value.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? vars[name] : `{${name}}`));
}

// Testi della pagina fissa: gli elementi con data-i18n (testo), data-i18n-html (testo con
// collegamenti; i testi sono scritti da noi, mai dati dell'utente), data-i18n-title, data-i18n-aria
// e data-i18n-value. Il contenuto scritto nell'HTML è l'italiano, così la pagina ha un senso anche
// prima che parta lo script.
export function translatePage(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll("[data-i18n-value]")) el.value = t(el.dataset.i18nValue);
}
