// Stockfish (WASM, lite network) analysis with stable MultiPV updates.
//
// Lines are published only when every MultiPV line has finished the same depth, and
// aspiration-window (bound) scores are skipped, so the ranking doesn't flicker while
// Stockfish is mid-iteration. Results are cached per position.
import { Chess, uciToSAN } from './position.js';

export const MAX_DEPTH = 22;
const MULTI_PV = 3;

export class Engine {
  constructor(onUpdate) {
    this.onUpdate = onUpdate; // ({ lines, depth, analyzing })
    const threaded = self.crossOriginIsolated && (navigator.hardwareConcurrency || 1) > 1;
    this.worker = new Worker(threaded ? 'vendor/stockfish-19-lite.js' : 'vendor/stockfish-19-lite-single.js');
    this.worker.onmessage = (e) => this.handle(String(e.data));
    this.worker.onerror = () => this.onUpdate({ lines: [], depth: 0, analyzing: false, error: "The engine couldn't start" });
    this.send('uci');
    if (threaded) this.send(`setoption name Threads value ${Math.min(4, navigator.hardwareConcurrency - 1)}`);
    this.send(`setoption name MultiPV value ${MULTI_PV}`);
    this.send('setoption name Hash value 64');
    this.send('isready');
    this.searching = false;
    this.pending = null;
    this.current = null;
    this.cache = new Map();
    this.lines = [];
    this.depth = 0;
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  /** Analyzes `fen`; switching positions waits for the previous search to stop. */
  analyze(fen) {
    const legal = new Chess(fen).moves().length;
    const key = cacheKey(fen);
    const cached = this.cache.get(key);
    this.current = { fen, key, expected: Math.max(1, Math.min(MULTI_PV, legal)), pending: {}, lastPublish: 0 };
    this.lines = cached ? cached.lines : [];
    this.depth = cached ? cached.depth : 0;
    const done = legal === 0 || this.depth >= MAX_DEPTH;
    if (legal === 0) this.lines = [];
    this.emit(!done);
    if (done) {
      this.pending = null;
      if (this.searching) this.send('stop');
      return;
    }
    this.pending = fen;
    if (this.searching) this.send('stop');
    else this.startPending();
  }

  stop() {
    this.pending = null;
    this.current = null;
    if (this.searching) this.send('stop');
  }

  startPending() {
    if (!this.pending) return;
    const fen = this.pending;
    this.pending = null;
    this.searching = true;
    this.send(`position fen ${fen}`);
    this.send(`go depth ${MAX_DEPTH}`);
  }

  emit(analyzing) {
    this.onUpdate({ lines: this.lines, depth: this.depth, analyzing });
  }

  handle(line) {
    if (line.startsWith('bestmove')) {
      this.searching = false;
      if (this.pending) {
        this.startPending();
      } else if (this.current) {
        this.publish(true);
        this.emit(false);
      }
      return;
    }
    if (!line.startsWith('info ') || !this.current || this.pending) return;
    const info = parseInfo(line);
    if (!info || info.bound || !info.pv?.length) return;
    const cur = this.current;
    cur.pending[info.multipv] = info;
    if (info.multipv === cur.expected) this.publish(false);
  }

  publish(force) {
    const cur = this.current;
    const snapshot = [];
    for (let i = 1; i <= cur.expected; i++) if (cur.pending[i]) snapshot.push(cur.pending[i]);
    if (snapshot.length !== cur.expected) return;
    const depth = snapshot[0].depth;
    if (!snapshot.every((l) => l.depth === depth)) return;
    if (!force && depth <= this.depth) return;
    const now = performance.now();
    // Early depths arrive within milliseconds; don't redraw for each one.
    if (!force && depth < 12 && now - cur.lastPublish < 250) return;
    cur.lastPublish = now;

    const blackToMove = cur.fen.split(' ')[1] === 'b';
    const sign = blackToMove ? -1 : 1;
    this.lines = snapshot.map((l) => ({
      id: l.multipv,
      cp: l.cp == null ? null : sign * l.cp,
      mate: l.mate == null ? null : sign * l.mate,
      pv: l.pv,
      san: uciToSAN(cur.fen, l.pv.slice(0, 10)),
    }));
    this.depth = Math.max(this.depth, depth);
    this.cache.set(cur.key, { depth: this.depth, lines: this.lines });
    this.emit(true);
  }
}

function parseInfo(line) {
  const t = line.split(' ');
  const out = { multipv: 1 };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': out.depth = Number(t[++i]); break;
      case 'multipv': out.multipv = Number(t[++i]); break;
      case 'cp': out.cp = Number(t[++i]); break;
      case 'mate': out.mate = Number(t[++i]); break;
      case 'lowerbound': case 'upperbound': out.bound = true; break;
      case 'pv': out.pv = t.slice(i + 1); i = t.length; break;
    }
  }
  return out.depth ? out : null;
}

/** Positions repeat via different move orders; ignore the move counters. */
function cacheKey(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

/** White's win chance in [-1, 1] (Lichess curve), for the eval bar. */
export function winChance(line) {
  if (!line) return 0;
  if (line.mate != null) return line.mate > 0 ? 1 : -1;
  const cp = Math.max(-1000, Math.min(1000, line.cp));
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}

export function scoreText(line) {
  if (!line) return '';
  if (line.mate != null) return `${line.mate > 0 ? '' : '-'}M${Math.abs(line.mate)}`;
  const v = line.cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}
