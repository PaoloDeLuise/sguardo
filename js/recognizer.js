// Riconoscimento di lettere disegnate, leggero: nessun modello da scaricare, gira su qualsiasi PC.
//
// Si confronta il disegno con modelli di lettere (scheletri di tratti) con il metodo $P
// (Vatavu, Anthony e Wobbrock, 2012): ogni disegno diventa una nuvola di 32 punti, indifferente
// a ordine e direzione dei tratti e alla grandezza. Poi il linguaggio corregge le ambiguità:
// dopo "cas" una A è molto più probabile di una R, anche se il disegno somiglia a entrambe.
// Le lettere scelte a mano tra le alternative diventano modelli personali (vedi addPersonal).
//
// Riconosce una lettera alla volta. Le parole intere no: i suggerimenti le completano dopo
// una o due lettere.

export const N_POINTS = 32;
// tau: quanto pesa la distanza dal modello rispetto al linguaggio (più piccolo = conta di più il
// disegno); language: peso del linguaggio. Scelti con tools/test-recognizer.mjs.
export const TUNING = { tau: 0.015, language: 1 };
const MIN_PRIOR = 1e-3;
const MAX_PERSONAL = 6;  // modelli personali per lettera: i più vecchi escono

const rad = (deg) => (deg * Math.PI) / 180;
// Arco di ellisse (angoli in gradi, y verso il basso: 0 = destra, 90 = basso, -90 = alto).
function arc(cx, cy, rx, ry, a0, a1, steps = 12) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = rad(a0 + ((a1 - a0) * i) / steps);
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
  });
}
const join = (...parts) => parts.flat();
const bowl = (top, bottom) => join(arc(0.4, (top + bottom) / 2, 0.25, (bottom - top) / 2, -90, 90, 10)); // pancia di P, B, R, D

// Lettere in un riquadro alto 1 e largo circa 0.6–0.8. Ogni lettera ha uno o più modi di scriverla.
export const LETTER_SHAPES = {
  A: [[[[0, 1], [0.35, 0], [0.7, 1]], [[0.12, 0.65], [0.58, 0.65]]], [[[0, 1], [0.35, 0], [0.7, 1]]]],
  B: [[[[0, 1], [0, 0]], join([[0, 0], [0.4, 0]], bowl(0, 0.5), [[0, 0.5], [0.45, 0.5]], bowl(0.5, 1).map(([x, y]) => [x + 0.05, y]), [[0, 1]])]],
  C: [[arc(0.4, 0.5, 0.4, 0.5, -40, -320, 16)]],
  D: [[[[0, 0], [0, 1]], join([[0, 0], [0.3, 0]], arc(0.3, 0.5, 0.4, 0.5, -90, 90, 14), [[0, 1]])]],
  E: [[[[0.65, 0], [0, 0], [0, 1], [0.65, 1]], [[0, 0.5], [0.5, 0.5]]]],
  F: [[[[0.65, 0], [0, 0], [0, 1]], [[0, 0.5], [0.5, 0.5]]]],
  G: [[join(arc(0.4, 0.5, 0.4, 0.5, -40, -360, 18), [[0.4, 0.5]])]],
  H: [[[[0, 0], [0, 1]], [[0.65, 0], [0.65, 1]], [[0, 0.5], [0.65, 0.5]]]],
  I: [[[[0, 0], [0, 1]]], [[[-0.2, 0], [0.2, 0]], [[0, 0], [0, 1]], [[-0.2, 1], [0.2, 1]]]],
  J: [[join([[0.5, 0], [0.5, 0.75]], arc(0.25, 0.75, 0.25, 0.25, 0, 180, 8))]],
  K: [[[[0, 0], [0, 1]], [[0.65, 0], [0, 0.55], [0.7, 1]]]],
  L: [[[[0, 0], [0, 1], [0.6, 1]]]],
  M: [[[[0, 1], [0, 0], [0.4, 0.6], [0.8, 0], [0.8, 1]]]],
  N: [[[[0, 1], [0, 0], [0.65, 1], [0.65, 0]]]],
  O: [[arc(0.35, 0.5, 0.35, 0.5, 0, 360, 20)]],
  P: [[[[0, 1], [0, 0], [0.4, 0]], bowl(0, 0.5).concat([[0, 0.5]])]],
  Q: [[arc(0.35, 0.5, 0.35, 0.5, 0, 360, 20), [[0.4, 0.65], [0.75, 1]]]],
  R: [[[[0, 1], [0, 0], [0.4, 0]], bowl(0, 0.5).concat([[0, 0.5]]), [[0.3, 0.5], [0.65, 1]]]],
  S: [[join(arc(0.32, 0.25, 0.28, 0.25, -30, -270, 12), arc(0.32, 0.75, 0.28, 0.25, -90, 150, 12))]],
  T: [[[[0, 0], [0.7, 0]], [[0.35, 0], [0.35, 1]]]],
  U: [[join([[0, 0], [0, 0.7]], arc(0.3, 0.7, 0.3, 0.3, 180, 0, 10), [[0.6, 0]])], [[[0, 0], [0, 1], [0.6, 1], [0.6, 0]]]],
  V: [[[[0, 0], [0.35, 1], [0.7, 0]]]],
  W: [[[[0, 0], [0.2, 1], [0.4, 0.35], [0.6, 1], [0.8, 0]]]],
  X: [[[[0, 0], [0.65, 1]], [[0.65, 0], [0, 1]]]],
  Y: [[[[0, 0], [0.35, 0.5], [0.7, 0]], [[0.35, 0.5], [0.35, 1]]]],
  Z: [[[[0, 0], [0.65, 0], [0, 1], [0.65, 1]]]],
};

const ACCENT_BASE = { à: "a", è: "e", é: "e", ì: "i", ò: "o", ù: "u" };

// Probabilità delle 26 lettere dopo il testo scritto: dai figli di LetterModel.children(testo).
// Le vocali accentate contano come la loro vocale (il disegno non distingue gli accenti).
export function priorFromChildren(children) {
  const p = Object.fromEntries(Object.keys(LETTER_SHAPES).map((c) => [c, 0]));
  for (const { sym, start, end } of children) {
    const base = (ACCENT_BASE[sym] ?? sym).toUpperCase();
    if (base in p) p[base] += end - start;
  }
  const total = Object.values(p).reduce((a, b) => a + b, 0) || 1;
  for (const c in p) p[c] = Math.max(MIN_PRIOR, p[c] / total);
  return p;
}

// ---------- nuvola di punti ----------

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Punti a distanza uguale lungo il tratto: prima di levigare, così la levigatura arrotonda gli
// angoli allo stesso modo nei disegni (punti fitti o radi) e nei modelli (pochi angoli).
function densify(s, spacing) {
  const out = [s[0]];
  for (let i = 1; i < s.length; i++) {
    const d = dist(s[i - 1], s[i]);
    const k = Math.max(1, Math.round(d / spacing));
    for (let j = 1; j <= k; j++) out.push([s[i - 1][0] + ((s[i][0] - s[i - 1][0]) * j) / k, s[i - 1][1] + ((s[i][1] - s[i - 1][1]) * j) / k]);
  }
  return out;
}

// Media mobile su 3 punti (estremi fissi): toglie il tremolio del puntatore senza arrotondare troppo.
function smooth(s) {
  if (s.length < 3) return s;
  return s.map((p, i) => (i === 0 || i === s.length - 1 ? p : [(s[i - 1][0] + p[0] + s[i + 1][0]) / 3, (s[i - 1][1] + p[1] + s[i + 1][1]) / 3]));
}

// $P: ricampiona su n punti a distanza uguale lungo i tratti (senza contare i salti tra un tratto
// e il successivo), poi porta il centro in (0, 0) e la dimensione maggiore a 1.
export function toCloud(strokes, n = N_POINTS) {
  const pts = [];
  const length = strokes.reduce((t, s) => t + s.slice(1).reduce((u, p, i) => u + dist(s[i], p), 0), 0);
  if (!(length > 0)) return null;
  strokes.forEach((s, id) => { for (const p of smooth(densify(s, length / 150))) pts.push({ x: p[0], y: p[1], id }); });
  if (pts.length < 2) return null;
  let total = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].id === pts[i - 1].id) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (total === 0) return null;

  const step = total / (n - 1);
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].id !== pts[i - 1].id) { out.push(pts[i]); continue; }
    let prev = pts[i - 1];
    let d = Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y);
    while (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      prev = { x: prev.x + t * (pts[i].x - prev.x), y: prev.y + t * (pts[i].y - prev.y), id: pts[i].id };
      out.push(prev);
      d = Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y);
      acc = 0;
    }
    acc += d;
  }
  while (out.length < n) out.push(out.at(-1));
  out.length = n;

  const xs = out.map((p) => p.x), ys = out.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const size = Math.max(w, h);
  if (size === 0) return null;
  const cx = xs.reduce((a, b) => a + b, 0) / n, cy = ys.reduce((a, b) => a + b, 0) / n;
  return out.map((p) => [(p.x - cx) / size, (p.y - cy) / size]);
}

function cloudDistance(a, b, start) {
  const n = a.length;
  const matched = new Array(n).fill(false);
  let sum = 0;
  let i = start;
  do {
    let best = -1, min = Infinity;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const d = dist(a[i], b[j]);
      if (d < min) { min = d; best = j; }
    }
    matched[best] = true;
    sum += (1 - ((i - start + n) % n) / n) * min;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

// Distanza media tra i punti (in lunghezze della lettera): 0.05 quasi uguali, 0.25 molto diverse.
function greedyMatch(a, b) {
  const n = a.length;
  const step = Math.max(1, Math.floor(Math.sqrt(n)));
  let min = Infinity;
  for (let i = 0; i < n; i += step) min = Math.min(min, cloudDistance(a, b, i), cloudDistance(b, a, i));
  return min / (n / 2);
}

// ---------- modelli ----------

const builtIn = Object.entries(LETTER_SHAPES).flatMap(([ch, variants]) =>
  variants.map((strokes) => ({ ch, cloud: toCloud(strokes) })));

// Un disegno di cui si è sicuri (la lettera scelta a mano tra le alternative) diventa un modello
// personale. personal: { A: [nuvola, ...] }, modificato qui e da salvare a cura di chi chiama.
export function addPersonal(personal, ch, strokes) {
  const cloud = toCloud(strokes);
  if (!cloud) return false;
  const list = (personal[ch] ??= []);
  list.push(cloud.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]));
  if (list.length > MAX_PERSONAL) list.shift();
  return true;
}

// Disegno (tratti di punti [x, y]) -> lettere in ordine di probabilità, o null se il segno è
// troppo piccolo. prior: probabilità delle lettere (priorFromChildren), senza = tutte uguali.
// Ogni voce: { ch, distance, score }, score più basso = migliore.
export function recognize(strokes, { prior = null, personal = {} } = {}) {
  const cloud = toCloud(strokes.filter((s) => s.length > 1));
  if (!cloud) return null;
  const best = {};
  const consider = (ch, c) => {
    const d = greedyMatch(cloud, c);
    if (!(ch in best) || d < best[ch]) best[ch] = d;
  };
  for (const { ch, cloud: c } of builtIn) consider(ch, c);
  for (const [ch, list] of Object.entries(personal)) for (const c of list) consider(ch, c);
  return Object.entries(best)
    .map(([ch, distance]) => ({ ch, distance, score: distance / TUNING.tau - TUNING.language * Math.log(prior?.[ch] ?? 1 / 26) }))
    .sort((a, b) => a.score - b.score);
}

// Per i controlli di dimensione minima: diagonale del riquadro che contiene i tratti.
export function inkSize(strokes) {
  const pts = strokes.flat();
  if (!pts.length) return 0;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}
