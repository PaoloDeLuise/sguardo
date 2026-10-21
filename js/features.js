// Caratteristiche dello sguardo a partire dai punti del viso. Non dipende da MediaPipe,
// così si può eseguire anche sulle registrazioni salvate (tools/evaluate.mjs).

// Indici della mesh a 478 punti. Gli angoli sono ordinati da sinistra a destra
// nell'immagine, così l'asse dell'occhio ha lo stesso verso per entrambi gli occhi.
const RIGHT_EYE = { a: 33, b: 133, top: 159, bottom: 145, iris: 468 };
const LEFT_EYE = { a: 362, b: 263, top: 386, bottom: 374, iris: 473 };

// Punti salvati nella registrazione di calibrazione, per analisi offline:
// iridi, contorni degli occhi e alcuni punti stabili del viso.
export const RAW_POINTS = [
  468, 469, 470, 471, 472, 473, 474, 475, 476, 477,
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
  362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398,
  1, 6, 10, 152, 168, 234, 454,
];

// Modalità di controllo del puntatore:
// - "eyes": solo lo sguardo (la testa resta ferma, la sua posa compensa i piccoli spostamenti);
// - "head": solo la testa, come un puntatore sul naso (orientamento e posizione del viso);
// - "both": occhi e testa insieme: la testa sposta in modo grossolano, gli occhi rifiniscono.
export const CONTROL_MODES = ["eyes", "head", "both"];
export const CONTROL_LABELS = { eyes: "occhi", head: "testa", both: "occhi + testa" };

// Come riconoscere che il puntatore è fermo (campioni di calibrazione): indici delle
// caratteristiche e deviazione standard massima su pochi fotogrammi. Misure sulle registrazioni:
// con l'occhio fermo la deviazione è ~0.001 (occhi) e ~0.002 (testa), in movimento molto di più.
export const STABILITY = {
  eyes: { indices: [0, 2], sd: 0.005 },
  head: { indices: [0, 1], sd: 0.004 },
  both: { indices: [0, 2], sd: 0.005 },
};

// Caratteristiche usate per scartare i campioni anomali di un punto di calibrazione.
export const CLEAN_INDICES = { eyes: [0, 2, 3], head: [0, 1], both: [0, 2, 3] };

// Occhi chiusi: battito (entrambi) oppure occhiolino (uno solo). Un occhiolino con l'occhio molto
// chiuso fa salire anche la media dei due, quindi non conta come battito.
export function eyeState(bs) {
  const l = bs.eyeBlinkLeft ?? 0, r = bs.eyeBlinkRight ?? 0;
  const wink = (l > 0.6 && r < 0.35) || (r > 0.6 && l < 0.35);
  return { wink, blink: !wink && (l + r) / 2 > 0.6 };
}

// P(i) -> {x, y} in pixel; bs: blendshape per nome; m: matrice 4x4 column-major (o null).
// La matrice è la posa del viso: m[8], m[9] sono la direzione verso cui guarda il viso (rotazione
// destra-sinistra e su-giù), m[12], m[13] la posizione del viso rispetto alla fotocamera.
export function gazeFeatures(P, bs, m, mode = "eyes") {
  if (mode === "head") return m ? [m[8], m[9], m[12], m[13]] : [0, 0, 0, 0];
  const eyes = eyeGazeFeatures(P, bs, m);
  return mode === "both" ? [...eyes, m ? m[12] : 0, m ? m[13] : 0] : eyes;
}

function eyeGazeFeatures(P, bs, m) {
  const r = eyeFeatures(P, RIGHT_EYE);
  const l = eyeFeatures(P, LEFT_EYE);
  const b = (name) => bs[name] ?? 0;

  // Il segnale verticale dell'iride è debole con una webcam: la palpebra superiore
  // (che segue lo sguardo verso il basso) e i blendshape degli occhi lo completano.
  // La posa della testa (terza colonna della matrice di rotazione) compensa i cambi
  // di postura, che spostano la palpebra a parità di sguardo.
  // Scelta confrontando le varianti su più registrazioni (vedi tools/evaluate.mjs).
  return [
    (r.h + l.h) / 2,
    (r.v + l.v) / 2,
    (r.top + l.top) / 2,
    (b("eyeLookOutLeft") + b("eyeLookInRight") - b("eyeLookInLeft") - b("eyeLookOutRight")) / 2,
    (b("eyeLookUpLeft") + b("eyeLookUpRight") - b("eyeLookDownLeft") - b("eyeLookDownRight")) / 2,
    m ? m[8] : 0,
    m ? m[9] : 0,
  ];
}

// Posizione dell'iride nel sistema di riferimento dell'occhio, normalizzata
// sulla larghezza dell'occhio: non dipende dalla distanza dalla fotocamera.
function eyeFeatures(P, e) {
  const a = P(e.a), b = P(e.b), iris = P(e.iris);
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  const ax = b.x - a.x, ay = b.y - a.y;
  const w = Math.hypot(ax, ay) || 1;
  const ux = ax / w, uy = ay / w; // lungo l'occhio
  const px = -uy, py = ux;        // perpendicolare (verso il basso)
  const dx = iris.x - cx, dy = iris.y - cy;
  // Distanza (con segno) delle palpebre dalla linea degli angoli dell'occhio.
  const lid = (q) => ((q.x - cx) * px + (q.y - cy) * py) / w;
  return {
    h: (dx * ux + dy * uy) / w,
    v: (dx * px + dy * py) / w,
    top: lid(P(e.top)),
    bottom: lid(P(e.bottom)),
  };
}
