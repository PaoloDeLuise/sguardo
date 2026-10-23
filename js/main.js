import { GazeTracker } from "./tracker.js";
import { predict } from "./regression.js";
import { OneEuro } from "./filter.js";
import { Aborted, CALIB_POINTS, Calibrator, QUICK_POINTS, VALIDATION_POINTS, cleanSamples } from "./calibration.js";
import { DwellBoard } from "./board.js";
import { Keyboard, defaultPhrases, display } from "./keyboard.js";
import { LOCALES, detectLanguage, locale, setLanguage, t, translatePage } from "./i18n.js";
import { API_HEADERS, ClonedVoice, voiceLanguage } from "./voice.js";
import { Dasher, LetterModel } from "./dasher.js";
import { DrawPad } from "./draw.js";
import { GESTURE_MODES, GestureDetector } from "./gestures.js";
import { Lexicon, addPersonal, groupLetters, priorFromChildren, recognize, recognizeWord } from "./recognizer.js";
import { Predictor, normalize } from "./predictor.js";
import { CalibrationPool } from "./pool.js";
import { PostureMonitor, meanPose } from "./posture.js";
import { CLEAN_INDICES, CONTROL_MODES, STABILITY } from "./features.js";

const $ = (s) => document.querySelector(s);
const POOL_KEY = "sguardo.calibrazioni.v1";
const SETTINGS_KEY = "sguardo.settings.v1";
const LEXICON_KEY = "sguardo.lessico.v1";
const PHRASES_KEY = "sguardo.frasi.v1";
const DRAW_KEY = "sguardo.scrittura-a-mano.v1";

const MENU_EYES_CLOSED_MS = 2000;     // occhi chiusi per aprire il menu
const RECAL_MIN_INTERVAL_MS = 60_000; // non riproporre la ricalibrazione troppo spesso
const SNOOZE_MS = 180_000;            // dopo "Non ora"
const PROMPT_SECONDS = 5;             // conto alla rovescia prima della ricalibrazione rapida
const RESULT_AUTO_SECONDS = 10;       // dopo la calibrazione si prosegue da soli
// Come si abbassa la penna della scrittura a mano: un gesto (gestures.js) o una cella accanto al
// disegno. Ordine del menu; i nomi sono nella lingua in uso (penmode.*).
const PEN_MODES = ["wink", "mouth", "cell"];
const penLabel = (m) => t(`penmode.${m}`);
const RESULT_GRACE_MS = 3000;         // all'apertura del risultato le celle non scelgono: lo sguardo è ancora dov'era

// ?mouse nell'indirizzo: il mouse fa le veci dello sguardo (per provare la tastiera senza calibrare).
const MOUSE_MODE = new URLSearchParams(location.search).has("mouse");

const screens = { start: $("#start"), board: $("#board"), dasher: $("#dasher"), draw: $("#draw"), calib: $("#calib"), result: $("#result"), prompt: $("#prompt") };
const video = $("#video");
const dot = $("#gaze-dot");

const tracker = new GazeTracker(video);
const calibrator = new Calibrator($("#calib"), $("#calib-target"), $("#calib-msg"));
const select = (item, count) => item.action(count);
const board = new DwellBoard($("#board"), select);
const resultBoard = new DwellBoard($("#result-cells"), select);
const promptBoard = new DwellBoard($("#prompt-cells"), select);
const drawBoard = new DwellBoard($("#draw-cells"), select);
const posture = new PostureMonitor();
const voice = new ClonedVoice();
const filterX = new OneEuro();
const filterY = new OneEuro();

// dasherLayout: "auto" mette le lettere sul lato lungo dello schermo (orizzontale su PC e telefono
// girato, verticale su telefono in verticale): nel simulatore (tools/simulate-dasher.mjs) lettere
// più grandi danno il 92% di frasi completate contro il 62%, con il 75% di cancellazioni in meno.
const settings = { dwellMs: 1000, showDot: true, dasherSpeed: 1, dasherLayout: "auto", background: "auto", control: "eyes", drawGapMs: 2000, penStillMs: 700, penMode: "wink", penDelayMs: 800, penSens: 1, ...load(SETTINGS_KEY) };
if (!CONTROL_MODES.includes(settings.control)) settings.control = "eyes";
if (!PEN_MODES.includes(settings.penMode)) settings.penMode = "wink";

// Lingua: quella scelta (salvata solo se scelta davvero), altrimenti la lingua del browser. Cambiarla
// ricarica la pagina: parole, tastiera e frasi dipendono dalla lingua. Ciò che la persona impara
// (parole, frasi salvate) è separato per lingua; per l'italiano le chiavi sono quelle di sempre.
const lang = detectLanguage(settings.lang);
setLanguage(lang);
translatePage();
Object.assign(voiceLanguage, { xtts: locale().xtts, ui: lang }); // la voce clonata parla nella lingua scelta
const perLanguage = (key) => (lang === "it" ? key : `${key}:${lang}`);
for (const select of document.querySelectorAll("select.lang-select")) {
  select.replaceChildren(...Object.values(LOCALES).map((l) => new Option(l.name, l.code)));
  select.value = lang;
  select.addEventListener("change", () => {
    settings.lang = select.value;
    save(SETTINGS_KEY, settings);
    location.reload();
  });
}

// Sfondo: chiaro sul telefono (lo schermo vicino al viso lo illumina, la fotocamera amplifica
// meno e i punti del viso sono meno rumorosi), scuro sul PC. Non si sceglie misurando la luce
// sul viso: la fotocamera regola da sola l'esposizione e l'immagine sembra sempre illuminata.
const BACKGROUNDS = ["auto", "light", "dark"];

function lightBackground() {
  if (settings.background !== "auto") return settings.background === "light";
  return matchMedia("(pointer: coarse)").matches;
}
const DASHER_LAYOUTS = ["auto", "horizontal", "vertical"];

function dasherOrientation() {
  if (settings.dasherLayout !== "auto") return settings.dasherLayout;
  return innerWidth >= innerHeight ? "horizontal" : "vertical";
}
let keyboard = null;
let dasher = null;
let drawPad = null;
let drawModel = null;     // probabilità delle lettere, per aiutare il riconoscimento
let drawLexicon = null;   // parole del dizionario per lunghezza, per leggere le parole disegnate
const gestures = new GestureDetector(); // gesto che muove la penna (modi occhiolino, bocca, inclinazione)
let drawLast = null;      // ultimo disegno: { letters, kind, before, suffix, alternatives }
const drawPersonal = load(DRAW_KEY) ?? {}; // lettere insegnate scegliendo tra le alternative
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
const recent = [];
const recentPoses = [];

// Ultime posizioni stimate (prima dello scostamento), per "Ricentra" nelle modalità con la testa,
// e scostamento applicato da "Ricentra": il collo si stanca e la posizione di riposo deriva.
const rawPreds = [];
let centerOffset = [0, 0];

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
  watchGesture(f);
  if (!model || !f.face) {
    gaze = null;
    filterX.reset();
    filterY.reset();
  } else if (!f.blink && !(mode === "draw" && gestures.active)) {
    // Durante un battito di ciglia l'iride non è visibile: si tiene l'ultima posizione. Lo stesso
    // mentre si fa il gesto della penna nella scrittura a mano, così il puntatore non si sposta.
    const [rx, ry] = predict(model, f.features);
    rawPreds.push([rx, ry]);
    if (rawPreds.length > 30) rawPreds.shift();
    const nx = rx + centerOffset[0], ny = ry + centerOffset[1];
    const x = clamp(nx, -0.05, 1.05) * innerWidth;
    const y = clamp(ny, -0.05, 1.05) * innerHeight;
    gaze = { x: filterX.filter(x, f.t / 1000), y: filterY.filter(y, f.t / 1000) };
  }
  eyesClosed = f.face && f.blink;
  renderDot();
  // A penna abbassata il puntatore disegna: non deve selezionare le celle che sfiora.
  activeBoard()?.update(mode === "draw" && drawPad?.pen ? null : gaze, f.t, eyesClosed);

  if (mode === "board" || mode === "dasher" || mode === "draw") {
    watchEyesClosed(f);
    watchPosture(f);
  }
};

function activeBoard() {
  return { board, result: resultBoard, prompt: promptBoard, draw: drawBoard }[mode] ?? null;
}

// Fotogrammi al secondo elaborati: su un telefono possono essere pochi, e con pochi
// fotogrammi lo sguardo stimato trema di più.
const frameTimes = [];

function updateFaceStatus(f) {
  frameTimes.push(f.t);
  while (frameTimes.length && frameTimes[0] < f.t - 1000) frameTimes.shift();
  video.classList.toggle("face", f.face && !f.blink);
  video.classList.toggle("blink", f.face && f.blink);
  const state = !f.face ? t("status.noFace") : f.blink ? t("status.eyesClosed") : t("status.ok");
  $("#face-status").textContent = `${state} · ${frameTimes.length} fps`;
  // Sul telefono la barra con la miniatura è nascosta: lo stesso stato nella barra del testo.
  const chip = $("#cam-chip");
  chip.textContent = `${state} · ${frameTimes.length} fps`;
  chip.classList.toggle("face", f.face && !f.blink);
  chip.classList.toggle("blink", f.face && f.blink);
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

// Scrittura a mano con un gesto (occhiolino, bocca aperta, inclinazione): tenuto per il tempo del
// gesto, abbassa o alza la penna, una volta sola per gesto. Mostra anche il livello nella barra.
function watchGesture(f) {
  if (mode !== "draw" || !GESTURE_MODES.includes(settings.penMode)) {
    gestures.reset();
    if (drawPad) drawPad.level = null;
    return;
  }
  gestures.mode = settings.penMode;
  gestures.sensitivity = settings.penSens;
  if (gestures.update(f)) drawPad?.togglePen(f.t, gestures.backMsAt(f.t));
  if (drawPad) {
    drawPad.level = gestures.level;
    drawPad.levelLabel = penLabel(settings.penMode);
  }
}

// Postura cambiata rispetto all'ultima calibrazione: propone la ricalibrazione rapida.
function watchPosture(f) {
  // Con la testa che guida il puntatore, muoverla è il comando e non un disturbo da compensare.
  if (settings.control !== "eyes") return;
  if (!f.face || f.blink || !model) return;
  const now = performance.now();
  if (posture.update(f.pose, f.t) && now - lastRecalAt > RECAL_MIN_INTERVAL_MS && now > snoozeUntil) {
    promptRecalibration();
  }
}

// ---------- orientamento e dimensioni della finestra ----------

// La calibrazione vale per una forma della finestra. Girando il telefono destra e sinistra
// diventano alto e basso: ogni orientamento ha il suo archivio di calibrazioni (sul telefono
// cambiano le dimensioni di schermo e video). Se invece la finestra cambia di poco (la barra
// degli indirizzi che compare, lo schermo intero che si chiude) basta ricalibrare.
const RESIZE_TOLERANCE = 0.03;
let calibratedSize = null; // { w, h } della finestra durante l'ultima calibrazione
let resizeTimer = null;

// Ogni orientamento ha le sue calibrazioni: la prima volta completa, poi basta la rapida.
function calibrateForOrientation() {
  openPool();
  toast(t(model ? "calib.rotatedQuick" : "calib.rotatedFull", { o: t(innerWidth >= innerHeight ? "orientation.horizontal" : "orientation.vertical") }), 4000);
  calibrate(model ? "quick" : "full");
}

// Schermo piccolo (telefono): barra per chi assiste nascosta, si riapre con ⚙.
function updateCompact() {
  document.body.classList.toggle("compact", innerWidth < 700 || innerHeight < 500);
}
updateCompact();
$("#btn-tools").addEventListener("click", () => document.body.classList.toggle("show-tools"));

// L'orientamento si legge dalla forma della finestra: su molti Android le dimensioni dello
// schermo e del video della fotocamera non cambiano ruotando, quindi da sole non bastano.
// Restituisce un identificatore (fa parte delle chiavi delle calibrazioni salvate: non si traduce);
// il nome mostrato è orientation.horizontal / orientation.vertical.
function orientation() {
  return innerWidth >= innerHeight ? "orizzontale" : "verticale";
}

function baseDevice() {
  return `${screen.width}x${screen.height}@${video.videoWidth}x${video.videoHeight}`;
}

// L'archivio delle calibrazioni dipende da dispositivo, orientamento e modalità di controllo
// (le caratteristiche dei campioni sono diverse). Per gli occhi la chiave è quella delle versioni
// precedenti, così le calibrazioni già fatte restano valide.
function deviceKey() {
  const base = `${baseDevice()}|${orientation()}`;
  return settings.control === "eyes" ? base : `${base}|${settings.control}`;
}

function openPool() {
  const device = deviceKey();
  const key = `${POOL_KEY}:${device}`;
  // Archivi delle versioni precedenti (senza orientamento: un solo archivio sotto POOL_KEY, poi
  // uno per dimensioni di schermo e video): valgono per gli occhi in orizzontale, quello del PC.
  const previous = () => {
    if (orientation() !== "orizzontale" || settings.control !== "eyes") return undefined;
    const legacy = load(POOL_KEY);
    const old = load(`${POOL_KEY}:${baseDevice()}`) ?? (legacy?.device === baseDevice() ? legacy : undefined);
    return old ? { ...old, device } : undefined;
  };
  pool = new CalibrationPool(
    { load: () => load(key) ?? previous(), save: (data) => save(key, data) },
    device,
    settings.control,
  );
  model = pool.train();
  posture.setBaseline(pool.lastPose);
}

// Cosa muove il puntatore: occhi, testa o entrambi. Cambiandolo cambiano le caratteristiche
// dei campioni, quindi serve un'altra calibrazione (completa la prima volta, poi rapida).
function setControl(next) {
  if (!CONTROL_MODES.includes(next) || next === settings.control) return;
  settings.control = next;
  recent.length = 0;
  recentPoses.length = 0;
  rawPreds.length = 0;
  centerOffset = [0, 0];
  gaze = null;
  filterX.reset();
  filterY.reset();
  applySettings();
  if (!pool || MOUSE_MODE) return; // prima dell'avvio vale dall'avvio
  openPool();
  toast(t(model ? "calib.controlQuick" : "calib.controlFull", { c: t(`control.${next}`) }), 4000);
  calibrate(model ? "quick" : "full");
}

// "Ricentra": la testa si stanca e la posizione di riposo deriva. Si punta il centro dello
// schermo per qualche secondo e la posizione stimata si risposta lì. Durante il conto alla
// rovescia le selezioni sono sospese (si sta puntando il centro, non una cella).
const RECENTER_SECONDS = 3;
function recenter() {
  keyboard.showMain();
  board.cooldownUntil = performance.now() + (RECENTER_SECONDS + 0.5) * 1000;
  startCountdown(RECENTER_SECONDS, (n) => toast(t("recenter.tick", { n }), 1300), () => {
    const last = rawPreds.slice(-15);
    if (last.length < 5) {
      toast(t("recenter.noFace"), 3000);
      return;
    }
    const mx = last.reduce((a, q) => a + q[0], 0) / last.length;
    const my = last.reduce((a, q) => a + q[1], 0) / last.length;
    centerOffset = [0.5 - mx, 0.5 - my];
    toast(t("recenter.done"), 2000);
  });
  $("#center-mark").hidden = false;
}

addEventListener("resize", () => {
  updateCompact();
  board.relayout();
  if (mode === "draw") {
    showDrawCells();
    drawPad?.resize();
  }
  if (mode === "dasher" && dasher) {
    dasher.orientation = dasherOrientation();
    dasher.resize();
  }
  clearTimeout(resizeTimer);
  // Dopo una rotazione anche il video della fotocamera si gira, con un po' di ritardo.
  resizeTimer = setTimeout(checkWindowShape, 800);
});

let rotatedDuringCalibration = false;

function checkWindowShape() {
  if (!pool || MOUSE_MODE) return;
  if (mode === "calib" && deviceKey() !== pool.device) {
    // Girato durante la calibrazione: i punti erano per l'altra forma dello schermo. Si
    // interrompe e si riparte nel nuovo orientamento (vedi calibrate()).
    rotatedDuringCalibration = true;
    calibrator.abort();
    return;
  }
  if (!["board", "dasher", "draw", "result", "prompt"].includes(mode)) return;
  if (deviceKey() !== pool.device) {
    calibrateForOrientation();
    return;
  }
  if (!calibratedSize || !model) return;
  const dw = Math.abs(innerWidth - calibratedSize.w) / calibratedSize.w;
  const dh = Math.abs(innerHeight - calibratedSize.h) / calibratedSize.h;
  if ((dw > RESIZE_TOLERANCE || dh > RESIZE_TOLERANCE) && mode !== "prompt") promptRecalibration();
}

// ---------- schermate ----------

function show(name) {
  if (mode === "dasher" && name !== "dasher") dasher?.stop();
  if (mode === "draw" && name !== "draw") drawPad?.stop();
  mode = name;
  stopCountdown();
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  $("#compose").hidden = !["board", "dasher", "draw"].includes(name);
  // Nella scrittura continua e a mano la barra in alto si nasconde: più spazio per le lettere.
  $("#toolbar").hidden = ["start", "calib", "prompt", "dasher", "draw"].includes(name);
  for (const b of [board, resultBoard, promptBoard, drawBoard]) { b.reset(); b.fit(); }
  gestures.reset();
  if (name !== "draw") dot.classList.remove("pen");
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
  $("#center-mark").hidden = true;
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
      throw new Error(t("start.insecure"));
    }
    $("#btn-start").disabled = true;
    status.textContent = t("start.loadingWords");
    await setupKeyboard();
    if (MOUSE_MODE) {
      startMouseMode();
      return;
    }
    status.textContent = t("start.loadingModel");
    await tracker.load();
    status.textContent = t("start.startingCamera");
    await tracker.startCamera();
    tracker.start();
    keepScreenOn();

    openPool();
    // Con calibrazioni già salvate bastano 10 secondi per adattarsi alla postura di oggi.
    calibrate(model ? "quick" : "full");
  } catch (e) {
    $("#btn-start").disabled = false;
    status.classList.add("error");
    status.textContent =
      e.name === "NotAllowedError" ? t("start.denied")
      : e.name === "NotFoundError" ? t("start.noCamera")
      : e.message || String(e);
  }
});

// ---------- tastiera e menu ----------

async function setupKeyboard() {
  if (keyboard) return;
  let words = [];
  try {
    const res = await fetch(locale().wordsFile);
    if (res.ok) words = (await res.text()).split(/\r?\n/).filter(Boolean);
  } catch {
    // senza vocabolario restano i suggerimenti imparati dalla persona
  }
  const store = { load: () => load(perLanguage(LEXICON_KEY)), save: (data) => save(perLanguage(LEXICON_KEY), data) };
  const { apostropheInWord, starters } = locale();
  keyboard = new Keyboard(board, new Predictor(words, store, { apostropheInWord, starters }), {
    onChange: (text) => {
      $("#compose-text").textContent = display(text);
      $("#compose").scrollLeft = $("#compose").scrollWidth; // se il testo è lungo resta visibile la fine
      schedulePregeneration(text);
    },
    onSpeak: speak,
    phrases: { load: () => load(perLanguage(PHRASES_KEY)), save: (list) => save(perLanguage(PHRASES_KEY), list) },
    onPhraseSaved: (text) => voice.ready && voice.prefetch([text]),
  });
  keyboard.showMain();
}

// Menu usabile con lo sguardo: si apre tenendo gli occhi chiusi per 2 secondi.
function showMenu() {
  if (mode !== "board") show("board");
  const seconds = (settings.dwellMs / 1000).toFixed(2).replace(/0$/, "");
  const items = [
    { label: t("menu.recalibrate"), kind: "cmd", action: () => calibrate("quick") },
    { label: t("menu.fullCalibration"), kind: "cmd", action: () => calibrate("full") },
    { label: t("menu.dwellSlower", { s: seconds }), kind: "cmd", action: () => { changeDwell(250); showMenu(); } },
    { label: t("menu.dwellFaster", { s: seconds }), kind: "cmd", action: () => { changeDwell(-250); showMenu(); } },
    { label: t("menu.control", { c: t(`control.${settings.control}`) }), kind: "cmd", action: showControlMenu },
    settings.control !== "eyes" ? { label: t("menu.recenter"), kind: "cmd", action: recenter } : null,
    { label: t("menu.dot", { v: t(settings.showDot ? "yes" : "no") }), kind: "cmd", action: () => { toggleDot(); showMenu(); } },
    {
      label: t("menu.background", { b: t(`background.${settings.background}`) }),
      kind: "cmd",
      action: () => {
        const wasLight = lightBackground();
        settings.background = BACKGROUNDS[(BACKGROUNDS.indexOf(settings.background) + 1) % BACKGROUNDS.length];
        applySettings();
        showMenu();
        // La luce sul viso è cambiata: la calibrazione fatta con l'altro sfondo vale meno.
        if (lightBackground() !== wasLight && model) toast(t("menu.backgroundChanged"), 5000);
      },
    },
    { label: t("menu.dasher"), kind: "cmd", action: startDasher },
    { label: t("menu.dasherSettings"), kind: "cmd", action: showDasherMenu },
  ];
  items[10] = { label: t("menu.draw"), kind: "cmd", action: showDrawMenu };
  items[11] = { label: t("menu.back"), kind: "cmd", action: () => keyboard.showMain() };
  board.setLayout(4, 3, items);
}

// Cosa muove il puntatore. Scegliere un'altra modalità avvia la calibrazione per quella modalità.
function showControlMenu() {
  const choice = (key) => ({
    label: `${key === settings.control ? "✓ " : ""}${t(`control.${key}`)}`,
    hint: t(`control.hint.${key}`),
    kind: key === settings.control ? "suggest" : "cmd",
    action: () => (key === settings.control ? showMenu() : setControl(key)),
  });
  const items = [choice("eyes"), choice("head"), choice("both")];
  items[11] = { label: t("menu.backToMenu"), kind: "cmd", action: showMenu };
  board.setLayout(4, 3, items);
}

function showDasherMenu() {
  const items = [
    { label: t("dasher.slower", { v: settings.dasherSpeed.toFixed(1) }), kind: "cmd", action: () => { changeDasherSpeed(-0.2); showDasherMenu(); } },
    { label: t("dasher.faster", { v: settings.dasherSpeed.toFixed(1) }), kind: "cmd", action: () => { changeDasherSpeed(0.2); showDasherMenu(); } },
    {
      label: t("dasher.layout", { l: t(`dasher.layout.${settings.dasherLayout}`) }),
      kind: "cmd",
      action: () => {
        settings.dasherLayout = DASHER_LAYOUTS[(DASHER_LAYOUTS.indexOf(settings.dasherLayout) + 1) % DASHER_LAYOUTS.length];
        applySettings();
        showDasherMenu();
      },
    },
    { label: t("dasher.start"), kind: "suggest", action: startDasher },
  ];
  items[11] = { label: t("menu.backToMenu"), kind: "cmd", action: showMenu };
  board.setLayout(4, 3, items);
}

// Scrittura a mano: impostazioni e avvio.
function showDrawMenu() {
  const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const gesture = GESTURE_MODES.includes(settings.penMode);
  const taught = Object.values(drawPersonal).reduce((n, list) => n + list.length, 0);
  const next = () => {
    settings.penMode = PEN_MODES[(PEN_MODES.indexOf(settings.penMode) + 1) % PEN_MODES.length];
    if (drawPad) { drawPad.penMode = settings.penMode; drawPad.waiting = false; drawPad.arming = false; }
    gestures.reset();
    applySettings();
    showDrawMenu();
  };
  const step = (key, setting, delta, lo, hi, now) => ({
    label: t(key, { v: now }), kind: "cmd", action: () => { changeDraw(setting, delta, lo, hi); showDrawMenu(); },
  });
  const items = [
    { label: t("draw.start"), kind: "suggest", action: startDraw },
    { label: t("draw.pen", { m: penLabel(settings.penMode) }), hint: t("draw.penHint"), kind: "cmd", action: next },
    step("draw.gapShorter", "drawGapMs", -500, 1000, 5000, sec(settings.drawGapMs)),
    step("draw.gapLonger", "drawGapMs", 500, 1000, 5000, sec(settings.drawGapMs)),
    // Con i gesti la penna si alza solo col gesto: l'attesa da fermo c'è solo con la cella.
    settings.penMode === "cell" ? step("draw.stillShorter", "penStillMs", -100, 400, 1500, sec(settings.penStillMs)) : null,
    settings.penMode === "cell" ? step("draw.stillLonger", "penStillMs", 100, 400, 1500, sec(settings.penStillMs)) : null,
    step("draw.delayShorter", "penDelayMs", -100, 200, 2000, sec(settings.penDelayMs)),
    step("draw.delayLonger", "penDelayMs", 100, 200, 2000, sec(settings.penDelayMs)),
    gesture ? step("draw.sensEasier", "penSens", 0.1, 0.5, 2, settings.penSens.toFixed(1)) : null,
    gesture ? step("draw.sensHarder", "penSens", -0.1, 0.5, 2, settings.penSens.toFixed(1)) : null,
    taught ? { label: t("draw.forget", { n: taught }), kind: "cmd remove", action: () => { for (const k of Object.keys(drawPersonal)) delete drawPersonal[k]; save(DRAW_KEY, drawPersonal); showDrawMenu(); } } : null,
  ];
  items[11] = { label: t("menu.backToMenu"), kind: "cmd", action: showMenu };
  board.setLayout(4, 3, items);
}

function changeDraw(key, delta, lo, hi) {
  settings[key] = Math.round(clamp(settings[key] + delta, lo, hi) * 100) / 100;
  if (drawPad) { drawPad.gapMs = settings.drawGapMs; drawPad.stillMs = settings.penStillMs; drawPad.startDelayMs = settings.penDelayMs; }
  applySettings();
}

// Probabilità delle lettere per la scrittura continua e a mano: accenti e apostrofo della lingua in uso.
function letterModel() {
  const { accents, apostropheInWord } = locale();
  return new LetterModel(keyboard.predictor.words, keyboard.predictor.user.uni, { accents, apostropheInWord }); // include le parole imparate
}

// Scrittura a mano: il puntatore disegna una lettera o una parola; il testo è quello della tastiera.
function startDraw() {
  show("draw");
  drawModel = letterModel();
  drawLexicon = new Lexicon(keyboard.predictor.words, keyboard.predictor.user.uni);
  drawLast = null;
  drawPad ??= new DrawPad($("#draw-canvas"), {
    getGaze: () => gaze,
    isPaused: () => eyesClosed,
    onDrawing: onDrawing,
    onPen: (down) => dot.classList.toggle("pen", down),
    onWait: () => { if (mode === "draw") showDrawCells(); }, // cella "Penna": pronta / non più pronta
  });
  drawPad.gapMs = settings.drawGapMs;
  drawPad.stillMs = settings.penStillMs;
  drawPad.startDelayMs = settings.penDelayMs;
  drawPad.penMode = settings.penMode;
  drawPad.light = lightBackground();
  drawPad.pointerPens = MOUSE_MODE;
  drawPad.waiting = false;
  showDrawCells();
  drawPad.start();
}

// Un disegno finito: una lettera si aggiunge alla parola in corso; più lettere in fila sono una
// parola intera, scelta nel dizionario con tutte le lettere insieme, e si scrive con lo spazio.
function onDrawing(strokes) {
  const letters = groupLetters(strokes, Math.min(drawPad.rect.width, drawPad.rect.height) * 0.05);
  if (!letters.length) {
    toast(t("draw.tooSmall"), 2500);
    return;
  }
  const text = keyboard.text;
  if (letters.length === 1) {
    const ranked = recognize(letters[0], { prior: priorFromChildren(drawModel.children(text)), personal: drawPersonal });
    if (!ranked) return;
    keyboard.setText(text + ranked[0].ch.toLowerCase());
    drawLast = { letters, kind: "letter", before: text, suffix: "", alternatives: ranked.slice(1, 3).map((r) => r.ch.toLowerCase()) };
    drawPad.flash(ranked[0].ch);
  } else {
    const words = recognizeWord(letters, { lexicon: drawLexicon, personal: drawPersonal });
    if (!words) return;
    const before = text && !/\s$/.test(text) ? `${text} ` : text; // la parola disegnata sta a sé
    keyboard.setText(`${before}${words[0].text} `);
    drawLast = { letters, kind: "word", before, suffix: " ", alternatives: words.slice(1, 3).map((w) => w.text) };
    drawPad.flash(words[0].text);
  }
  showDrawCells();
}

// Un'alternativa scelta sostituisce ciò che è stato scritto, e quel disegno diventa un modello
// personale: ogni lettera disegnata per la lettera giusta della parola scelta.
function pickDrawAlternative(choice) {
  if (!drawLast) return;
  const key = normalize(choice).toUpperCase(); // senza accenti; ß = ss, œ = oe
  if (/^[A-Z]+$/.test(key) && key.length === drawLast.letters.length) {
    drawLast.letters.forEach((strokes, i) => addPersonal(drawPersonal, key[i], strokes));
    save(DRAW_KEY, drawPersonal);
  }
  keyboard.setText(drawLast.before + choice + drawLast.suffix);
  drawLast = null;
  showDrawCells();
}

// Celle accanto al disegno: suggerimenti di parole, alternative all'ultima lettera, comandi.
function showDrawCells() {
  const after = (fn) => (...args) => { drawLast = null; fn(...args); showDrawCells(); };
  const suggestion = (w) => w && { label: w, kind: "suggest", action: after(() => keyboard.applySuggestion(w)) };
  const alternative = (c) => c && { label: drawLast.kind === "letter" ? c.toUpperCase() : c, kind: drawLast.kind === "letter" ? "letter" : "suggest", hint: t("draw.maybe"), action: () => pickDrawAlternative(c) };
  const [s1, s2] = keyboard.predictor.suggest(keyboard.text, 2);
  const [a1, a2] = drawLast?.alternatives ?? [];
  const waiting = drawPad?.waiting;
  // Modo "cella accanto": fissandola la penna è pronta e la preparazione parte al rientro nel disegno.
  const penCell = settings.penMode === "cell" && {
    label: waiting ? t("draw.penCellReady") : t("draw.penCell"),
    hint: waiting ? undefined : t("draw.penCellHint"),
    kind: waiting ? "suggest" : "cmd",
    action: () => drawPad.requestPen(),
  };
  const items = [
    suggestion(s1), suggestion(s2), alternative(a1), alternative(a2),
    ...(penCell ? [penCell] : []),
    { label: t("kb.space"), kind: "cmd", action: after(() => keyboard.space()) },
    { label: t("kb.delete"), hint: t("kb.deleteHint"), kind: "cmd", hold: { key: "cancella", repeatMs: 1500 },
      action: after((count = 1) => (count <= 1 ? keyboard.backspace() : keyboard.deleteWord())) },
    { label: t("kb.speak"), kind: "cmd speak", action: after(() => keyboard.speakText()) },
    { label: t("kb.keyboard"), kind: "cmd", action: () => { keyboard.showMain(); show("board"); } },
  ];
  // Schermo largo: celle in colonna a destra; in verticale: in fila sotto il disegno. Con la cella
  // "Penna" sono nove: 2x5 (una vuota) o 3x3; altrimenti otto: 2x4 o 4x2.
  const list = items;
  const wide = innerWidth >= innerHeight;
  if (penCell) drawBoard.setLayout(wide ? 2 : 3, wide ? 5 : 3, list, false);
  else drawBoard.setLayout(wide ? 2 : 4, wide ? 4 : 2, list, false);
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
  dasher.model = letterModel();
  dasher.speed = settings.dasherSpeed;
  dasher.orientation = dasherOrientation();
  dasher.light = lightBackground();
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
    const { indices, sd: limit } = STABILITY[settings.control];
    return indices.every((j) => sd(recent.map((f) => f[j])) < limit);
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
    const intro = [t(`calib.intro.${settings.control}.quick`), t(`calib.intro.${settings.control}.full`)];
    await calibrator.intro(quick ? intro[0] : intro[1], settings.control === "eyes" ? (quick ? 2000 : 3000) : (quick ? 3000 : 5000));
    const calib = await calibrator.runPoints(quick ? QUICK_POINTS : CALIB_POINTS, sampler);
    const points = calib.fixations.map(({ point, samples }) => ({ point, samples: usable(samples) }));
    if (points.reduce((s, p) => s + p.samples.length, 0) < calib.fixations.length * 8) {
      throw new Error(t("calib.noFace"));
    }
    const pose = meanPose(calib.fixations.flatMap(({ samples }) => samples.map((s) => s.pose)));

    let stats = null;
    let validation = [];
    if (!quick) {
      // Errore misurato su punti che il modello non ha visto, con l'archivio pesato per postura.
      const candidate = pool.train(points.map(({ point, samples }) => ({ point, samples: cleanSamples(samples, CLEAN_INDICES[settings.control]) })), pose);
      calibrator.msg.textContent = "";
      validation = (await calibrator.runPoints(VALIDATION_POINTS, sampler)).fixations;
      stats = measureError(candidate, validation);
      // I fotogrammi presi mentre il punto si muoveva non entrano nel modello (sulle registrazioni
      // peggiorano la stima: 99 -> 109–115 px), ma si salvano con "Salva dati" per analisi future.
      lastSession = {
        date: new Date().toISOString(),
        control: settings.control,
        userAgent: navigator.userAgent,
        screen: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
        video: { w: video.videoWidth, h: video.videoHeight },
        calib: calib.fixations,
        validation,
        pursuit: calib.pursuit,
      };
    }

    pool.add(kind, [...points, ...validation.map(({ point, samples }) => ({ point, samples: usable(samples) }))], pose);
    calibratedSize = { w: innerWidth, h: innerHeight };
    centerOffset = [0, 0]; // la nuova calibrazione definisce il centro
    model = pool.train();
    posture.setBaseline(pose);
    lastRecalAt = performance.now();
    filterX.reset();
    filterY.reset();
    keyboard.showMain();
    if (quick) {
      show("board");
      toast(t("calib.done"));
    } else {
      showResult(stats);
    }
  } catch (e) {
    if (e instanceof Aborted) {
      if (rotatedDuringCalibration) {
        rotatedDuringCalibration = false;
        calibrateForOrientation();
        return;
      }
      show(model ? "board" : "start");
      return;
    }
    if (quick && model) {
      // Si resta con il modello di prima; il controllo della postura riproverà più tardi.
      lastRecalAt = performance.now();
      keyboard.showMain();
      show("board");
      toast(t("calib.failedQuick", { m: e.message || "" }), 5000);
      return;
    }
    showResult({ error: e.message || String(e) });
  }
}

function promptRecalibration() {
  show("prompt");
  promptBoard.setLayout(3, 1, [
    null,
    { label: t("prompt.notNow"), kind: "cmd", action: () => { snoozeUntil = performance.now() + SNOOZE_MS; show("board"); } },
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
  if (!errs.length) return { error: t("calib.noData") };
  return { meanPx: errs.reduce((s, e) => s + e, 0) / errs.length, diag, sessions: pool.size };
}

// again: riaperta a mano dalla barra (niente proseguimento automatico).
function showResult(r, again = false) {
  if (!r.error) lastResult = r;
  const body = $("#result-body");
  const goOn = { label: t("result.continue"), kind: "suggest", action: () => show("board") };
  if (r.error) {
    $("#result-title").textContent = t("result.failedTitle");
    body.textContent = r.error;
    resultBoard.setLayout(2, 1, [{ label: t("result.retry"), kind: "cmd", action: () => calibrate("full") }, model ? goOn : null]);
  } else {
    const pct = ((r.meanPx / r.diag) * 100).toFixed(1);
    $("#result-title").textContent = t("result.doneTitle");
    body.innerHTML = t("result.body", { px: Math.round(r.meanPx), pct, n: r.sessions });
    // "Continua" per prima: a fine calibrazione lo sguardo resta dove era e finire per sbaglio su
    // "Ricalibra" faceva ripartire la calibrazione in continuazione.
    resultBoard.setLayout(2, 1, [goOn, { label: t("result.recalibrate"), kind: "cmd", action: () => calibrate("full") }]);
  }
  $("#btn-diag").hidden = $("#btn-download").hidden = !(lastSession && !r.error);
  $("#btn-download").textContent = t("result.save");
  $("#btn-download").disabled = false;
  show("result");
  resultBoard.cooldownUntil = performance.now() + RESULT_GRACE_MS;
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
  ctx.fillText(t("result.diagnostics"), innerWidth / 2, innerHeight / 2);
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
    button.textContent = t("result.saved", { file });
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
  button.textContent = t("result.downloaded");
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
    u.lang = locale().speech;
    const v = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(locale().code));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {
    // Sintesi vocale non disponibile: resta il testo nella barra.
  }
}

// Frasi da tenere sempre pronte con la voce clonata: predefinite e salvate dalla persona.
function phrasesToKeep() {
  return [...defaultPhrases().map((p) => p.say), ...(load(perLanguage(PHRASES_KEY)) ?? [])];
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
    el.textContent = t("voice.notInstalled");
    $("#voice-controls").hidden = $("#voice-try").hidden = true;
    return;
  }
  if (!s.local) {
    // Dal telefono (serve.py --https): la voce si usa, ma si prepara solo dal PC.
    el.textContent = s.cloned && s.license ? t("voice.remoteReady") : t("voice.remoteNone");
    $("#voice-controls").hidden = $("#voice-try").hidden = $("#voice-license").hidden = true;
    return;
  }
  $("#voice-license").hidden = s.license;
  const saved = s.samples.length ? t("voice.savedSamples", { n: s.samples.length }) : "";
  el.textContent = message ?? (s.cloned && s.license
    ? t("voice.ready", { loading: s.state === "caricamento" ? t("voice.readyLoading") : "", saved })
    : t("voice.prompt", { saved }));
  $("#voice-try").hidden = !(s.cloned && s.license);
}

$("#voice-files").addEventListener("change", updateChosenLabel);

function updateChosenLabel() {
  const parts = [];
  const n = $("#voice-files").files.length;
  if (n) parts.push(t("voice.filesChosen", { n }));
  if (recordings.length) {
    const seconds = Math.round(recordings.reduce((s, r) => s + r.seconds, 0));
    parts.push(t("voice.recordings", { n: recordings.length, s: seconds }));
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
    renderVoice(e.name === "NotAllowedError" ? t("voice.micDenied") : t("voice.micUnavailable", { m: e.message }));
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
    recordings.push({ file: new File([blob], `${t("voice.recordingName")}-${recordings.length + 1}.${ext}`, { type }), seconds });
    const preview = $("#record-preview");
    preview.src = URL.createObjectURL(blob);
    preview.hidden = false;
    $("#record-panel").hidden = true;
    $("#btn-record").disabled = false;
    recorder = null;
    updateChosenLabel();
    renderVoice(t("voice.recorded", { s: Math.round(seconds) }));
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
    renderVoice(t("voice.chooseFirst"));
    return;
  }
  if (!voice.status.license) {
    if (!$("#voice-license-check").checked) {
      renderVoice(t("voice.acceptFirst"));
      $("#voice-status").classList.add("error");
      return;
    }
    await voice.acceptLicense();
  }
  button.disabled = true;
  try {
    for (const [i, f] of files.entries()) {
      renderVoice(t("voice.uploading", { name: f.name, i: i + 1, n: files.length }));
      await voice.upload(f);
    }
    renderVoice(t("voice.cloning"));
    const { seconds } = await voice.clone();
    $("#voice-files").value = "";
    recordings.length = 0;
    $("#record-preview").hidden = true;
    updateChosenLabel();
    renderVoice(t("voice.cloned", { s: seconds }));
    voice.prefetch(phrasesToKeep());
  } catch (e) {
    renderVoice(t("voice.cloneFailed", { m: e.message }));
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
  renderVoice(t("voice.generating"));
  try {
    const started = performance.now();
    await voice.play(text);
    renderVoice(t("voice.generated", { s: ((performance.now() - started) / 1000).toFixed(1) }));
  } catch (e) {
    renderVoice(t("voice.error", { m: e.message }));
    $("#voice-status").classList.add("error");
  } finally {
    button.disabled = false;
  }
});

$("#btn-voice-reset").addEventListener("click", async () => {
  if (!confirm(t("voice.confirmReset"))) return;
  await voice.reset();
  renderVoice();
});

setupVoice();

// ---------- impostazioni (dalla barra per chi assiste o dal menu con lo sguardo) ----------

function applySettings() {
  board.dwellMs = resultBoard.dwellMs = promptBoard.dwellMs = settings.dwellMs;
  $("#dwell-value").textContent = `${(settings.dwellMs / 1000).toFixed(2).replace(/0$/, "")} s`;
  $("#btn-dot").textContent = t("bar.dot", { v: t(settings.showDot ? "yes" : "no") });
  tracker.mode = settings.control;
  for (const select of document.querySelectorAll("select.control-select")) select.value = settings.control;
  document.body.classList.toggle("light", lightBackground());
  if (dasher) dasher.light = lightBackground();
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
$("#btn-draw").addEventListener("click", () => { if (keyboard && ["board", "dasher"].includes(mode)) startDraw(); });
$("#btn-calib").addEventListener("click", () => calibrate("full"));
for (const select of document.querySelectorAll("select.control-select")) {
  select.addEventListener("change", () => setControl(select.value));
}
if (MOUSE_MODE) for (const el of document.querySelectorAll(".control-pick, #control-toolbar")) el.hidden = true;
$("#btn-last-result").addEventListener("click", () => {
  if (lastResult) showResult(lastResult, true);
  else toast(t("result.none"), 4000);
});
$("#btn-reset").addEventListener("click", () => {
  if (!pool || !confirm(t("reset.confirm"))) return;
  // Tutti gli archivi: uno per orientamento, più quello del formato precedente.
  try {
    for (const k of Object.keys(localStorage)) if (k === POOL_KEY || k.startsWith(`${POOL_KEY}:`)) localStorage.removeItem(k);
  } catch { /* storage non disponibile */ }
  pool.clear();
  model = null;
  calibrate("full");
});
$("#btn-diag").addEventListener("click", showDiagnostics);
$("#btn-download").addEventListener("click", saveSession);
$("#diag").addEventListener("click", () => ($("#diag").hidden = true));

addEventListener("keydown", (e) => {
  if (mode === "start" || (MOUSE_MODE && !"mdh".includes(e.key))) return;
  if (e.key === "Escape" && mode === "calib") calibrator.abort();
  else if (mode === "calib") return;
  else if (e.key === "c") calibrate("full");
  else if (e.key === "r") calibrate("quick");
  else if (e.key === "m" && (mode === "board" || mode === "dasher")) showMenu();
  else if (e.key === "d" && mode === "board") startDasher();
  else if (e.key === "h" && mode === "board") startDraw();
  else if (e.key === "p") toggleDot();
});

applySettings();

// La scrittura continua disegna su un canvas: va ridimensionato con la finestra.

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
