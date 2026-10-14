// Archivio delle calibrazioni: il modello si addestra su tutte le sessioni salvate, non solo
// sull'ultima. Avendo esempi da posture diverse impara come la posa della testa sposta la
// stima. Sulle registrazioni: con la calibrazione di un'altra sessione l'errore medio è
// 566 px; con questo archivio 120 px senza punti nuovi e 103 px dopo la ricalibrazione
// rapida a 5 punti (tools/evaluate-drift.mjs, tools/test-posture.mjs).
import { expand, fitRidge } from "./regression.js";
import { cleanSamples } from "./calibration.js";

const MAX_SESSIONS = 8;
const MAX_PER_POINT = 30; // 60 non migliora la stima e occupa il doppio

export class CalibrationPool {
  // storage: { load(), save(data) }. device identifica schermo e fotocamera: i dati di un
  // altro dispositivo non valgono.
  constructor(storage, device) {
    this.storage = storage;
    this.device = device;
    const saved = storage.load();
    this.sessions = saved?.device === device && Array.isArray(saved.sessions) ? saved.sessions : [];
  }

  get size() { return this.sessions.length; }

  // Posa media della testa nell'ultima calibrazione: [tx, ty, tz, yaw, pitch].
  get lastPose() { return this.sessions.findLast((s) => s.pose)?.pose ?? null; }

  // points: [{ point: [x, y], samples: [features, ...] }]
  add(kind, points, pose) {
    this.sessions.push({ date: new Date().toISOString(), kind, pose, points: compact(points) });
    this.sessions = this.sessions.slice(-MAX_SESSIONS);
    this.save();
  }

  // Punti indicati con il clic (calibrazione aiutata): si accumulano in una sessione che resta
  // aperta fino alla prossima calibrazione. weight: quanto conta ogni campione rispetto a
  // quelli di una calibrazione (un clic ha pochi campioni, ma vale quanto un punto).
  saveClicks(id, points, weight) {
    const session = { date: new Date().toISOString(), kind: "clic", id, weight, pose: null, points: compact(points, false) };
    const i = this.sessions.findIndex((s) => s.id === id);
    if (i >= 0) this.sessions[i] = session;
    else this.sessions = [...this.sessions, session].slice(-MAX_SESSIONS);
    this.save();
  }

  save() {
    this.storage.save({ device: this.device, sessions: this.sessions });
  }

  // extra: punti non ancora salvati da includere nell'addestramento.
  train(extra = []) {
    const X = [], Y = [];
    const all = [...this.sessions.flatMap((s) => s.points.map((p) => [p, s.weight ?? 1])), ...extra.map((p) => [p, 1])];
    for (const [{ point, samples }, weight] of all) {
      for (const f of samples) {
        for (let k = 0; k < weight; k++) {
          X.push(expand(f));
          Y.push(point);
        }
      }
    }
    return X.length ? fitRidge(X, Y) : null;
  }

  clear() {
    this.sessions = [];
    this.storage.save({ device: this.device, sessions: [] });
  }
}

function compact(points, clean = true) {
  return points.map(({ point, samples }) => ({
    point,
    samples: subsample(clean ? cleanSamples(samples) : samples, MAX_PER_POINT).map((f) => f.map((v) => Math.round(v * 1e5) / 1e5)),
  }));
}

function subsample(a, n) {
  if (a.length <= n) return a;
  return Array.from({ length: n }, (_, i) => a[Math.floor((i * a.length) / n)]);
}
