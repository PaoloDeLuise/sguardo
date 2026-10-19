// Tabellone a celle grandi: si seleziona una cella guardandola per un tempo (dwell).
// Il contenuto cambia con setLayout() (gruppi di lettere, lettere, frasi...).
//
// La scelta della cella è in dwell.js: ogni cella accumula "prove" quando lo sguardo ci cade
// vicino e le perde lentamente quando non la si guarda, quindi il tremolio dello sguardo non fa
// ripartire da zero. Simulato (tools/simulate-dwell.mjs): sul telefono la cella giusta passa dal
// 51% al 75% dei tentativi e quelli senza selezione dal 33% al 4%; sul PC dal 97% al 99%.

import { DwellSelector } from "./dwell.js";

const COOLDOWN_MS = 1200;

export class DwellBoard {
  // onSelect(item, count) riceve l'elemento della cella scelta. count conta le ripetizioni
  // delle celle "da tenere" (item.hold = { key, repeatMs }): continuando a guardarle l'azione
  // si ripete ogni repeatMs, con count = 2, 3, ... (per esempio: lettera, poi parole intere).
  constructor(container, onSelect) {
    this.container = container;
    this.onSelect = onSelect;
    this.dwellMs = 1000;
    this.cells = [];
    this.selector = new DwellSelector({ method: "accumulate", normalize: true, sigmaPx: 60, decay: 0.5 });
    this.leader = null;
    this.cooldownUntil = 0;
    this.holding = null; // { key, index, count } mentre si tiene lo sguardo su una cella "da tenere"
  }

  // items: array di { label, kind, ... } o null per le celle vuote, riga per riga.
  // kind: "letter" | "group" | "suggest" | "cmd" | "phrase" (solo per lo stile).
  setLayout(cols, rows, items) {
    this.layout = [cols, rows, items];
    // Schermo più alto che largo (telefono in verticale): la griglia si traspone, 4x3 diventa
    // 3x4. Gli angoli restano angoli (Sì e No, "Indietro" in basso a destra) e le celle non
    // diventano strisce strette.
    if (innerHeight > innerWidth && cols > rows) {
      const t = [];
      items.forEach((item, i) => { t[(i % cols) * rows + Math.floor(i / cols)] = item; });
      [cols, rows, items] = [rows, cols, t];
    }
    this.reset();
    this.container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    this.container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    this.container.replaceChildren();
    this.cells = [];
    for (let i = 0; i < cols * rows; i++) {
      const item = items[i] ?? null;
      const el = document.createElement("div");
      el.className = item ? `cell ${item.kind ?? ""}` : "cell empty";
      if (item) {
        el.innerHTML = `<div class="fill"></div><div class="label"></div>`;
        el.querySelector(".label").textContent = item.label;
        if (item.hint) {
          const hint = document.createElement("div");
          hint.className = "hint";
          hint.textContent = item.hint;
          el.appendChild(hint);
        }
        el.item = item;
        el.addEventListener("click", () => this.onSelect(item, 1)); // per chi assiste, con mouse o dito
        this.cells.push(el);
      }
      this.container.appendChild(el);
    }
  }

  // Dopo una rotazione dello schermo: stessa griglia, ridisposta.
  relayout() {
    if (this.layout) this.setLayout(...this.layout);
  }

  // gaze: {x, y} in pixel della finestra, oppure null se lo sguardo non è disponibile.
  // paused: occhi chiusi. Un battito di ciglia non deve azzerare la fissazione,
  // ma nemmeno farla avanzare.
  update(gaze, t, paused = false) {
    const dt = t - (this.lastT ?? t);
    this.lastT = t;
    if (paused || dt <= 0 || !this.cells.length) return;
    if (t < this.cooldownUntil) return; // subito dopo una selezione lo sguardo si sta spostando

    const rects = this.cells.map((c) => c.getBoundingClientRect());
    const need = (i) => (this.continuesHold(this.cells[i]) ? this.cells[i].item.hold.repeatMs : this.dwellMs);
    const { progress, leader, selected } = this.selector.update(rects, gaze, dt, need);

    // Si riempiono tutte le celle che stanno accumulando; quella in vantaggio è evidenziata.
    this.cells.forEach((c, i) => this.setProgress(c, progress[i]));
    if (leader !== this.leader) {
      this.cells[this.leader]?.classList.remove("hover");
      this.cells[leader]?.classList.add("hover");
      this.leader = leader;
    }
    // Lo sguardo si è spostato su un'altra cella (o non c'è più): la ripetizione di "Cancella"
    // si interrompe. Subito dopo una ripetizione la griglia è ridisegnata e per un attimo nessuna
    // cella è in vantaggio: quello non interrompe.
    if (this.holding && (!gaze || (leader !== null && !this.continuesHold(this.cells[leader])))) this.holding = null;
    if (selected === null) return;

    const cell = this.cells[selected];
    flash(cell);
    this.selector.reset();
    this.cells.forEach((c) => this.setProgress(c, 0));
    if (cell.item.hold) {
      // Nessuna pausa: se lo sguardo resta lì, l'azione si ripete (anche se la griglia è
      // stata ridisegnata, purché la cella nella stessa posizione sia la stessa).
      const count = this.continuesHold(cell) ? this.holding.count + 1 : 1;
      this.holding = { key: cell.item.hold.key, index: this.indexOf(cell), count };
      this.onSelect(cell.item, count);
      return;
    }
    cell.classList.remove("hover");
    this.leader = null;
    this.cooldownUntil = t + COOLDOWN_MS;
    this.onSelect(cell.item, 1);
  }

  continuesHold(cell) {
    return Boolean(cell && this.holding && cell.item.hold?.key === this.holding.key && this.indexOf(cell) === this.holding.index);
  }

  indexOf(cell) {
    return [...this.container.children].indexOf(cell);
  }

  setProgress(cell, p) {
    cell?.style.setProperty("--p", p);
  }

  reset() {
    this.selector.reset();
    for (const c of this.cells) {
      this.setProgress(c, 0);
      c.classList.remove("hover");
    }
    this.leader = null;
  }
}

function flash(cell) {
  cell.classList.remove("selected");
  void cell.offsetWidth; // riavvia l'animazione
  cell.classList.add("selected");
}
