// Simulatore della selezione a fissazione: uno "sguardo finto" mira al centro di una cella a
// caso con l'errore tipico di una webcam (uno spostamento di fondo per tentativo più il tremolio
// di ogni fotogramma). Confronta il metodo attuale ("classic") con l'accumulo di prove.
//   node tools/simulate-dwell.mjs [tentativi]
import { DwellSelector } from "../js/dwell.js";

const FPS = 30;
const DWELL_MS = 1000;
const TIMEOUT_MS = 8000;
const BIAS_PX = 55;   // come in tools/simulate-dasher.mjs
const JITTER_PX = 45;

// Griglie 4x3 come nella pagina: PC 1536x864 (area celle 1536x728) e telefono in orizzontale
// 915x412 (barra compatta: area celle 915x368).
const SCREENS = [
  { name: "PC", W: 1536, H: 728, gap: 12 },
  { name: "telefono", W: 915, H: 368, gap: 6 },
];

function grid({ W, H, gap }, cols = 4, rows = 3) {
  const cw = (W - gap * (cols + 1)) / cols, ch = (H - gap * (rows + 1)) / rows;
  const rects = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const left = gap + c * (cw + gap), top = gap + r * (ch + gap);
    rects.push({ left, top, right: left + cw, bottom: top + ch });
  }
  return rects;
}

function gaussian(rnd) {
  return Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
}

function trial(selector, rects, target, rnd, noise) {
  selector.reset();
  const r = rects[target];
  // si guarda la scritta al centro della cella, con un piccolo scarto
  const aim = { x: (r.left + r.right) / 2 + (rnd() - 0.5) * 0.2 * (r.right - r.left), y: (r.top + r.bottom) / 2 + (rnd() - 0.5) * 0.2 * (r.bottom - r.top) };
  const bias = [gaussian(rnd) * BIAS_PX * noise, gaussian(rnd) * BIAS_PX * noise];
  let jitter = [0, 0];
  const dt = 1000 / FPS;
  for (let t = 0; t < TIMEOUT_MS; t += dt) {
    jitter = jitter.map((j) => 0.6 * j + 0.4 * gaussian(rnd) * JITTER_PX * noise);
    const gaze = { x: aim.x + bias[0] + jitter[0], y: aim.y + bias[1] + jitter[1] };
    const { selected } = selector.update(rects, gaze, dt, () => DWELL_MS);
    if (selected !== null) return { selected, ms: t + dt };
  }
  return { selected: null, ms: TIMEOUT_MS };
}

const VARIANTS = [
  { name: "attuale (margine 10%)", options: { method: "classic" } },
  { name: "cronometro, margine 25%", options: { method: "classic", hysteresis: 0.25 } },
  { name: "cronometro, margine 40%", options: { method: "classic", hysteresis: 0.4 } },
  { name: "accumulo, sigma 60, calo 0.25", options: { method: "accumulate", sigmaPx: 60, decay: 0.25 } },
  { name: "accumulo normaliz., sigma 40, calo 0.5", options: { method: "accumulate", normalize: true, sigmaPx: 40, decay: 0.5 } },
  { name: "accumulo normaliz., sigma 60, calo 0.5", options: { method: "accumulate", normalize: true, sigmaPx: 60, decay: 0.5 } },
  { name: "accumulo normaliz., sigma 60, calo 1", options: { method: "accumulate", normalize: true, sigmaPx: 60, decay: 1 } },
  { name: "accumulo normaliz., sigma 90, calo 1", options: { method: "accumulate", normalize: true, sigmaPx: 90, decay: 1 } },
];

const TRIALS = Number(process.argv[2] ?? 400);
for (const noise of [1, 1.5]) {
  for (const screen of SCREENS) {
    const rects = grid(screen);
    console.log(`\n${screen.name}, errore x${noise}           giusta   sbagliata   nessuna   tempo medio (giuste)`);
    for (const v of VARIANTS) {
      let seed = 4242;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const sel = new DwellSelector(v.options);
      let ok = 0, wrong = 0, none = 0, ms = 0;
      for (let i = 0; i < TRIALS; i++) {
        const target = Math.floor(rnd() * rects.length);
        const res = trial(sel, rects, target, rnd, noise);
        if (res.selected === null) none++;
        else if (res.selected === target) { ok++; ms += res.ms; }
        else wrong++;
      }
      const pct = (n) => `${((n / TRIALS) * 100).toFixed(0)}%`.padStart(6);
      console.log(`  ${v.name.padEnd(36)} ${pct(ok)}  ${pct(wrong)}     ${pct(none)}     ${(ms / Math.max(ok, 1) / 1000).toFixed(2)} s`);
    }
  }
}
