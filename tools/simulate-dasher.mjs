// Simulatore della scrittura continua: uno "sguardo finto" scrive frasi di prova guardando
// sempre il riquadro della lettera che vuole, con l'errore tipico di una webcam (circa 100 px:
// uno spostamento di fondo per frase più il tremolio di ogni fotogramma). Confronta varianti di
// orientamento e movimento su lettere al minuto, frasi completate e cancellazioni.
//   node tools/simulate-dasher.mjs [ripetizioni]     (NOISE=0.5 node ... per metà errore)
import { readFileSync } from "node:fs";
import { Dasher, LetterModel } from "../js/dasher.js";

const words = readFileSync(new URL("../data/parole-it.txt", import.meta.url), "utf8").split(/\r?\n/).filter(Boolean);
const model = new LetterModel(words);

const SENTENCES = [
  "ho sete", "vorrei dell'acqua", "chiama mia figlia", "ho freddo ai piedi", "spegni la luce per favore",
  "grazie di tutto", "oggi mi sento meglio", "che ore sono", "voglio dormire", "puoi aprire la finestra",
];
const FPS = 30;
const TIMEOUT_S = 120;
const BIAS_PX = Number(process.env.NOISE ?? 1) * 55;   // spostamento di fondo dello sguardo stimato, per asse
const JITTER_PX = Number(process.env.NOISE ?? 1) * 45; // tremolio di ogni fotogramma, per asse (già smussato dal filtro)

function gaussian(rnd) {
  return Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
}

function writeSentence(variant, sentence, rnd) {
  const rect = { left: 0, top: 0, width: variant.W, height: variant.H };
  const canvas = { getBoundingClientRect: () => rect, getContext: () => ({ setTransform() {} }) };
  let text = "";
  let spoken = null;
  let deletions = 0;
  let gaze = null;
  const d = new Dasher(canvas, model, {
    getText: () => text,
    setText: (t) => { if (t.length < text.length) deletions++; text = t; },
    speak: () => { spoken = text; text = ""; },
    getGaze: () => gaze,
    isPaused: () => false,
  }, { orientation: variant.orientation, motion: variant.motion });
  d.speed = variant.speed ?? 1;
  d.resize();
  d.reset();
  const { S, F } = d.axes;
  const bias = [gaussian(rnd) * BIAS_PX, gaussian(rnd) * BIAS_PX];
  let jitter = [0, 0];
  for (let frame = 0; frame < TIMEOUT_S * FPS; frame++) {
    // Dove vuole guardare: la prossima lettera (in avanti) o, se ha sbagliato, indietro.
    // "Parla" compare solo a inizio parola: la frase si chiude con uno spazio e poi "Parla".
    const goal = sentence + " ";
    let s = S / 2, f = F * 0.85;
    if (!goal.startsWith(text)) f = F * 0.15;
    else {
      const span = d.symbolSpan(text === goal ? "\n" : goal[text.length]);
      if (span) s = Math.max(10, Math.min(S - 10, (Math.max(span[0], 0) + Math.min(span[1], S)) / 2));
    }
    jitter = jitter.map((j) => 0.6 * j + 0.4 * gaussian(rnd) * JITTER_PX);
    const [x, y] = variant.orientation === "horizontal" ? [s, F - f] : [f, s];
    gaze = { x: x + bias[0] + jitter[0], y: y + bias[1] + jitter[1] };
    d.step((frame * 1000) / FPS);
    if (spoken !== null) return { ok: spoken.trim() === sentence, seconds: frame / FPS, deletions };
  }
  return { ok: false, seconds: TIMEOUT_S, deletions };
}

const OLD = { anchor: 1, centerRate: 1.2, edgeBoost: 0 };
const NEW = { anchor: 0.5, centerRate: 2.5, edgeBoost: 1 };
// 537 px: altezza della scrittura continua con la barra in alto; 690 px: senza (schermo 1536x864).
const H = 690; // altezza senza la barra in alto (schermo 1536x864)
const VARIANTS = [
  { name: "verticale, vecchio (prima)", orientation: "vertical", motion: OLD, W: 1536, H: 537 },
  { name: "verticale, nuovo", orientation: "vertical", motion: NEW, W: 1536, H: 537 },
  { name: "orizzontale, vecchio", orientation: "horizontal", motion: OLD, W: 1536, H },
  { name: "orizzontale, nuovo", orientation: "horizontal", motion: NEW, W: 1536, H },
  { name: "orizzontale, nuovo senza spinta ai bordi", orientation: "horizontal", motion: { ...NEW, edgeBoost: 0 }, W: 1536, H },
  { name: "orizzontale, centratura 2.5 (zoom sullo sguardo)", orientation: "horizontal", motion: { anchor: 1, centerRate: 2.5, edgeBoost: 0 }, W: 1536, H },
];

const REPEATS = Number(process.argv[2] ?? 3);
console.log(`${"variante".padEnd(38)} completate  tempo medio  lettere/min  cancellazioni`);
for (const v of VARIANTS) {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let ok = 0, chars = 0, seconds = 0, deletions = 0, n = 0;
  for (let r = 0; r < REPEATS; r++) {
    for (const s of SENTENCES) {
      const res = writeSentence(v, s, rnd);
      n++;
      deletions += res.deletions;
      if (res.ok) { ok++; chars += s.length; seconds += res.seconds; }
    }
  }
  const cpm = seconds ? (chars / seconds) * 60 : 0;
  console.log(`${v.name.padEnd(38)} ${`${ok}/${n}`.padStart(10)}  ${(seconds / Math.max(ok, 1)).toFixed(1).padStart(9)} s  ${cpm.toFixed(1).padStart(11)}  ${(deletions / n).toFixed(1).padStart(13)}`);
}
