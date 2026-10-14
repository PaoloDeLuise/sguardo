// Si accorge quando la persona ha cambiato postura rispetto all'ultima calibrazione.
// Posa: [tx, ty, tz, yaw, pitch] dalla matrice di trasformazione del viso di MediaPipe.
//
// Soglie dalle registrazioni: dentro una sessione la posizione varia di 0.1–0.7 unità e gli
// angoli di ±0.01; tra una sessione e l'altra la posizione si sposta di 2.9–3.7 unità e
// l'inclinazione di 0.08–0.16.
const MOVE_THRESHOLD = 2.5;
const ANGLE_THRESHOLD = 0.06;
const WINDOW_MS = 1000;   // mediana sull'ultimo secondo, per ignorare i fotogrammi isolati
const HOLD_MS = 3000;     // il cambiamento deve durare, non basta un movimento momentaneo

export class PostureMonitor {
  constructor() {
    this.baseline = null;
    this.window = [];
    this.changedSince = null;
  }

  setBaseline(pose) {
    this.baseline = pose;
    this.window = [];
    this.changedSince = null;
  }

  // Restituisce true quando la postura è diversa dalla calibrazione da almeno HOLD_MS.
  update(pose, t) {
    if (!this.baseline || !pose) return false;
    this.window.push({ t, pose });
    while (this.window.length && this.window[0].t < t - WINDOW_MS) this.window.shift();

    const now = pose.map((_, i) => median(this.window.map((w) => w.pose[i])));
    const b = this.baseline;
    const moved = Math.hypot(now[0] - b[0], now[1] - b[1], now[2] - b[2]) > MOVE_THRESHOLD;
    const turned = Math.abs(now[3] - b[3]) > ANGLE_THRESHOLD || Math.abs(now[4] - b[4]) > ANGLE_THRESHOLD;

    if (!moved && !turned) {
      this.changedSince = null;
      return false;
    }
    this.changedSince ??= t;
    return t - this.changedSince >= HOLD_MS;
  }
}

export function meanPose(poses) {
  const valid = poses.filter(Boolean);
  if (!valid.length) return null;
  return valid[0].map((_, i) => valid.reduce((s, p) => s + p[i], 0) / valid.length);
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
