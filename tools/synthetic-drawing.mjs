// Disegni sintetici di lettere: i modelli di recognizer.js deformati (proporzioni, inclinazione,
// tremolio lento e veloce, punti a intervalli irregolari). Usato da test-recognizer e test-words.
import { LETTER_SHAPES } from "../js/recognizer.js";

let seed = 7;
export const setSeed = (n) => { seed = n; };
export const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
export const between = (a, b) => a + (b - a) * rnd();

// Disegno "a mano" di una lettera: sceglie un modo di scriverla e lo deforma.
// noise: grandezza del disturbo in lunghezze della lettera (0.05 = 5% dell'altezza).
export function draw(ch, noise) {
  const variants = LETTER_SHAPES[ch];
  const strokes = variants[Math.floor(rnd() * variants.length)];
  const sx = between(0.75, 1.35), shear = between(-0.15, 0.15), rot = between(-0.2, 0.2);
  const phase = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
  const out = strokes.map((s) => {
    // punti a intervalli irregolari lungo il tratto (il puntatore va a scatti)
    const m = Math.floor(between(25, 70));
    const lens = [0];
    for (let i = 1; i < s.length; i++) lens.push(lens[i - 1] + Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]));
    const ts = Array.from({ length: m }, (_, i) => (i + between(-0.3, 0.3)) / (m - 1)).map((t) => Math.min(1, Math.max(0, t))).sort((a, b) => a - b);
    return ts.map((t, k) => {
      const d = t * lens.at(-1);
      let i = 1;
      while (i < s.length - 1 && lens[i] < d) i++;
      const u = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
      let x = s[i - 1][0] + u * (s[i][0] - s[i - 1][0]), y = s[i - 1][1] + u * (s[i][1] - s[i - 1][1]);
      x = x * sx + shear * y;
      const [rx, ry] = [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
      // deriva lenta (ampia) + tremolio veloce
      const wob = noise * (Math.sin(k / 6 + phase[0]) + 0.6 * Math.sin(k / 3 + phase[1]));
      const wob2 = noise * (Math.cos(k / 5 + phase[2]) + 0.6 * Math.sin(k / 2.5 + phase[3]));
      return [rx + wob + gauss() * noise * 0.5, ry + wob2 + gauss() * noise * 0.5];
    });
  });
  return out;
}

