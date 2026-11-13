// Rilevamento del volto con MediaPipe Face Landmarker ed estrazione delle
// caratteristiche dello sguardo (posizione dell'iride nell'occhio + posa della testa).
import { RAW_POINTS, eyeState, gazeFeatures } from "./features.js";
import { outlineOf } from "./silhouette.js";
// MediaPipe e il modello del viso stanno nel repository (vendor/, vedi il README lì dentro): la
// pagina li riceve dal sito da cui è stata aperta e non contatta nessun altro server.
import { FaceLandmarker, FilesetResolver } from "../vendor/mediapipe-0.10.14/vision_bundle.mjs";

const WASM_URL = new URL("../vendor/mediapipe-0.10.14/wasm", import.meta.url).href;
const MODEL_URL = new URL("../vendor/mediapipe-0.10.14/face_landmarker.task", import.meta.url).href;

const round = (v, k = 100) => Math.round(v * k) / k;

export class GazeTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.onFrame = () => {};
    this.onLost = () => {};       // la fotocamera si è scollegata
    this.cameraId = null;         // fotocamera scelta (null: quella predefinita)
    this.actualCameraId = null;   // fotocamera in uso davvero
    this.lastVideoTime = -1;
    this.running = false;
    this.mode = "eyes"; // modalità di controllo: quali caratteristiche produce (vedi features.js)
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

  // deviceId: la fotocamera scelta da chi assiste; senza, quella frontale o predefinita.
  async startCamera(deviceId = null) {
    // Sui telefoni (schermo touch) basta 640x480: a 30–40 cm il viso riempie l'inquadratura e
    // il telefono elabora più fotogrammi al secondo, quindi lo sguardo stimato trema meno.
    const phone = matchMedia("(pointer: coarse)").matches;
    const size = { width: { ideal: phone ? 640 : 1280 }, height: { ideal: phone ? 480 : 720 } };
    // Prima si chiude quella in uso: su molti telefoni non se ne aprono due insieme.
    this.stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: "user", ...size },
      audio: false,
    });
    this.video.srcObject = stream;
    this.cameraId = deviceId;
    const [track] = stream.getVideoTracks();
    this.actualCameraId = track?.getSettings?.().deviceId ?? null; // anche quando ha scelto il browser
    // "ended" arriva quando la fotocamera sparisce (cavo staccato), non quando la chiudiamo noi.
    track?.addEventListener("ended", () => { if (this.video.srcObject === stream) this.onLost(); });
    await this.video.play();
  }

  stopCamera() {
    for (const track of this.video.srcObject?.getTracks?.() ?? []) track.stop();
    this.video.srcObject = null;
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
    const { blink, wink } = eyeState(bs);
    const m = result.facialTransformationMatrixes?.[0]?.data;
    const features = gazeFeatures(P, bs, m, this.mode);

    const raw = () => ({
      lm: RAW_POINTS.map((i) => [round(lm[i].x * W), round(lm[i].y * H), round(lm[i].z * W)]),
      bs: Object.fromEntries(Object.entries(bs).filter(([k]) => k.startsWith("eye")).map(([k, v]) => [k, round(v, 1000)])),
      m: m ? Array.from(m, (v) => round(v, 10000)) : null,
    });

    // Posizione e orientamento della testa: [tx, ty, tz, yaw, pitch].
    const pose = m ? [m[12], m[13], m[14], m[8], m[9]] : null;

    // Per i gesti della scrittura a mano: occhi (sinistro, destro) e bocca aperta.
    const eyes = [bs.eyeBlinkLeft ?? 0, bs.eyeBlinkRight ?? 0];
    const jaw = bs.jawOpen ?? 0;

    // Contorno del viso per la sagoma della posizione di calibrazione (silhouette.js).
    const outline = outlineOf(lm);

    return { t, face: true, blink, wink, eyes, jaw, features, pose, outline, raw };
  }
}
