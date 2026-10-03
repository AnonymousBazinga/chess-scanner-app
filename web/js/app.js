import { Board } from './board.js';
import {
  Chess, START_FEN, parsePlacement, placementOf, buildFEN, validationIssues, illegalSquares, isWhite, colorName,
} from './position.js';
import { loadRecognizer, recognize, usesServer } from './recognizer.js';
import { Engine, scoreText, winChance } from './engine.js';

const $ = (id) => document.getElementById(id);
const pieceURL = (p) => `pieces/${isWhite(p) ? 'w' : 'b'}${p.toUpperCase()}.svg`;
const vibrate = (ms = 8) => navigator.vibrate?.(ms);

// MARK: - Navigation

const stack = ['view-scan'];

function push(id) {
  const prev = $(stack.at(-1));
  prev.removeAttribute('data-active');
  prev.setAttribute('data-behind', '');
  stack.push(id);
  const next = $(id);
  next.removeAttribute('data-behind');
  requestAnimationFrame(() => next.setAttribute('data-active', ''));
  onViewChange();
}

function pop() {
  if (stack.length < 2) return;
  const leaving = $(stack.pop());
  leaving.removeAttribute('data-active');
  const next = $(stack.at(-1));
  next.removeAttribute('data-behind');
  next.setAttribute('data-active', '');
  onViewChange();
}

/** Replaces everything above the scan view with `ids`. */
function resetTo(...ids) {
  while (stack.length > 1) {
    const v = $(stack.pop());
    v.removeAttribute('data-active');
    v.removeAttribute('data-behind');
  }
  $('view-scan').setAttribute('data-active', '');
  ids.forEach(push);
}

document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', pop));

function onViewChange() {
  const top = stack.at(-1);
  if (top === 'view-scan') startCamera(); else stopCamera();
  if (top !== 'view-analysis') engine?.stop();
  else if (analysis) analysis.refreshEngine();
}

// MARK: - Toast, menus, sheets

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function showMenu(items) {
  const menu = $('menu');
  menu.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'menu-panel';
  for (const item of items) {
    const b = document.createElement('button');
    b.textContent = item.label;
    if (item.danger) b.className = 'danger';
    b.addEventListener('click', () => { menu.hidden = true; item.action(); });
    panel.append(b);
  }
  menu.append(panel);
  menu.hidden = false;
}
$('menu').addEventListener('click', (e) => { if (e.target.id === 'menu') e.currentTarget.hidden = true; });

function openSheet(id) { $(id).hidden = false; }
document.querySelectorAll('.sheet').forEach((sheet) => {
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });
  sheet.querySelector('[data-close]').addEventListener('click', () => { sheet.hidden = true; });
});

$('photo-full').addEventListener('click', () => { $('photo-full').hidden = true; });

// MARK: - History

const HISTORY_KEY = 'chess_scan_history';
const history = {
  items() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
  },
  add(fen, scanned) {
    const items = this.items().filter((i) => i.fen !== fen);
    items.unshift({ fen, scanned, ts: Date.now() });
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50))); } catch { /* storage off */ }
  },
  clear() {
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* storage off */ }
  },
};

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(ts) {
  const s = Math.round((ts - Date.now()) / 1000);
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= size) return relative.format(Math.round(s / size), unit);
  }
  return 'just now';
}

function renderHistory() {
  const list = $('history-list');
  list.innerHTML = '';
  const items = history.items();
  $('btn-clear-history').style.visibility = items.length ? 'visible' : 'hidden';
  if (!items.length) {
    list.innerHTML = '<div class="empty"><strong>No positions yet</strong>Positions you analyze are saved here.</div>';
    return;
  }
  for (const item of items) {
    const row = document.createElement('button');
    row.className = 'history-row';
    row.dataset.testid = 'history-row';
    const mini = document.createElement('div');
    mini.className = 'mini';
    const boardEl = document.createElement('div');
    mini.append(boardEl);
    new Board(boardEl, { interactive: false, coords: false }).setPosition(parsePlacement(item.fen.split(' ')[0]), { animate: false });
    const text = document.createElement('div');
    const white = item.fen.split(' ')[1] === 'w';
    text.innerHTML = `<strong>${item.scanned ? 'Scanned position' : 'Set up position'}</strong>
      <small><i class="dot ${white ? 'white' : 'black'}"></i> ${colorName(white)} to move</small>
      <small><time>${ago(item.ts)}</time></small>`;
    row.append(mini, text);
    row.addEventListener('click', () => {
      $('sheet-history').hidden = true;
      openAnalysis(item.fen);
    });
    list.append(row);
  }
}

$('btn-history').addEventListener('click', () => { renderHistory(); openSheet('sheet-history'); });
$('btn-clear-history').addEventListener('click', () => {
  if (confirm('Delete all saved positions?')) { history.clear(); renderHistory(); }
});

if (!usesServer) $('scan-privacy').textContent = 'Photos are processed in your browser and never uploaded.';

const CREDITS = [
  ['Structured scanner source', 'Automatic board geometry, model fusion and chess constraints. CameraChessWeb-derived preprocessing is AGPL-3.0; model weights retain their own licenses.', 'Source and license notices', 'https://github.com/AnonymousBazinga/chess-scanner-app/tree/web-version/web/scanner_backend'],
  ['Fenify-3D', 'Board recognition by Logan Spears.', 'MIT License', './licenses/Fenify-3D.txt'],
  ['CameraChessWeb', 'LeYOLO piece/grid detection and preprocessing by Pbatch.', 'GNU AGPL v3', './licenses/CameraChessWeb.txt'],
  ['Stockfish', 'Chess engine by the Stockfish developers; WASM build by Nathan Rugg and Chess.com.', 'GNU GPL v3', 'https://github.com/nmrugg/stockfish.js'],
  ['ChessQueries + ChessQ Lite V4', 'Board recognition models. Copyright (c) 2026 Joël Seytre.', 'PolyForm Noncommercial 1.0.0', 'https://chessq.org'],
  ['DINOv2', 'Image encoder in ChessQ Lite. Copyright (c) Meta Platforms, Inc. and affiliates.', 'Apache License 2.0', 'https://github.com/facebookresearch/dinov2'],
  ['Chess pieces', 'cburnett piece set by Colin M.L. Burnett.', 'CC BY-SA 3.0', 'https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces'],
  ['chess.js', 'Move generation and validation.', 'BSD 2-Clause', 'https://github.com/jhlywa/chess.js'],
  ['ONNX Runtime Web', 'In-browser model inference by Microsoft.', 'MIT License', 'https://onnxruntime.ai'],
];
$('credits').innerHTML = CREDITS.map(([name, detail, license, url]) =>
  `<li><a href="${url}" target="_blank" rel="noopener">${name}</a><small>${detail}</small><small>${license}</small></li>`).join('');
$('btn-about').addEventListener('click', () => { $('sheet-history').hidden = true; openSheet('sheet-about'); });

// MARK: - Scan

let stream = null;
let cameraWanted = true;
const video = $('camera');
const finder = $('viewfinder');

async function startCamera() {
  if (stream || !cameraWanted || busy) return;
  if (!navigator.mediaDevices?.getUserMedia) return setCameraOn(false);
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false,
    });
    if (stack.at(-1) !== 'view-scan' || busy) return stopCamera();
    video.srcObject = stream;
    await video.play().catch(() => {});
    setCameraOn(true);
  } catch {
    cameraWanted = false; // denied or no camera: don't ask again this session
    setCameraOn(false);
  }
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  setCameraOn(false);
}

function setCameraOn(on) {
  finder.classList.toggle('camera-on', on);
  $('btn-shutter').disabled = !on;
}

let busy = false;
let scanTimer;
let scanStarted = 0;

function setProcessing(on) {
  busy = on;
  finder.classList.toggle('processing', on);
  finder.setAttribute('aria-busy', String(on));
  $('scan-hint').textContent = on ? 'Preparing scanner…' : 'Fit the whole board inside the frame';
  $('scan-detail').hidden = !on;
  $('btn-shutter').disabled = on || !stream;
  $('file-input').disabled = on;
  $('btn-manual').disabled = on;
  $('btn-history').disabled = on;
  document.querySelector('[data-testid="scan-gallery"]').setAttribute('aria-disabled', String(on));
  clearInterval(scanTimer);
  if (on) {
    scanStarted = performance.now();
    const update = () => {
      const seconds = Math.floor((performance.now() - scanStarted) / 1000);
      $('scan-detail').textContent = `${seconds ? `${seconds}s · ` : ''}${usesServer ? 'Photo processed securely · not stored' : 'Your photo stays on this device'}`;
    };
    update();
    scanTimer = setInterval(update, 1000);
  } else {
    finder.classList.remove('has-photo');
    $('scan-photo').removeAttribute('src');
  }
}

// Let the captured-photo overlay paint before preparing pixels or loading the model.
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

async function scan(prepare) {
  if (busy) return;
  setProcessing(true);
  stopCamera();
  let source, photoURL;
  let succeeded = false;
  try {
    await nextPaint();
    ({ source, photoURL } = await prepare());
    $('scan-photo').src = photoURL;
    finder.classList.add('has-photo');
    await loadRecognizer((p) => {
      $('scan-hint').textContent = p < 1
        ? `Downloading scanner · ${Math.round(p * 100)}%`
        : 'Preparing scanner…';
    });
    $('scan-hint').textContent = 'Reading the pieces…';
    await nextPaint();
    const result = await recognize(source);
    const fen = typeof result === 'string' ? result : result.fen;
    $('scan-hint').textContent = 'Board ready';
    // A brief settling state makes the transition into the editor easy to follow.
    await new Promise((r) => setTimeout(r, 250));
    vibrate(12);
    openEditor(fen, photoURL, true, typeof result === 'object' ? result.review_squares : []);
    succeeded = true;
  } catch (e) {
    console.error(e);
    toast(e.message || 'Board recognition failed');
  } finally {
    source?.close?.();
    if (!succeeded && photoURL) URL.revokeObjectURL(photoURL);
    setProcessing(false);
    if (stack.at(-1) === 'view-scan') { cameraWanted = true; startCamera(); }
  }
}

$('btn-shutter').addEventListener('click', () => {
  if (!stream || busy) return;
  vibrate(10);
  // Copy the visible camera frame before stopping the stream.
  const w = video.videoWidth, h = video.videoHeight, side = Math.min(w, h);
  if (!side) return;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  canvas.getContext('2d').drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, side, side);
  scan(async () => {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error("Couldn't capture that photo. Please try again.");
    return { source: canvas, photoURL: URL.createObjectURL(blob) };
  });
});

$('file-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || busy) return;
  scan(async () => {
    let bitmap;
    try { bitmap = await createImageBitmap(file); } // applies EXIF orientation
    catch { throw new Error("Couldn't open that image"); }
    return { source: bitmap, photoURL: URL.createObjectURL(file) };
  });
});

$('btn-manual').addEventListener('click', () => openEditor(START_FEN, null, false));

// MARK: - Editor

const editor = {
  board: {},
  side: 'w',
  undo: [],
  brush: null,
  flipped: false,
  photo: null,
  scanned: false,
  view: null,
};

editor.view = new Board($('editor-board'), {
  onDrop(from, to) {
    editEditor(() => {
      const piece = editor.board[from];
      delete editor.board[from];
      if (to) editor.board[to] = piece; // dragged off the board: removed
    });
    return true;
  },
  onTap(square) {
    if (!editor.brush) return;
    editEditor(() => {
      if (editor.board[square] === editor.brush) delete editor.board[square];
      else editor.board[square] = editor.brush;
    });
  },
});

function openEditor(fen, photoURL, scanned, reviewSquares = []) {
  const [placement, side] = fen.split(' ');
  editor.board = parsePlacement(placement);
  editor.side = side === 'b' ? 'b' : 'w';
  editor.undo = [];
  editor.brush = null;
  editor.photo = photoURL;
  editor.scanned = scanned;
  const review = Array.isArray(reviewSquares) ? reviewSquares.filter(s => /^[a-h][1-8]$/.test(s)) : [];
  $('scan-review').hidden = !scanned;
  $('scan-review').textContent = 'Check the pieces and orientation before analyzing.' + (review.length ? ` Take a closer look at ${review.join(', ')}.` : '');
  $('btn-photo').hidden = !photoURL;
  if (photoURL) $('editor-thumb').src = photoURL;
  editor.view.setPosition(editor.board, { animate: false });
  renderEditor();
  push('view-editor');
}

function editEditor(change) {
  editor.undo.push(placementOf(editor.board));
  if (editor.undo.length > 100) editor.undo.shift();
  change();
  vibrate(6);
  editor.view.setPosition(editor.board);
  renderEditor();
}

function renderEditor() {
  const issues = validationIssues(editor.board, editor.side);
  const btn = $('btn-analyze');
  btn.disabled = issues.length > 0;
  btn.textContent = issues[0] || 'Analyze';
  editor.view.setMarks({ marked: illegalSquares(editor.board) });
  $('btn-undo').disabled = editor.undo.length === 0;
  document.querySelectorAll('#side-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.side === editor.side));
  document.querySelectorAll('.tray-piece').forEach((t) => t.classList.toggle('on', t.dataset.piece === editor.brush));
}

$('btn-undo').addEventListener('click', () => {
  const last = editor.undo.pop();
  if (last == null) return;
  editor.board = parsePlacement(last);
  editor.view.setPosition(editor.board);
  renderEditor();
});

$('side-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  editor.side = b.dataset.side;
  renderEditor();
});

$('btn-editor-menu').addEventListener('click', () => showMenu([
  { label: 'Flip board', action: () => { editor.flipped = !editor.flipped; editor.view.setFlipped(editor.flipped); } },
  { label: 'Starting position', action: () => { editEditor(() => { editor.board = parsePlacement(START_FEN.split(' ')[0]); }); editor.side = 'w'; renderEditor(); } },
  { label: 'Clear board', danger: true, action: () => editEditor(() => { editor.board = {}; }) },
]));

$('btn-photo').addEventListener('click', () => {
  $('photo-full-img').src = editor.photo;
  $('photo-full').hidden = false;
});

$('btn-analyze').addEventListener('click', () => {
  if (validationIssues(editor.board, editor.side).length) return;
  const fen = buildFEN(editor.board, editor.side);
  history.add(fen, editor.scanned);
  vibrate(15);
  openAnalysis(fen);
});

// Tray: drag a piece onto the board, or tap it to place it by tapping squares.
const tray = $('tray');
for (const p of 'KQRBNPkqrbnp') {
  const cell = document.createElement('button');
  cell.className = 'tray-piece';
  cell.dataset.piece = p;
  cell.dataset.testid = `tray-${isWhite(p) ? 'w' : 'b'}${p.toUpperCase()}`;
  cell.setAttribute('aria-label', `${colorName(isWhite(p))} ${{ k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }[p.toLowerCase()]}`);
  cell.innerHTML = `<img src="${pieceURL(p)}" alt="">`;
  cell.addEventListener('pointerdown', (e) => trayPointerDown(e, cell, p));
  tray.append(cell);
}

function trayPointerDown(e, cell, piece) {
  e.preventDefault();
  const start = { x: e.clientX, y: e.clientY };
  let ghost = null;
  const move = (ev) => {
    if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
    if (!ghost) {
      ghost = document.createElement('img');
      ghost.src = pieceURL(piece);
      ghost.className = 'ghost';
      const size = Math.max(44, $('editor-board').getBoundingClientRect().width / 8) * 1.2;
      ghost.style.width = ghost.style.height = `${size}px`;
      document.body.append(ghost);
      cell.classList.add('lifted');
      vibrate(5);
    }
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (ghost) {
      ghost.remove();
      cell.classList.remove('lifted');
      const sq = ev.type === 'pointerup' && editor.view.squareAtPoint(ev.clientX, ev.clientY);
      if (sq) editEditor(() => { editor.board[sq] = piece; });
    } else {
      editor.brush = editor.brush === piece ? null : piece;
      vibrate(5);
      renderEditor();
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

// MARK: - Analysis

let engine = null;
let analysis = null;

class Analysis {
  constructor() {
    this.view = new Board($('analysis-board'), {
      canDrag: (sq) => {
        const p = this.chess.get(sq);
        return p && p.color === this.chess.turn();
      },
      onDrop: (from, to) => (to ? this.tryMove(from, to) : false),
      onTap: (sq) => this.tap(sq),
    });
    this.flipped = false;
    this.engineOn = true;
    this.lines = [];
    this.depth = 0;
    this.analyzing = false;
  }

  load(fen) {
    this.startFEN = fen;
    this.moves = []; // { san, fen, from, to }
    this.index = -1;
    this.selected = null;
    this.goTo(-1, false);
  }

  get fen() { return this.index < 0 ? this.startFEN : this.moves[this.index].fen; }

  goTo(index, animate = true) {
    this.index = index;
    this.chess = new Chess(this.fen);
    this.selected = null;
    this.view.setPosition(boardOf(this.chess), { animate });
    this.render();
    this.refreshEngine();
  }

  refreshEngine() {
    if (!engine) engine = new Engine((u) => this.onEngine(u));
    if (this.engineOn && stack.at(-1) === 'view-analysis') engine.analyze(this.fen);
    else engine.stop();
  }

  onEngine({ lines, depth, analyzing, error }) {
    this.lines = lines;
    this.depth = depth;
    this.analyzing = analyzing;
    this.error = error;
    this.renderEngine();
  }

  tap(sq) {
    const piece = this.chess.get(sq);
    if (this.selected && this.selected !== sq && this.tryMove(this.selected, sq)) return;
    if (piece && piece.color === this.chess.turn() && this.selected !== sq) {
      this.selected = sq;
    } else {
      this.selected = null;
    }
    this.renderMarks();
  }

  tryMove(from, to) {
    const legal = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!legal.length) return false;
    if (legal.some((m) => m.promotion)) {
      this.askPromotion(from, to);
      return true;
    }
    this.play(from, to);
    return true;
  }

  askPromotion(from, to) {
    const white = this.chess.turn() === 'w';
    const panel = $('promotion-panel');
    panel.innerHTML = '';
    for (const p of 'qrbn') {
      const b = document.createElement('button');
      b.dataset.testid = `promote-${p}`;
      b.innerHTML = `<img src="${pieceURL(white ? p.toUpperCase() : p)}" alt="">`;
      b.addEventListener('click', () => { $('promotion').hidden = true; this.play(from, to, p); });
      panel.append(b);
    }
    $('promotion').hidden = false;
    $('promotion').onclick = (e) => {
      if (e.target.id === 'promotion') { $('promotion').hidden = true; this.goTo(this.index, true); }
    };
  }

  play(from, to, promotion) {
    const move = this.chess.move({ from, to, promotion });
    vibrate(move.captured ? 14 : 8);
    this.moves = this.moves.slice(0, this.index + 1);
    this.moves.push({ san: move.san, fen: this.chess.fen(), from, to });
    this.goTo(this.index + 1);
  }

  render() {
    this.renderMarks();
    this.renderPlayers();
    this.renderMoves();
    this.renderEngine();
    $('btn-back').disabled = $('btn-first').disabled = this.index < 0;
    $('btn-forward').disabled = $('btn-last').disabled = this.index >= this.moves.length - 1;
    const fen = this.fen;
    $('open-lichess').href = `https://lichess.org/analysis/${fen.replace(/ /g, '_')}${this.flipped ? '?color=black' : ''}`;
    $('open-chesscom').href = `https://www.chess.com/analysis?fen=${encodeURIComponent(fen)}${this.flipped ? '&flip=true' : ''}`;
  }

  renderMarks() {
    const last = this.moves[this.index];
    const check = this.chess.inCheck() ? findKing(this.chess, this.chess.turn()) : null;
    const hints = this.selected ? this.chess.moves({ square: this.selected, verbose: true }).map((m) => m.to) : [];
    this.view.setMarks({ lastMove: last ? [last.from, last.to] : [], selected: this.selected, hints, check });
  }

  renderPlayers() {
    const diff = materialDiff(this.chess);
    const status = this.chess.isCheckmate()
      ? `Checkmate · ${colorName(this.chess.turn() === 'b')} wins`
      : this.chess.isStalemate() ? 'Stalemate' : this.chess.isDraw() ? 'Draw' : '';
    const label = (white) => {
      const toMove = (this.chess.turn() === 'w') === white;
      const adv = white ? diff : -diff;
      return `<i class="dot ${white ? 'white' : 'black'}"></i><strong>${colorName(white)}</strong>`
        + (toMove && !status ? ' to move' : '')
        + (adv > 0 ? ` <span class="material">+${adv}</span>` : '');
    };
    $('player-top').innerHTML = label(this.flipped);
    $('player-bottom').innerHTML = label(!this.flipped) + (status ? ` <span class="status">${status}</span>` : '');
  }

  renderMoves() {
    const el = $('moves');
    el.innerHTML = '';
    const startWhite = this.startFEN.split(' ')[1] === 'w';
    let number = Number(this.startFEN.split(' ')[5]) || 1;
    this.moves.forEach((m, i) => {
      const whiteMove = startWhite ? i % 2 === 0 : i % 2 === 1;
      if (whiteMove || i === 0) {
        const n = document.createElement('span');
        n.className = 'num';
        n.textContent = whiteMove ? `${number}.` : `${number}…`;
        el.append(n);
      }
      const b = document.createElement('button');
      b.textContent = m.san;
      b.dataset.testid = `move-${i + 1}`;
      b.classList.toggle('on', i === this.index);
      b.addEventListener('click', () => this.goTo(i));
      el.append(b);
      if (!whiteMove) number++;
    });
    el.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  renderEngine() {
    const legal = this.chess.moves().length;
    const rows = Math.max(1, Math.min(3, legal));
    const box = $('engine-lines');
    const depthEl = $('engine-depth');
    depthEl.dataset.depth = this.engineOn ? this.depth : 0;
    depthEl.textContent = this.engineOn && this.depth ? `depth ${this.depth}` : '';
    const bar = $('eval-bar');
    bar.classList.toggle('off', !this.engineOn);
    bar.classList.toggle('flipped', this.flipped);

    if (!this.engineOn) {
      box.innerHTML = '<div class="engine-note">Engine is off</div>';
      this.setEval(null);
      this.view.setArrows([]);
      return;
    }
    if (this.error) {
      box.innerHTML = `<div class="engine-note">${this.error}</div>`;
      return;
    }
    if (legal === 0) {
      box.innerHTML = '<div class="engine-note">No legal moves</div>';
      // Checkmate fills the bar for the winner; stalemate is level.
      this.setEval(this.chess.isCheckmate() ? { mate: this.chess.turn() === 'w' ? -1 : 1 } : { cp: 0 });
      this.view.setArrows([]);
      return;
    }
    box.innerHTML = '';
    for (let i = 0; i < rows; i++) {
      const line = this.lines[i];
      const row = document.createElement('button');
      row.className = 'engine-line' + (line ? '' : ' placeholder');
      row.dataset.testid = 'engine-line';
      if (line) {
        const white = line.mate != null ? line.mate > 0 : line.cp >= 0;
        row.innerHTML = `<span class="score ${white ? 'white' : ''}">${scoreText(line)}</span><span class="pv">${numbered(line.san, this.chess)}</span>`;
        row.addEventListener('click', () => {
          const uci = line.pv[0];
          this.tryMove(uci.slice(0, 2), uci.slice(2, 4));
        });
      } else {
        row.innerHTML = '<span class="score">&nbsp;</span><span class="pv"></span>';
      }
      box.append(row);
    }
    this.setEval(this.lines[0]);
    // Wait for a settled search so the arrow doesn't jump between early guesses.
    const best = this.depth >= 10 ? this.lines[0]?.pv[0] : null;
    this.view.setArrows(best ? [{ from: best.slice(0, 2), to: best.slice(2, 4) }] : []);
  }

  setEval(line) {
    const w = line ? winChance(line) : 0;
    $('eval-fill').style.height = `${((w + 1) / 2) * 100}%`;
    const text = $('eval-text');
    const whiteAhead = w >= 0;
    text.textContent = line && line.pv ? scoreText(line).replace(/^[+-]/, '') : '';
    // White's advantage is shown at White's end of the bar.
    const atBottom = whiteAhead !== this.flipped;
    text.className = atBottom ? 'bottom' : 'top';
    $('eval-bar').dataset.value = line && line.pv ? scoreText(line) : 'pending';
  }
}

function boardOf(chess) {
  const board = {};
  for (const row of chess.board()) for (const sq of row) {
    if (sq) board[sq.square] = sq.color === 'w' ? sq.type.toUpperCase() : sq.type;
  }
  return board;
}

function findKing(chess, color) {
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type === 'k' && sq.color === color) return sq.square;
  return null;
}

function materialDiff(chess) {
  const value = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let diff = 0;
  for (const row of chess.board()) for (const sq of row) if (sq) diff += (sq.color === 'w' ? 1 : -1) * value[sq.type];
  return diff;
}

function numbered(sans, chess) {
  const parts = [];
  let number = chess.moveNumber();
  let white = chess.turn() === 'w';
  sans.forEach((san, i) => {
    if (white) parts.push(`${number}.`);
    else if (i === 0) parts.push(`${number}…`);
    parts.push(san);
    if (!white) number++;
    white = !white;
  });
  return parts.join(' ');
}

function openAnalysis(fen) {
  analysis ??= new Analysis();
  // Load first: showing the view starts the engine on the current position.
  analysis.load(fen);
  if (stack.at(-1) === 'view-editor') push('view-analysis');
  else resetTo('view-analysis');
}

$('engine-toggle').addEventListener('change', (e) => {
  analysis.engineOn = e.target.checked;
  analysis.refreshEngine();
  analysis.renderEngine();
});
$('btn-flip').addEventListener('click', () => {
  analysis.flipped = !analysis.flipped;
  analysis.view.setFlipped(analysis.flipped);
  analysis.render();
});
$('btn-back').addEventListener('click', () => analysis.index >= 0 && analysis.goTo(analysis.index - 1));
$('btn-forward').addEventListener('click', () => analysis.index < analysis.moves.length - 1 && analysis.goTo(analysis.index + 1));
$('btn-first').addEventListener('click', () => analysis.goTo(-1));
$('btn-last').addEventListener('click', () => analysis.goTo(analysis.moves.length - 1));
$('btn-analysis-menu').addEventListener('click', () => showMenu([
  { label: 'Copy FEN', action: () => navigator.clipboard?.writeText(analysis.fen).then(() => toast('FEN copied'), () => toast(analysis.fen)) },
  { label: 'Edit position', action: () => { pop(); openEditorFrom(analysis.fen); } },
]));
function openEditorFrom(fen) {
  if (stack.at(-1) === 'view-editor') {
    const [placement, side] = fen.split(' ');
    editor.board = parsePlacement(placement);
    editor.side = side;
    editor.undo = [];
    editor.view.setPosition(editor.board);
    renderEditor();
  } else {
    openEditor(fen, null, false);
  }
}

document.addEventListener('keydown', (e) => {
  if (stack.at(-1) !== 'view-analysis') return;
  if (e.key === 'ArrowLeft') $('btn-back').click();
  if (e.key === 'ArrowRight') $('btn-forward').click();
});

// MARK: - Start

// `?fen=` opens a position directly (shareable, and used by QA).
const params = new URLSearchParams(location.search);
const startFEN = params.get('fen');
if (startFEN) {
  try {
    new Chess(startFEN, { skipValidation: true });
    openEditor(startFEN, null, false);
  } catch { /* ignore a bad link */ }
} else {
  startCamera();
}
// Fetch the scanner in the background so the first scan is quick, unless the
// browser asks to save data.
if (!navigator.connection?.saveData) setTimeout(() => loadRecognizer().catch(() => {}), 1500);
