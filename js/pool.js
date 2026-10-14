// Archivio delle calibrazioni: il modello si addestra su tutte le sessioni salvate, ognuna
// pesata per quanto la sua postura somiglia a quella attuale.
//
// Misurato sulle registrazioni (tools/): con posture simili l'archivio aiuta molto (ricalibrazione
// rapida a 5 punti: 169 px da sola, 105 px con l'archivio pesato); con posture molto diverse un
// archivio senza pesi peggiora la stima (calibrazione completa: 99 px da sola, 154 px con
// l'archivio non pesato, 104 px con quello pesato).
import { expand, fitRidge } from "./regression.js";
import { cleanSamples } from "./calibration.js";

const MAX_SESSIONS = 8;
const MAX_PER_POINT = 30; // 60 non migliora la stima e occupa il doppio
const MAX_CLICKS = 30;    // i clic stanno in una sola sessione, con gli ultimi 30
// Scala delle differenze di postura [posizione, angoli]: a questa distanza una sessione pesa
// ~0.6, al doppio ~0.14, al triplo ~0.01 (misurato: dentro una sessione la posizione varia di
// 0.1–0.7 e gli angoli di ±0.01; tra posture diverse fino a 9 e 0.2).
const POSE_SCALE = [2, 0.06];

export class CalibrationPool {
  // storage: { load(), save(data) }. device identifica schermo e fotocamera: i dati di un
  // altro dispositivo non valgono.
  constructor(storage, device) {
    this.storage = storage;
    this.device = device;
    const saved = storage.load();
    this.sessions = saved?.device === device && Array.isArray(saved.sessions) ? saved.sessions : [];
    // Versioni precedenti salvavano anche gli esempi presi con il punto in movimento (un
    // campione ciascuno), che peggiorano la stima: si tolgono.
    for (const s of this.sessions) s.points = s.points.filter((p) => s.kind === "clic" || p.samples.length > 1);
    // ...e una sessione per ogni gruppo di clic: si riuniscono in una sola.
    const clicks = this.sessions.filter((s) => s.kind === "clic");
    if (clicks.length > 1) {
      const merged = { ...clicks.at(-1), id: "clic", points: clicks.flatMap((s) => s.points).slice(-MAX_CLICKS) };
      this.sessions = [...this.sessions.filter((s) => s.kind !== "clic"), merged];
    }
  }

  // Sessioni di calibrazione (i clic non contano).
  get size() { return this.sessions.filter((s) => s.kind !== "clic").length; }

  // Posa media della testa nell'ultima calibrazione: [tx, ty, tz, yaw, pitch].
  get lastPose() { return this.sessions.findLast((s) => s.kind !== "clic" && s.pose)?.pose ?? null; }

  // points: [{ point: [x, y], samples: [features, ...] }]
  add(kind, points, pose) {
    this.sessions.push({ date: new Date().toISOString(), kind, pose, points: compact(points) });
    const calibrations = this.sessions.filter((s) => s.kind !== "clic").slice(-MAX_SESSIONS);
    this.sessions = [...calibrations, ...this.sessions.filter((s) => s.kind === "clic")];
    this.save();
  }

  // Un punto indicato con il clic (calibrazione aiutata), con la postura di quel momento.
  addClick(point, samples, pose) {
    let session = this.sessions.find((s) => s.kind === "clic");
    if (!session) {
      session = { kind: "clic", id: "clic", points: [] };
      this.sessions.push(session);
    }
    session.points = [...session.points, { point, samples: compact([{ point, samples }], false)[0].samples, pose }].slice(-MAX_CLICKS);
    session.date = new Date().toISOString();
    this.save();
  }

  save() {
    this.storage.save({ device: this.device, sessions: this.sessions });
  }

  // extra: punti non ancora salvati (peso pieno). pose: postura di riferimento per i pesi
  // (predefinita: quella dell'ultima calibrazione).
  train(extra = [], pose = this.lastPose) {
    const X = [], Y = [], W = [];
    const add = (points, weight) => {
      for (const { point, samples } of points) {
        for (const f of samples) {
          X.push(expand(f));
          Y.push(point);
          W.push(weight);
        }
      }
    };
    for (const s of this.sessions) {
      if (s.kind === "clic") for (const p of s.points) add([p], poseWeight(p.pose, pose));
      else add(s.points, poseWeight(s.pose, pose));
    }
    add(extra, 1);
    return X.length ? fitRidge(X, Y, 0.03, W) : null;
  }

  clear() {
    this.sessions = [];
    this.storage.save({ device: this.device, sessions: [] });
  }
}

// Peso di una sessione: 1 con la stessa postura, verso 0 quando è molto diversa.
export function poseWeight(a, b) {
  if (!a || !b) return 1;
  const [st, sa] = POSE_SCALE;
  const d2 = ((a[0] - b[0]) / st) ** 2 + ((a[1] - b[1]) / st) ** 2 + ((a[2] - b[2]) / st) ** 2
    + ((a[3] - b[3]) / sa) ** 2 + ((a[4] - b[4]) / sa) ** 2;
  return Math.exp(-d2 / 2);
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
