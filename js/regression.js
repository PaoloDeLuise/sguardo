// Regressione ridge: dalle caratteristiche dell'occhio alla posizione sullo schermo (0..1).

// Termini quadratici: ai bordi la relazione tra occhio e schermo non è lineare.
export function expand(f) {
  const [h, , , , bsV] = f;
  return [...f, h * h, bsV * bsV, h * bsV];
}

export function fitRidge(X, Y, lambdaPerSample = 0.03) {
  const n = X.length;
  const d = X[0].length;

  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const row of X) row.forEach((x, j) => (mean[j] += x / n));
  for (const row of X) row.forEach((x, j) => (std[j] += (x - mean[j]) ** 2 / n));
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;

  const D = d + 1;
  const A = Array.from({ length: D }, () => new Array(D).fill(0));
  const bx = new Array(D).fill(0);
  const by = new Array(D).fill(0);

  X.forEach((row, k) => {
    const z = standardize(row, mean, std);
    for (let i = 0; i < D; i++) {
      bx[i] += z[i] * Y[k][0];
      by[i] += z[i] * Y[k][1];
      for (let j = 0; j < D; j++) A[i][j] += z[i] * z[j];
    }
  });
  // Il termine costante (indice 0) non viene regolarizzato.
  for (let i = 1; i < D; i++) A[i][i] += lambdaPerSample * n;

  return { mean, std, wx: solve(A, bx), wy: solve(A, by) };
}

export function predict(model, f) {
  const z = standardize(expand(f), model.mean, model.std);
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
