// Regressione ridge: dalle caratteristiche dell'occhio alla posizione sullo schermo (0..1).

// Termini quadratici: ai bordi la relazione tra occhio (o testa) e schermo non è lineare.
// mode: "eyes" | "head" | "both" (vedi features.js). Con la sola testa i primi due valori sono
// la rotazione destra-sinistra e su-giù; con gli occhi, il quinto è il segnale verticale.
export function expand(f, mode = "eyes") {
  if (mode === "head") {
    const [yaw, pitch] = f;
    return [...f, yaw * yaw, pitch * pitch, yaw * pitch];
  }
  const [h, , , , bsV] = f;
  return [...f, h * h, bsV * bsV, h * bsV];
}

// Variazione minima, per colonna, sotto cui una caratteristica non viene amplificata (la ridge
// standardizza le colonne: una che varia pochissimo diventerebbe grande come le altre e il
// modello si adatterebbe alla sua deriva lenta). Misurato sulle registrazioni, a testa ferma:
// "occhi + testa" con la posizione della testa standardizzata peggiora (215 px contro 129 px
// degli occhi da soli); con questi limiti torna uguale agli occhi. Un movimento vero della testa
// supera i limiti (rotazione ±0.15 e posizione ±2.5 unità, contro 0.01 e 0.3 a testa ferma).
// Colonne come in expand(): caratteristiche, poi i tre termini quadratici.
const HEAD_ROTATION = 0.05;  // seno dell'angolo del viso: ~3 gradi
const HEAD_POSITION = 1;     // unità della matrice di posa del viso
export function minStd(mode) {
  const R = HEAD_ROTATION, T = HEAD_POSITION;
  if (mode === "head") return [R, R, T, T, R * R, R * R, R * R];
  if (mode === "both") return [0, 0, 0, 0, 0, R, R, T, T, 0, 0, 0];
  return null; // occhi: come validato, nessun limite
}

// weights: peso di ogni esempio (facoltativo, 1 = normale). floor: minStd(mode).
export function fitRidge(X, Y, lambdaPerSample = 0.03, weights = null, floor = null) {
  const n = X.length;
  const d = X[0].length;

  // Media, deviazione e regolarizzazione pesate: gli esempi con peso ~0 non devono contare.
  const w = (k) => (weights ? weights[k] : 1);
  const total = weights ? weights.reduce((s, v) => s + v, 0) : n;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  X.forEach((row, k) => row.forEach((x, j) => (mean[j] += (w(k) * x) / total)));
  X.forEach((row, k) => row.forEach((x, j) => (std[j] += (w(k) * (x - mean[j]) ** 2) / total)));
  for (let j = 0; j < d; j++) std[j] = Math.max(Math.sqrt(std[j]) || 1, floor?.[j] ?? 0);

  const D = d + 1;
  const A = Array.from({ length: D }, () => new Array(D).fill(0));
  const bx = new Array(D).fill(0);
  const by = new Array(D).fill(0);

  X.forEach((row, k) => {
    const z = standardize(row, mean, std);
    const wk = w(k);
    for (let i = 0; i < D; i++) {
      bx[i] += wk * z[i] * Y[k][0];
      by[i] += wk * z[i] * Y[k][1];
      for (let j = 0; j < D; j++) A[i][j] += wk * z[i] * z[j];
    }
  });
  // Il termine costante (indice 0) non viene regolarizzato.
  for (let i = 1; i < D; i++) A[i][i] += lambdaPerSample * total;

  return { mean, std, wx: solve(A, bx), wy: solve(A, by) };
}

export function predict(model, f) {
  const z = standardize(expand(f, model.mode), model.mean, model.std);
  let x = 0, y = 0;
  for (let i = 0; i < z.length; i++) {
    x += z[i] * model.wx[i];
    y += z[i] * model.wy[i];
  }
  return [x, y];
}

// Correzione rapida dopo un cambio di postura: una trasformazione affine
// (spostamento, scala, inclinazione) dalla stima del modello alla posizione vera,
// calcolata su pochi punti. Leggermente trattenuta verso "nessuna correzione".
// pairs: [[[xStimato, yStimato], [xVero, yVero]], ...]
export function fitAffine(pairs, strength = 0.01) {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const bx = [0, 0, 0], by = [0, 0, 0];
  for (const [[px, py], [tx, ty]] of pairs) {
    const z = [1, px, py];
    for (let i = 0; i < 3; i++) {
      bx[i] += z[i] * tx;
      by[i] += z[i] * ty;
      for (let j = 0; j < 3; j++) A[i][j] += z[i] * z[j];
    }
  }
  const mu = strength * pairs.length;
  for (let i = 0; i < 3; i++) A[i][i] += mu;
  bx[1] += mu; // identità: x' = x
  by[2] += mu; //           y' = y
  return { ax: solve(A, bx), ay: solve(A, by) };
}

export function applyAffine(c, [x, y]) {
  if (!c) return [x, y];
  return [c.ax[0] + c.ax[1] * x + c.ax[2] * y, c.ay[0] + c.ay[1] * x + c.ay[2] * y];
}

function standardize(row, mean, std) {
  return [1, ...row.map((x, j) => (x - mean[j]) / std[j])];
}

// Eliminazione di Gauss con pivot parziale.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / piv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}
