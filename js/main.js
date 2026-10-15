import { GazeTracker } from "./tracker.js";
import { predict } from "./regression.js";
import { OneEuro } from "./filter.js";
import { Aborted, CALIB_POINTS, Calibrator, QUICK_POINTS, VALIDATION_POINTS, cleanSamples } from "./calibration.js";
import { DwellBoard } from "./board.js";
import { Keyboard, DEFAULT_PHRASES, display } from "./keyboard.js";
import { API_HEADERS, ClonedVoice } from "./voice.js";
import { Dasher, LetterModel } from "./dasher.js";
import { Predictor } from "./predictor.js";
import { CalibrationPool } from "./pool.js";
import { PostureMonitor, meanPose } from "./posture.js";

const $ = (s) => document.querySelector(s);
const POOL_KEY = "sguardo.calibrazioni.v1";
const SETTINGS_KEY = "sguardo.settings.v1";
const LEXICON_KEY = "sguardo.lessico.v1";
const PHRASES_KEY = "sguardo.frasi.v1";

const MENU_EYES_CLOSED_MS = 2000;     // occhi chiusi per aprire il menu
const RECAL_MIN_INTERVAL_MS = 60_000; // non riproporre la ricalibrazione troppo spesso
const SNOOZE_MS = 180_000;            // dopo "Non ora"
const PROMPT_SECONDS = 5;             // conto alla rovescia prima della ricalibrazione rapida
const RESULT_AUTO_SECONDS = 10;       // dopo la calibrazione si prosegue da soli

// ?mouse nell'indirizzo: il mouse fa le veci dello sguardo (per provare la tastiera senza calibrare).
const MOUSE_MODE = new URLSearchParams(location.search).has("mouse");

const screens = { start: $("#start"), board: $("#board"), dasher: $("#dasher"), calib: $("#calib"), result: $("#result"), prompt: $("#prompt") };
const video = $("#video");
const dot = $("#gaze-dot");

const tracker = new GazeTracker(video);
const calibrator = new Calibrator($("#calib"), $("#calib-target"), $("#calib-msg"));
const select = (item, count) => item.action(count);
const board = new DwellBoard($("#board"), select);
const resultBoard = new DwellBoard($("#result-cells"), select);
const promptBoard = new DwellBoard($("#prompt-cells"), select);
const posture = new PostureMonitor();
const voice = new ClonedVoice();
const filterX = new OneEuro();
const filterY = new OneEuro();

// dasherOrientation: nel simulatore (tools/simulate-dasher.mjs) l'orizzontale completa il 92%
// delle frasi contro il 62% del verticale, con il 75% di cancellazioni in meno.
const settings = { dwellMs: 1000, showDot: true, dasherSpeed: 1, dasherOrientation: "horizontal", ...load(SETTINGS_KEY) };
let keyboard = null;
let dasher = null;
let eyesClosed = false;
let pool = null;
let model = null;
let mode = "start";
let collecting = null;
let gaze = null;
let lastSession = null;
let lastResult = null; // per riaprire il risultato dalla barra
let lastRecalAt = 0;
let snoozeUntil = 0;
let eyesClosedSince = null;
let menuOpenedByEyes = false;
let countdown = null;

// Ultimi fotogrammi, per capire se l'occhio è fermo (posizione orizzontale dell'iride
// e palpebra superiore quasi costanti). Soglia ricavata dalle registrazioni: con l'occhio
// fermo la deviazione standard su 6 fotogrammi è ~0.001, durante uno spostamento 0.01–0.08.
const STABLE_FRAMES = 6;
const STABLE_SD = 0.005;
const recent = [];
const recentPoses = [];

// ---------- ciclo per fotogramma ----------

tracker.onFrame = (f) => {
  updateFaceStatus(f);
  recent.push(f.face && !f.blink ? f.features : null);
  recentPoses.push(f.face ? f.pose : null);
  if (recent.length > STABLE_FRAMES) recent.shift();
  if (recentPoses.length > STABLE_FRAMES) recentPoses.shift();

  if (collecting) {
    if (f.face) collecting.push({ t: Math.round(f.t), blink: f.blink, features: f.features, pose: f.pose, raw: f.raw() });
    return;
  }
  if (!model || !f.face) {
    gaze = null;
    filterX.reset();
    filterY.reset();
  } else if (!f.blink) {
    // Durante un battito di ciglia l'iride non è visibile: si tiene l'ultima posizione.
    const [nx, ny] = predict(model, f.features);
    const x = clamp(nx, -0.05, 1.05) * innerWidth;
    const y = clamp(ny, -0.05, 1.05) * innerHeight;
    gaze = { x: filterX.filter(x, f.t / 1000), y: filterY.filter(y, f.t / 1000) };
  }
  eyesClosed = f.face && f.blink;
  renderDot();
  activeBoard()?.update(gaze, f.t, eyesClosed);

  if (mode === "board" || mode === "dasher") {
    watchEyesClosed(f);
    watchPosture(f);
  }
};

function activeBoard() {
  return { board, result: resultBoard, prompt: promptBoard }[mode] ?? null;
}

function updateFaceStatus(f) {
  video.classList.toggle("face", f.face && !f.blink);
  video.classList.toggle("blink", f.face && f.blink);
  $("#face-status").textContent = !f.face ? "no volto" : f.blink ? "occhi chiusi" : "ok";
}

function renderDot() {
  const visible = gaze && settings.showDot && (activeBoard() || mode === "dasher");
  dot.hidden = !visible;
  if (visible) {
    dot.style.transform = `translate(${clamp(gaze.x, 0, innerWidth)}px, ${clamp(gaze.y, 0, innerHeight)}px)`;
  }
}

// Occhi chiusi a lungo: apre il menu (una volta sola finché gli occhi restano chiusi).
function watchEyesClosed(f) {
  if (!(f.face && f.blink)) {
    eyesClosedSince = null;
    menuOpenedByEyes = false;
    return;
  }
  eyesClosedSince ??= f.t;
  if (!menuOpenedByEyes && f.t - eyesClosedSince >= MENU_EYES_CLOSED_MS) {
    menuOpenedByEyes = true;
    showMenu();
  }
}

// Postura cambiata rispetto all'ultima calibrazione: propone la ricalibrazione rapida.
function watchPosture(f) {
  if (!f.face || f.blink || !model) return;
  const now = performance.now();
  if (posture.update(f.pose, f.t) && now - lastRecalAt > RECAL_MIN_INTERVAL_MS && now > snoozeUntil) {
    promptRecalibration();
  }
}

// ---------- schermate ----------

function show(name) {
  if (mode === "dasher" && name !== "dasher") dasher?.stop();
  mode = name;
  stopCountdown();
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  $("#compose").hidden = name !== "board" && name !== "dasher";
  // Nella scrittura continua la barra in alto si nasconde: più spazio per le lettere.
  $("#toolbar").hidden = ["start", "calib", "prompt", "dasher"].includes(name);
  for (const b of [board, resultBoard, promptBoard]) b.reset();
  renderDot();
}

function startCountdown(seconds, onTick, onDone) {
  stopCountdown();
  let left = seconds;
  onTick(left);
  countdown = setInterval(() => {
    left -= 1;
    if (left > 0) onTick(left);
    else {
      stopCountdown();
      onDone();
    }
  }, 1000);
}

function stopCountdown() {
  clearInterval(countdown);
  countdown = null;
}

function toast(text, ms = 3000) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), ms);
}

$("#btn-start").addEventListener("click", async () => {
  const status = $("#start-status");
  status.classList.remove("error");
  document.documentElement.requestFullscreen?.().catch(() => {});
  try {
    if (!window.isSecureContext) {
      throw new Error("La fotocamera funziona solo in HTTPS o su localhost. Avvia serve.py (vedi README).");
    }
    $("#btn-start").disabled = true;
    status.textContent = "Carico il vocabolario…";
    await setupKeyboard();
    if (MOUSE_MODE) {
      startMouseMode();
      return;
    }
    status.textContent = "Carico il modello del viso…";
    await tracker.load();
    status.textContent = "Avvio la fotocamera…";
    await tracker.startCamera();
    tracker.start();
    keepScreenOn();

    pool = new CalibrationPool(
      { load: () => load(POOL_KEY), save: (data) => save(POOL_KEY, data) },
      `${screen.width}x${screen.height}@${video.videoWidth}x${video.videoHeight}`,
    );
    model = pool.train();
    posture.setBaseline(pool.lastPose);
    // Con calibrazioni già salvate bastano 10 secondi per adattarsi alla postura di oggi.
    calibrate(model ? "quick" : "full");
  } catch (e) {
    $("#btn-start").disabled = false;
    status.classList.add("error");
    status.textContent =
      e.name === "NotAllowedError" ? "Permesso per la fotocamera negato. Consentilo dalle impostazioni del browser."
      : e.name === "NotFoundError" ? "Nessuna fotocamera trovata."
      : e.message || String(e);
  }
});

// ---------- tastiera e menu ----------

async function setupKeyboard() {
  if (keyboard) return;
  let words = [];
  try {
    const res = await fetch("data/parole-it.txt");
    if (res.ok) words = (await res.text()).split(/\r?\n/).filter(Boolean);
  } catch {
    // senza vocabolario restano i suggerimenti imparati dalla persona
  }
  const store = { load: () => load(LEXICON_KEY), save: (data) => save(LEXICON_KEY, data) };
  keyboard = new Keyboard(board, new Predictor(words, store), {
    onChange: (text) => {
      $("#compose-text").textContent = display(text);
      $("#compose").scrollLeft = $("#compose").scrollWidth; // se il testo è lungo resta visibile la fine
      schedulePregeneration(text);
    },
    onSpeak: speak,
    phrases: { load: () => load(PHRASES_KEY), save: (list) => save(PHRASES_KEY, list) },
    onPhraseSaved: (text) => voice.ready && voice.prefetch([text]),
  });
  keyboard.showMain();
}

// Menu usabile con lo sguardo: si apre tenendo gli occhi chiusi per 2 secondi.
function showMenu() {
  if (mode !== "board") show("board");
  const seconds = (settings.dwellMs / 1000).toFixed(2).replace(/0$/, "");
  const items = [
    { label: "Ricalibra\n(10 secondi)", kind: "cmd", action: () => calibrate("quick") },
    { label: "Calibrazione\ncompleta", kind: "cmd", action: () => calibrate("full") },
    { label: `Fissazione\npiù lenta (ora ${seconds} s)`, kind: "cmd", action: () => { changeDwell(250); showMenu(); } },
    { label: `Fissazione\npiù veloce (ora ${seconds} s)`, kind: "cmd", action: () => { changeDwell(-250); showMenu(); } },
    { label: `Punto: ${settings.showDot ? "sì" : "no"}`, kind: "cmd", action: () => { toggleDot(); showMenu(); } },
    { label: "Scrittura\ncontinua", kind: "cmd", action: startDasher },
    { label: `Scrittura continua\npiù lenta (${settings.dasherSpeed.toFixed(1)})`, kind: "cmd", action: () => { changeDasherSpeed(-0.2); showMenu(); } },
    { label: `Scrittura continua\npiù veloce (${settings.dasherSpeed.toFixed(1)})`, kind: "cmd", action: () => { changeDasherSpeed(0.2); showMenu(); } },
    {
      label: `Scrittura continua:\n${settings.dasherOrientation === "horizontal" ? "orizzontale" : "verticale"}`,
      kind: "cmd",
      action: () => {
        settings.dasherOrientation = settings.dasherOrientation === "horizontal" ? "vertical" : "horizontal";
        applySettings();
        showMenu();
      },
    },
  ];
  items[11] = { label: "Indietro", kind: "cmd", action: () => keyboard.showMain() };
  board.setLayout(4, 3, items);
}

// Scrittura continua (Dasher): modalità alternativa alla tastiera. Si esce con il menu.
function startDasher() {
  show("dasher");
  const predictor = keyboard.predictor;
  dasher ??= new Dasher($("#dasher"), null, {
    getText: () => keyboard.text,
    setText: (t) => keyboard.setText(t),
    speak: () => keyboard.speakText(),
    getGaze: () => gaze,
    isPaused: () => eyesClosed,
  });
  dasher.model = new LetterModel(predictor.words, predictor.user.uni); // include le parole imparate
  dasher.speed = settings.dasherSpeed;
  dasher.orientation = settings.dasherOrientation;
  dasher.start();
}

function changeDasherSpeed(delta) {
  settings.dasherSpeed = Math.round(clamp(settings.dasherSpeed + delta, 0.4, 3) * 10) / 10;
  if (dasher) dasher.speed = settings.dasherSpeed;
  applySettings();
}

function startMouseMode() {
  $("#toolbar").classList.add("mouse");
  addEventListener("mousemove", (e) => (gaze = { x: e.clientX, y: e.clientY }));
  const loop = () => {
    renderDot();
    activeBoard()?.update(gaze, performance.now());
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  show("board");
}

// ---------- calibrazione aiutata con il clic ----------

// Chi usa Sguardo (o chi assiste, chiedendo di guardare un punto) clicca dove sta guardando:
// gli ultimi fotogrammi diventano un punto di calibrazione in più, nelle condizioni di adesso
// (luce, postura, distanza). Vale solo se l'occhio è fermo in quel momento.
// Non è per chi è immobilizzato: serve a chi assiste, alle prove, a chi muove ancora una mano.
// Simulato sulle registrazioni (modello di altre sessioni + clic nella sessione nuova):
// 0 clic 134 px, 3 clic 126 px, 6–10 clic 121 px. Pesare di più i clic peggiora.

// Clic sinistro: calibra e seleziona ciò che c'è sotto. Clic destro: calibra soltanto.
addEventListener("contextmenu", (e) => {
  if (!MOUSE_MODE && pool && model && ["board", "dasher", "result"].includes(mode)) e.preventDefault();
});

addEventListener("pointerdown", (e) => {
  if (MOUSE_MODE || !pool || !model || !["board", "dasher", "result"].includes(mode)) return;
  const ok = sampler.stable();
  showClickMark(e.clientX, e.clientY, ok);
  if (!ok) return;
  pool.addClick([e.clientX / innerWidth, e.clientY / innerHeight], recent.map((f) => [...f]), meanPose(recentPoses));
  model = pool.train();
}, true);

function showClickMark(x, y, ok) {
  const mark = document.createElement("div");
  mark.className = `click-mark ${ok ? "ok" : "skip"}`;
  mark.style.left = `${x}px`;
  mark.style.top = `${y}px`;
  document.body.appendChild(mark);
  setTimeout(() => mark.remove(), 700);
}

// ---------- calibrazione ----------

const sampler = {
  start() { collecting = []; },
  stop() { const s = collecting; collecting = null; return s; },
  stable() {
    if (recent.length < STABLE_FRAMES || recent.includes(null)) return false;
    return [0, 2].every((j) => sd(recent.map((f) => f[j])) < STABLE_SD);
  },
};

function sd(a) {
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
}

// kind: "full" (18 punti + verifica, circa 40 s) o "quick" (5 punti, circa 10 s).
// Entrambe si aggiungono all'archivio e il modello si ricalcola su tutte le sessioni.
async function calibrate(kind = "full") {
  if (!pool) return;
  const quick = kind === "quick";
  calibrator.aborted = false;
  show("calib");
  try {
    await calibrator.intro(
      quick ? "Ricalibrazione rapida: segui il punto con gli occhi."
        : "Segui il punto rosso solo con gli occhi, tenendo la testa ferma. Quando diventa azzurro, fissalo.",
      quick ? 2000 : 3000,
    );
    const calib = await calibrator.runPoints(quick ? QUICK_POINTS : CALIB_POINTS, sampler);
    const points = calib.fixations.map(({ point, samples }) => ({ point, samples: usable(samples) }));
    if (points.reduce((s, p) => s + p.samples.length, 0) < calib.fixations.length * 8) {
      throw new Error("Non ho visto il viso abbastanza a lungo. Controlla la luce e che il volto sia inquadrato.");
    }
    const pose = meanPose(calib.fixations.flatMap(({ samples }) => samples.map((s) => s.pose)));

    let stats = null;
    let validation = [];
    if (!quick) {
      // Errore misurato su punti che il modello non ha visto, con l'archivio pesato per postura.
      const candidate = pool.train(points.map(({ point, samples }) => ({ point, samples: cleanSamples(samples) })), pose);
      calibrator.msg.textContent = "";
      validation = (await calibrator.runPoints(VALIDATION_POINTS, sampler)).fixations;
      stats = measureError(candidate, validation);
      // I fotogrammi presi mentre il punto si muoveva non entrano nel modello (sulle registrazioni
      // peggiorano la stima: 99 -> 109–115 px), ma si salvano con "Salva dati" per analisi future.
      lastSession = {
        date: new Date().toISOString(),
        userAgent: navigator.userAgent,
        screen: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
        video: { w: video.videoWidth, h: video.videoHeight },
        calib: calib.fixations,
        validation,
        pursuit: calib.pursuit,
      };
    }

    pool.add(kind, [...points, ...validation.map(({ point, samples }) => ({ point, samples: usable(samples) }))], pose);
    model = pool.train();
    posture.setBaseline(pose);
    lastRecalAt = performance.now();
    filterX.reset();
    filterY.reset();
    keyboard.showMain();
    if (quick) {
      show("board");
      toast("Ricalibrato");
    } else {
      showResult(stats);
    }
  } catch (e) {
    if (e instanceof Aborted) {
      show(model ? "board" : "start");
      return;
    }
    if (quick && model) {
      // Si resta con il modello di prima; il controllo della postura riproverà più tardi.
      lastRecalAt = performance.now();
      keyboard.showMain();
      show("board");
      toast(`Ricalibrazione non riuscita. ${e.message || ""}`, 5000);
      return;
    }
    showResult({ error: e.message || String(e) });
  }
}

function promptRecalibration() {
  show("prompt");
  promptBoard.setLayout(3, 1, [
    null,
    { label: "Non ora", kind: "cmd", action: () => { snoozeUntil = performance.now() + SNOOZE_MS; show("board"); } },
    null,
  ]);
  startCountdown(PROMPT_SECONDS, (n) => ($("#prompt-count").textContent = n), () => calibrate("quick"));
}

function measureError(m, validation) {
  const diag = Math.hypot(innerWidth, innerHeight);
  const errs = [];
  for (const { point, samples } of validation) {
    for (const f of usable(samples)) {
      const [x, y] = predict(m, f);
      errs.push(Math.hypot((x - point[0]) * innerWidth, (y - point[1]) * innerHeight));
    }
  }
  if (!errs.length) return { error: "Nessun dato durante la verifica: il viso non era visibile." };
  return { meanPx: errs.reduce((s, e) => s + e, 0) / errs.length, diag, sessions: pool.size };
}

// again: riaperta a mano dalla barra (niente proseguimento automatico).
function showResult(r, again = false) {
  if (!r.error) lastResult = r;
  const body = $("#result-body");
  const goOn = { label: "Continua", kind: "suggest", action: () => show("board") };
  if (r.error) {
    $("#result-title").textContent = "Calibrazione non riuscita";
    body.textContent = r.error;
    resultBoard.setLayout(2, 1, [{ label: "Riprova", kind: "cmd", action: () => calibrate("full") }, model ? goOn : null]);
  } else {
    const pct = ((r.meanPx / r.diag) * 100).toFixed(1);
    $("#result-title").textContent = "Calibrazione completata";
    body.innerHTML = `
      <div>Errore medio <span class="big-number">${Math.round(r.meanPx)} px</span> (${pct}% della diagonale)</div>
      <p>Calibrazioni salvate: ${r.sessions}. Più sono, più la stima regge ai cambi di postura.</p>
      <p>Fissa una delle due celle, oppure continuo da solo tra <b id="result-count"></b> secondi.</p>`;
    resultBoard.setLayout(2, 1, [{ label: "Ricalibra", kind: "cmd", action: () => calibrate("full") }, goOn]);
  }
  $("#btn-diag").hidden = $("#btn-download").hidden = !(lastSession && !r.error);
  $("#btn-download").textContent = "Salva dati";
  $("#btn-download").disabled = false;
  show("result");
  if (again) {
    $("#result-body").querySelector("p:last-child")?.remove(); // niente "continuo da solo tra…"
  } else if (!r.error) {
    startCountdown(RESULT_AUTO_SECONDS, (n) => ($("#result-count").textContent = n), () => show("board"));
  } else if (!model) {
    // Senza calibrazione lo sguardo non funziona ancora: si riprova da soli.
    startCountdown(15, () => {}, () => calibrate("full"));
  }
}

// Campioni utilizzabili per il calcolo: senza battiti di ciglia.
function usable(frames) {
  return frames.filter((f) => !f.blink).map((f) => f.features);
}

// Mostra a schermo intero dove si guardava (croce) e dove il sistema stimava lo sguardo.
function showDiagnostics() {
  stopCountdown();
  const canvas = $("#diag");
  canvas.hidden = false;
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  const draw = (sets, color) => {
    for (const { point, samples } of sets) {
      const tx = point[0] * innerWidth, ty = point[1] * innerHeight;
      const preds = usable(samples).map((f) => predict(model, f)).map(([x, y]) => [x * innerWidth, y * innerHeight]);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5;
      for (const [x, y] of preds) ctx.fillRect(x - 2, y - 2, 4, 4);
      ctx.globalAlpha = 1;
      if (preds.length) {
        const mx = preds.reduce((s, p) => s + p[0], 0) / preds.length;
        const my = preds.reduce((s, p) => s + p[1], 0) / preds.length;
        ctx.strokeStyle = "#ffb300";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(mx, my); ctx.stroke();
      }
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(tx - 10, ty); ctx.lineTo(tx + 10, ty);
      ctx.moveTo(tx, ty - 10); ctx.lineTo(tx, ty + 10);
      ctx.stroke();
    }
  };
  draw(lastSession.calib, "#7a8394");
  draw(lastSession.validation, "#4fc3f7");

  ctx.fillStyle = "#f2f4f8";
  ctx.font = "16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Croce = dove guardavi · grigio = calibrazione · azzurro = verifica · linea gialla = errore medio. Tocca per chiudere.", innerWidth / 2, innerHeight / 2);
}

// Prima prova a salvare tramite serve.py (cartella recordings/), altrimenti scarica il file.
async function saveSession() {
  stopCountdown();
  const button = $("#btn-download");
  // Con l'archivio delle calibrazioni si può capire offline quale sessione peggiora la stima.
  const json = JSON.stringify({ ...lastSession, pool: pool?.sessions ?? [] });
  try {
    const res = await fetch("/api/recording", { method: "POST", headers: { ...API_HEADERS, "Content-Type": "application/json" }, body: json });
    if (!res.ok) throw new Error(res.status);
    const { file } = await res.json();
    button.textContent = `Salvato in ${file}`;
    button.disabled = true;
    return;
  } catch {
    // server senza salvataggio: si passa al download
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  a.download = `sguardo-calibrazione-${lastSession.date.slice(0, 19).replace(/[:T]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  button.textContent = "Scaricato";
}

// ---------- voce ----------

function speak(text) {
  const bar = $("#last-spoken");
  bar.textContent = display(text);
  if (!voice.ready) {
    speakWithBrowser(text);
    return;
  }
  // La voce clonata si genera sul PC: la prima volta una frase può richiedere qualche secondo.
  bar.classList.add("pending");
  voice.play(text)
    .catch(() => speakWithBrowser(text))
    .finally(() => bar.classList.remove("pending"));
}

// La voce clonata impiega qualche secondo per frase (circa 2,5 volte la sua durata su un
// portatile i7): si genera mentre la persona scrive, a ogni parola finita, così su "Parla"
// l'audio è quasi sempre pronto. C'è al massimo una generazione in corso: le versioni
// intermedie superate dal testo nuovo vengono saltate, quindi non si formano code.
const PREGEN_DEBOUNCE_MS = 300; // suggerimento scelto = parola + spazio in un colpo solo
let pregenTimer = null;
let pregenBusy = false;

function schedulePregeneration(text) {
  clearTimeout(pregenTimer);
  const sentence = text.trim();
  if (!voice.ready || !sentence || !/[\s.?!]$/.test(text)) return;
  pregenTimer = setTimeout(async () => {
    if (pregenBusy || keyboard.text.trim() !== sentence) return;
    pregenBusy = true;
    try {
      await voice.audioFor(sentence);
    } catch {
      // si riproverà quando la persona preme "Parla"
    } finally {
      pregenBusy = false;
    }
    if (keyboard.text.trim() !== sentence) schedulePregeneration(keyboard.text);
  }, PREGEN_DEBOUNCE_MS);
}

function speakWithBrowser(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "it-IT";
    const v = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("it"));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {
    // Sintesi vocale non disponibile: resta il testo nella barra.
  }
}

// Frasi da tenere sempre pronte con la voce clonata: predefinite e salvate dalla persona.
function phrasesToKeep() {
  return [...DEFAULT_PHRASES.map((p) => p.say), ...(load(PHRASES_KEY) ?? [])];
}

// Schermata iniziale: chi assiste carica i vocali e clona la voce, una volta sola.
async function setupVoice() {
  const status = await voice.refresh();
  if (!status) return; // pagina non servita da serve.py: si usa la voce del browser
  $("#voice-setup").hidden = false;
  renderVoice();
  if (voice.ready) voice.prefetch(phrasesToKeep());
}

function renderVoice(message) {
  const s = voice.status;
  const el = $("#voice-status");
  el.classList.remove("error");
  if (!s.installed) {
    el.textContent = "Voce clonata non installata: Sguardo userà la voce del browser (vedi README, requirements-voce.txt).";
    $("#voice-controls").hidden = $("#voice-try").hidden = true;
    return;
  }
  if (!s.local) {
    // Dal telefono (serve.py --https): la voce si usa, ma si prepara solo dal PC.
    el.textContent = s.cloned && s.license
      ? "Voce clonata pronta (si prepara e si modifica dal PC su cui gira Sguardo)."
      : "Nessuna voce clonata: si prepara dal PC su cui gira Sguardo. Intanto si usa la voce del dispositivo.";
    $("#voice-controls").hidden = $("#voice-try").hidden = $("#voice-license").hidden = true;
    return;
  }
  $("#voice-license").hidden = s.license;
  const saved = s.samples.length
    ? ` Campioni già salvati: ${s.samples.length} (si sommano ai nuovi; "Elimina voce" per ricominciare).`
    : "";
  el.textContent = message ?? (s.cloned && s.license
    ? `Voce clonata pronta${s.state === "caricamento" ? " (il modello si sta caricando)" : ""}.${saved}`
    : `Carica o registra 10–30 secondi di voce della persona (vanno bene i vocali di WhatsApp) e premi Clona.${saved}`);
  $("#voice-try").hidden = !(s.cloned && s.license);
}

$("#voice-files").addEventListener("change", updateChosenLabel);

function updateChosenLabel() {
  const parts = [];
  const n = $("#voice-files").files.length;
  if (n) parts.push(`${n} file scelti`);
  if (recordings.length) {
    const seconds = Math.round(recordings.reduce((s, r) => s + r.seconds, 0));
    parts.push(`${recordings.length} registrazion${recordings.length === 1 ? "e" : "i"} (${seconds} s)`);
  }
  $("#voice-files-label").textContent = parts.join(" + ");
}

// Registrazione dal microfono, in alternativa (o in aggiunta) ai vocali.
const MAX_RECORDING_SECONDS = 60;
const recordings = []; // { file, seconds }
let recorder = null;

$("#btn-record").addEventListener("click", async () => {
  if (recorder) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
  } catch (e) {
    renderVoice(e.name === "NotAllowedError" ? "Permesso per il microfono negato." : `Microfono non disponibile: ${e.message}`);
    $("#voice-status").classList.add("error");
    return;
  }
  const chunks = [];
  recorder = new MediaRecorder(stream);
  const started = performance.now();
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(recorder.timer);
    const seconds = (performance.now() - started) / 1000;
    const type = recorder.mimeType || "audio/webm";
    const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
    const blob = new Blob(chunks, { type });
    recordings.push({ file: new File([blob], `registrazione-${recordings.length + 1}.${ext}`, { type }), seconds });
    const preview = $("#record-preview");
    preview.src = URL.createObjectURL(blob);
    preview.hidden = false;
    $("#record-panel").hidden = true;
    $("#btn-record").disabled = false;
    recorder = null;
    updateChosenLabel();
    renderVoice(`Registrati ${Math.round(seconds)} secondi: ascoltali qui sotto, poi premi Clona la voce (o registra ancora).`);
  };
  recorder.start();
  $("#btn-record").disabled = true;
  $("#record-panel").hidden = false;
  $("#record-time").textContent = "0:00";
  recorder.timer = setInterval(() => {
    const t = Math.floor((performance.now() - started) / 1000);
    $("#record-time").textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    if (t >= MAX_RECORDING_SECONDS) recorder?.stop();
  }, 250);
});

$("#btn-record-stop").addEventListener("click", () => recorder?.stop());

$("#btn-clone").addEventListener("click", async () => {
  const files = [...$("#voice-files").files, ...recordings.map((r) => r.file)];
  const button = $("#btn-clone");
  if (!files.length && !voice.status.samples.length) {
    renderVoice("Scegli prima almeno un vocale.");
    return;
  }
  if (!voice.status.license) {
    if (!$("#voice-license-check").checked) {
      renderVoice("Per clonare la voce bisogna prima accettare la licenza del modello.");
      $("#voice-status").classList.add("error");
      return;
    }
    await voice.acceptLicense();
  }
  button.disabled = true;
  try {
    for (const [i, f] of files.entries()) {
      renderVoice(`Carico ${f.name} (${i + 1}/${files.length})…`);
      await voice.upload(f);
    }
    renderVoice("Clonazione in corso… Al primo uso scarica il modello (circa 1,8 GB): può volerci parecchio.");
    const { seconds } = await voice.clone();
    $("#voice-files").value = "";
    recordings.length = 0;
    $("#record-preview").hidden = true;
    updateChosenLabel();
    renderVoice(`Voce clonata da ${seconds} secondi di parlato. Prova ad ascoltarla.`);
    voice.prefetch(phrasesToKeep());
  } catch (e) {
    renderVoice(`Clonazione non riuscita: ${e.message}`);
    $("#voice-status").classList.add("error");
  } finally {
    button.disabled = false;
  }
});

$("#btn-voice-test").addEventListener("click", async () => {
  const text = $("#voice-test").value.trim();
  if (!text) return;
  const button = $("#btn-voice-test");
  button.disabled = true;
  renderVoice("Genero la frase…");
  try {
    const started = performance.now();
    await voice.play(text);
    renderVoice(`Frase generata in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
  } catch (e) {
    renderVoice(`Errore: ${e.message}`);
    $("#voice-status").classList.add("error");
  } finally {
    button.disabled = false;
  }
});

$("#btn-voice-reset").addEventListener("click", async () => {
  if (!confirm("Eliminare la voce clonata e i vocali caricati?")) return;
  await voice.reset();
  renderVoice();
});

setupVoice();

// ---------- impostazioni (dalla barra per chi assiste o dal menu con lo sguardo) ----------

function applySettings() {
  board.dwellMs = resultBoard.dwellMs = promptBoard.dwellMs = settings.dwellMs;
  $("#dwell-value").textContent = `${(settings.dwellMs / 1000).toFixed(2).replace(/0$/, "")} s`;
  $("#btn-dot").textContent = `Punto: ${settings.showDot ? "sì" : "no"}`;
  save(SETTINGS_KEY, settings);
  renderDot();
}

function changeDwell(delta) {
  settings.dwellMs = clamp(settings.dwellMs + delta, 500, 3000);
  applySettings();
}

function toggleDot() {
  settings.showDot = !settings.showDot;
  applySettings();
}

$("#dwell-minus").addEventListener("click", () => changeDwell(-250));
$("#dwell-plus").addEventListener("click", () => changeDwell(250));
$("#btn-dot").addEventListener("click", toggleDot);
$("#btn-calib").addEventListener("click", () => calibrate("full"));
$("#btn-last-result").addEventListener("click", () => {
  if (lastResult) showResult(lastResult, true);
  else toast("Nessuna calibrazione completa da quando hai aperto la pagina: premi Ricalibra.", 4000);
});
$("#btn-reset").addEventListener("click", () => {
  if (!pool || !confirm("Cancellare tutte le calibrazioni salvate? Serve quando cambia la persona che usa Sguardo.")) return;
  pool.clear();
  model = null;
  calibrate("full");
});
$("#btn-diag").addEventListener("click", showDiagnostics);
$("#btn-download").addEventListener("click", saveSession);
$("#diag").addEventListener("click", () => ($("#diag").hidden = true));

addEventListener("keydown", (e) => {
  if (mode === "start" || (MOUSE_MODE && !"md".includes(e.key))) return;
  if (e.key === "Escape" && mode === "calib") calibrator.abort();
  else if (mode === "calib") return;
  else if (e.key === "c") calibrate("full");
  else if (e.key === "r") calibrate("quick");
  else if (e.key === "m" && (mode === "board" || mode === "dasher")) showMenu();
  else if (e.key === "d" && mode === "board") startDasher();
  else if (e.key === "p") toggleDot();
});

applySettings();

// La scrittura continua disegna su un canvas: va ridimensionato con la finestra.
addEventListener("resize", () => { if (mode === "dasher") dasher?.resize(); });

// ---------- utilità ----------

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? undefined; } catch { return undefined; }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage non disponibile */ }
}

async function keepScreenOn() {
  try {
    let lock = await navigator.wakeLock?.request("screen");
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState === "visible" && lock?.released) lock = await navigator.wakeLock.request("screen");
    });
  } catch { /* non supportato */ }
}
