// Chess board: animated pieces, drag and tap input, arrows and square highlights.
import { FILES, SQUARES } from './position.js';

const pieceURL = (p) => `pieces/${p === p.toUpperCase() ? 'w' : 'b'}${p.toUpperCase()}.svg`;
const DRAG_THRESHOLD = 6;

export class Board {
  /**
   * @param {HTMLElement} el container (kept square by CSS)
   * @param {object} opts
   *   interactive: accept input
   *   coords: draw file/rank labels
   *   onDrop(from, to|null) → bool: a piece was dragged; `to` is null off the board
   *   onTap(square): a square was tapped
   *   canDrag(square) → bool
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = { interactive: true, coords: true, ...opts };
    this.flipped = false;
    this.pieces = new Map(); // id → { el, piece, square }
    this.nextId = 1;
    this.el.classList.add('board');
    this.el.innerHTML = '';

    this.squaresLayer = div('board-squares');
    this.markLayer = div('board-marks');
    this.piecesLayer = div('board-pieces');
    this.arrowLayer = svg('svg');
    this.arrowLayer.setAttribute('class', 'board-arrows');
    this.arrowLayer.setAttribute('viewBox', '0 0 8 8');
    this.el.append(this.squaresLayer, this.markLayer, this.piecesLayer, this.arrowLayer);

    this.squareEls = {};
    for (let i = 0; i < 64; i++) {
      const sq = div('sq');
      this.squaresLayer.append(sq);
    }
    this.layoutSquares();
    if (this.opts.interactive) this.bindInput();
  }

  // MARK: Layout

  squareIndex(square) {
    const col = FILES.indexOf(square[0]);
    const row = 8 - Number(square[1]);
    return this.flipped ? { col: 7 - col, row: 7 - row } : { col, row };
  }

  squareAtPoint(x, y) {
    const r = this.el.getBoundingClientRect();
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return null;
    let col = Math.floor(((x - r.left) / r.width) * 8);
    let row = Math.floor(((y - r.top) / r.height) * 8);
    col = Math.min(7, Math.max(0, col));
    row = Math.min(7, Math.max(0, row));
    if (this.flipped) { col = 7 - col; row = 7 - row; }
    return FILES[col] + (8 - row);
  }

  layoutSquares() {
    const cells = [...this.squaresLayer.children];
    this.squareEls = {};
    SQUARES.forEach((sq, i) => {
      const { col, row } = this.squareIndex(sq);
      const cell = cells[i];
      cell.className = 'sq ' + ((FILES.indexOf(sq[0]) + Number(sq[1])) % 2 ? 'light' : 'dark');
      cell.style.gridColumn = col + 1;
      cell.style.gridRow = row + 1;
      cell.dataset.square = sq;
      cell.setAttribute('data-testid', `square-${sq}`);
      cell.innerHTML = '';
      if (this.opts.coords) {
        if (row === 7) cell.append(label('coord file', sq[0]));
        if (col === 0) cell.append(label('coord rank', sq[1]));
      }
      this.squareEls[sq] = cell;
    });
  }

  setFlipped(flipped) {
    if (flipped === this.flipped) return;
    this.flipped = flipped;
    this.layoutSquares();
    for (const p of this.pieces.values()) this.placePiece(p, false);
    this.renderMarks();
    this.renderArrows();
  }

  // MARK: Pieces

  /** Shows `board` ({ square: piece }), sliding pieces that moved. */
  setPosition(board, { animate = true } = {}) {
    this.board = { ...board };
    const current = [...this.pieces.values()];
    const next = Object.entries(board).map(([square, piece]) => ({ square, piece }));

    // Pieces that stay put keep their element.
    const unmatchedOld = [], unmatchedNew = [];
    for (const n of next) {
      const same = current.find((c) => !c.matched && c.square === n.square && c.piece === n.piece);
      if (same) same.matched = true;
      else unmatchedNew.push(n);
    }
    for (const c of current) if (!c.matched) unmatchedOld.push(c);

    // Moved pieces: pair each new placement with the nearest old one of the same kind.
    for (const n of unmatchedNew) {
      let best = null, bestDist = Infinity;
      for (const c of unmatchedOld) {
        if (c.matched || c.piece !== n.piece) continue;
        const d = dist(c.square, n.square);
        if (d < bestDist) { best = c; bestDist = d; }
      }
      if (best) {
        best.matched = true;
        best.square = n.square;
        this.placePiece(best, animate);
      } else {
        const p = { id: this.nextId++, piece: n.piece, square: n.square, el: document.createElement('img') };
        p.el.className = 'piece';
        p.el.src = pieceURL(n.piece);
        p.el.alt = '';
        p.el.draggable = false;
        this.piecesLayer.append(p.el);
        this.placePiece(p, false);
        if (animate) {
          p.el.animate([{ opacity: 0, transform: p.el.style.transform + ' scale(0.8)' },
                        { opacity: 1, transform: p.el.style.transform }], { duration: 180, easing: 'ease-out' });
        }
        this.pieces.set(p.id, p);
        p.matched = true;
      }
    }
    for (const c of unmatchedOld) {
      if (c.matched) continue;
      this.pieces.delete(c.id);
      if (animate) {
        c.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150 }).onfinish = () => c.el.remove();
      } else {
        c.el.remove();
      }
    }
    for (const p of this.pieces.values()) delete p.matched;

    for (const sq of SQUARES) this.squareEls[sq].dataset.piece = board[sq] || 'empty';
  }

  placePiece(p, animate) {
    const { col, row } = this.squareIndex(p.square);
    p.el.classList.toggle('animate', animate);
    p.el.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
  }

  // MARK: Marks and arrows

  /** { lastMove: [from, to], selected, hints: [], captures: [], check, marked: [] } */
  setMarks(marks) {
    this.marks = marks || {};
    this.renderMarks();
  }

  renderMarks() {
    const m = this.marks || {};
    this.markLayer.innerHTML = '';
    const add = (sq, cls) => {
      const { col, row } = this.squareIndex(sq);
      const e = div('mark ' + cls);
      e.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
      this.markLayer.append(e);
    };
    (m.lastMove || []).forEach((sq) => add(sq, 'last'));
    if (m.selected) add(m.selected, 'selected');
    if (m.check) add(m.check, 'check');
    (m.marked || []).forEach((sq) => add(sq, 'illegal'));
    (m.hints || []).forEach((sq) => add(sq, this.board?.[sq] ? 'capture' : 'hint'));
  }

  setArrows(arrows) {
    this.arrows = arrows || [];
    this.renderArrows();
  }

  renderArrows() {
    this.arrowLayer.innerHTML = '';
    for (const { from, to } of this.arrows || []) {
      const a = this.squareIndex(from), b = this.squareIndex(to);
      const x1 = a.col + 0.5, y1 = a.row + 0.5, x2 = b.col + 0.5, y2 = b.row + 0.5;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const head = 0.42, width = 0.15;
      const ex = x2 - ux * head, ey = y2 - uy * head;
      const line = svg('line');
      Object.entries({ x1: x1 + ux * 0.2, y1: y1 + uy * 0.2, x2: ex, y2: ey, 'stroke-width': width }).forEach(([k, v]) => line.setAttribute(k, v));
      line.setAttribute('class', 'arrow-line');
      const px = -uy, py = ux, hw = 0.24;
      const poly = svg('polygon');
      poly.setAttribute('points', `${x2 - ux * 0.08},${y2 - uy * 0.08} ${ex + px * hw},${ey + py * hw} ${ex - px * hw},${ey - py * hw}`);
      poly.setAttribute('class', 'arrow-head');
      this.arrowLayer.append(line, poly);
    }
  }

  // MARK: Input

  bindInput() {
    this.el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  pieceAt(square) {
    for (const p of this.pieces.values()) if (p.square === square) return p;
    return null;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const square = this.squareAtPoint(e.clientX, e.clientY);
    if (!square) return;
    e.preventDefault();
    const p = this.pieceAt(square);
    const draggable = p && (!this.opts.canDrag || this.opts.canDrag(square));
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    const rect = this.el.getBoundingClientRect();
    const size = rect.width / 8;

    const move = (ev) => {
      if (!draggable) return;
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        p.el.classList.remove('animate');
        p.el.classList.add('dragging');
        this.opts.onDragStart?.(square);
      }
      const x = ev.clientX - rect.left - size / 2, y = ev.clientY - rect.top - size / 2;
      p.el.style.transform = `translate(${x}px, ${y}px) scale(1.15)`;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!dragging) {
        this.opts.onTap?.(square);
        return;
      }
      p.el.classList.remove('dragging');
      const target = ev.type === 'pointercancel' ? square : this.squareAtPoint(ev.clientX, ev.clientY);
      const accepted = target !== square && this.opts.onDrop?.(square, target);
      if (!accepted) this.placePiece(p, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
}

function div(cls) {
  const e = document.createElement('div');
  e.className = cls;
  return e;
}

function label(cls, text) {
  const e = document.createElement('span');
  e.className = cls;
  e.textContent = text;
  return e;
}

function svg(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function dist(a, b) {
  return Math.hypot(FILES.indexOf(a[0]) - FILES.indexOf(b[0]), Number(a[1]) - Number(b[1]));
}
