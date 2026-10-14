// Tabellone a celle grandi: si seleziona una cella fissandola per un tempo (dwell).
// Il contenuto cambia con setLayout() (gruppi di lettere, lettere, frasi...).

const HYSTERESIS = 0.1; // la cella corrente "trattiene" lo sguardo per il 10% oltre il bordo
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
    this.current = null;
    this.since = 0;
    this.cooldownUntil = 0;
    this.holding = null; // { key, index, count } mentre si tiene lo sguardo su una cella "da tenere"
  }

  // items: array di { label, kind, ... } o null per le celle vuote, riga per riga.
  // kind: "letter" | "group" | "suggest" | "cmd" | "phrase" (solo per lo stile).
  setLayout(cols, rows, items) {
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

  // gaze: {x, y} in pixel della finestra, oppure null se lo sguardo non è disponibile.
  // paused: occhi chiusi. Un battito di ciglia non deve azzerare la fissazione,
  // ma nemmeno farla avanzare.
  update(gaze, t, paused = false) {
    const dt = t - (this.lastT ?? t);
    this.lastT = t;
    if (paused) {
      this.since += dt;
      return;
    }
    const cell = gaze && t >= this.cooldownUntil ? this.hit(gaze) : null;
    if (cell !== this.current) {
      this.setProgress(this.current, 0);
      this.current?.classList.remove("hover");
      cell?.classList.add("hover");
      this.current = cell;
      this.since = t;
      if (!this.continuesHold(cell)) this.holding = null;
    }
    if (!cell) return;

    const holding = this.continuesHold(cell);
    const p = (t - this.since) / (holding ? cell.item.hold.repeatMs : this.dwellMs);
    this.setProgress(cell, Math.min(p, 1));
    if (p < 1) return;

    this.setProgress(cell, 0);
    this.current = null;
    flash(cell);
    if (cell.item.hold) {
      // Nessuna pausa: se lo sguardo resta lì, l'azione si ripete (anche se la griglia è
      // stata ridisegnata, purché la cella nella stessa posizione sia la stessa).
      const count = holding ? this.holding.count + 1 : 1;
      this.holding = { key: cell.item.hold.key, index: this.indexOf(cell), count };
      this.onSelect(cell.item, count);
      return;
    }
    cell.classList.remove("hover");
    this.cooldownUntil = t + COOLDOWN_MS;
    this.onSelect(cell.item, 1);
  }

  continuesHold(cell) {
    return Boolean(cell && this.holding && cell.item.hold?.key === this.holding.key && this.indexOf(cell) === this.holding.index);
  }

  indexOf(cell) {
    return [...this.container.children].indexOf(cell);
  }

  hit({ x, y }) {
    if (this.current && inside(this.current.getBoundingClientRect(), x, y, HYSTERESIS)) return this.current;
    return this.cells.find((c) => inside(c.getBoundingClientRect(), x, y, 0)) ?? null;
  }

  setProgress(cell, p) {
    cell?.style.setProperty("--p", p);
  }

  reset() {
    this.setProgress(this.current, 0);
    this.current?.classList.remove("hover");
    this.current = null;
  }
}

function flash(cell) {
  cell.classList.remove("selected");
  void cell.offsetWidth; // riavvia l'animazione
  cell.classList.add("selected");
}

function inside(r, x, y, margin) {
  const mx = r.width * margin, my = r.height * margin;
  return x >= r.left - mx && x <= r.right + mx && y >= r.top - my && y <= r.bottom + my;
}
