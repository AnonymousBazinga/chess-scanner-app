// Board-position helpers shared by the editor and analysis views.
import { Chess } from '../vendor/chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const FILES = 'abcdefgh';

/** Squares from a8 to h1 (FEN order). */
export const SQUARES = [];
for (let rank = 8; rank >= 1; rank--) for (const f of FILES) SQUARES.push(f + rank);

/** Piece placement (first FEN field) to { square: 'P' | 'k' | ... }. */
export function parsePlacement(placement) {
  const board = {};
  const ranks = placement.split('/');
  ranks.forEach((row, r) => {
    let file = 0;
    for (const c of row) {
      if (/\d/.test(c)) file += Number(c);
      else { board[FILES[file] + (8 - r)] = c; file++; }
    }
  });
  return board;
}

export function placementOf(board) {
  const ranks = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '', empty = 0;
    for (const f of FILES) {
      const p = board[f + rank];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p;
    }
    if (empty) row += empty;
    ranks.push(row);
  }
  return ranks.join('/');
}

export const isWhite = (piece) => piece === piece.toUpperCase();
export const colorName = (white) => (white ? 'White' : 'Black');

/** Castling is allowed whenever king and rook are on their home squares. */
export function possibleCastling(board) {
  let rights = '';
  if (board.e1 === 'K') {
    if (board.h1 === 'R') rights += 'K';
    if (board.a1 === 'R') rights += 'Q';
  }
  if (board.e8 === 'k') {
    if (board.h8 === 'r') rights += 'k';
    if (board.a8 === 'r') rights += 'q';
  }
  return rights || '-';
}

export function buildFEN(board, sideToMove) {
  return `${placementOf(board)} ${sideToMove} ${possibleCastling(board)} - 0 1`;
}

/** Why the position can't be analyzed, most important first (short, button-sized). */
export function validationIssues(board, sideToMove) {
  const issues = [];
  const pieces = Object.values(board);
  for (const white of [true, false]) {
    const name = colorName(white).toLowerCase();
    const own = pieces.filter((p) => isWhite(p) === white);
    const kings = own.filter((p) => p.toLowerCase() === 'k').length;
    if (kings === 0) issues.push(`Add a ${name} king`);
    if (kings > 1) issues.push(`Too many ${name} kings`);
    if (own.filter((p) => p.toLowerCase() === 'p').length > 8) issues.push(`Too many ${name} pawns`);
    if (own.length > 16) issues.push(`Too many ${name} pieces`);
  }
  if (Object.entries(board).some(([sq, p]) => p.toLowerCase() === 'p' && (sq[1] === '1' || sq[1] === '8'))) {
    issues.push("Pawns can't be on the back rank");
    return issues;
  }
  if (issues.length === 0) {
    const waiting = sideToMove === 'w' ? 'b' : 'w';
    const chess = new Chess(buildFEN(board, sideToMove), { skipValidation: true });
    const king = Object.keys(board).find((sq) => board[sq] === (waiting === 'w' ? 'K' : 'k'));
    if (king && chess.isAttacked(king, sideToMove)) {
      const name = colorName(waiting === 'w');
      issues.push(`${name} is in check · set ${name} to move`);
    }
  }
  return issues;
}

/** Squares that make the position illegal: pawns on back ranks and extra kings. */
export function illegalSquares(board) {
  const marked = [];
  const seenKing = {};
  for (const sq of SQUARES) {
    const p = board[sq];
    if (!p) continue;
    if (p.toLowerCase() === 'p' && (sq[1] === '1' || sq[1] === '8')) marked.push(sq);
    if (p.toLowerCase() === 'k') {
      if (seenKing[p]) marked.push(sq);
      seenKing[p] = true;
    }
  }
  return marked;
}

/** UCI moves to SAN from `fen`, stopping at the first illegal move. */
export function uciToSAN(fen, uciMoves) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of uciMoves) {
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

export { Chess };
