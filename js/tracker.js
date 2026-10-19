// Rilevamento del volto con MediaPipe Face Landmarker ed estrazione delle
// caratteristiche dello sguardo (posizione dell'iride nell'occhio + posa della testa).
import { RAW_POINTS, gazeFeatures } from "./features.js";
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const round = (v, k = 100) => Math.round(v * k) / k;

export class GazeTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.onFrame = () => {};
    this.lastVideoTime = -1;
    this.running = false;
  }

  async load() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options("CPU"));
    }
  }

  async startCamera() {
    // Sui telefoni (schermo touch) basta 640x480: a 30–40 cm il viso riempie l'inquadratura e
    // il telefono elabora più fotogrammi al secondo, quindi lo sguardo stimato trema meno.
    const phone = matchMedia("(pointer: coarse)").matches;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: phone ? 640 : 1280 }, height: { ideal: phone ? 480 : 720 } },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
  }

  start() {
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.tick();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  tick() {
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    const t = performance.now();
    const result = this.landmarker.detectForVideo(v, t);
    this.onFrame(this.extract(result, t));
  }

  extract(result, t) {
    const lm = result.faceLandmarks?.[0];
    if (!lm) return { t, face: false };

    // Coordinate in pixel, per non deformare le distanze con il formato del video.
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });

    const bs = {};
    for (const c of result.faceBlendshapes?.[0]?.categories ?? []) bs[c.categoryName] = c.score;
    const blink = ((bs.eyeBlinkLeft ?? 0) + (bs.eyeBlinkRight ?? 0)) / 2 > 0.6;
    const m = result.facialTransformationMatrixes?.[0]?.data;
    const features = gazeFeatures(P, bs, m);

    const raw = () => ({
      lm: RAW_POINTS.map((i) => [round(lm[i].x * W), round(lm[i].y * H), round(lm[i].z * W)]),
      bs: Object.fromEntries(Object.entries(bs).filter(([k]) => k.startsWith("eye")).map(([k, v]) => [k, round(v, 1000)])),
      m: m ? Array.from(m, (v) => round(v, 10000)) : null,
    });

    // Posizione e orientamento della testa: [tx, ty, tz, yaw, pitch].
    const pose = m ? [m[12], m[13], m[14], m[8], m[9]] : null;

    return { t, face: true, blink, features, pose, raw };
  }
}
