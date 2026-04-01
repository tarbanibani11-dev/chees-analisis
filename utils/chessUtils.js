/**
 * chessUtils.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure utility functions for chess logic, board coordinates, and UI helpers.
 * No external deps beyond chess.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Chess } from 'chess.js'

// ── FEN Utilities ─────────────────────────────────────────────────────────────

/** Extract side to move from FEN: 'w' | 'b' */
export function fenSideToMove(fen) {
  return fen?.split(' ')[1] ?? 'w'
}

/** Get full-move number from FEN */
export function fenMoveNumber(fen) {
  return parseInt(fen?.split(' ')[5] ?? '1')
}

/** Is the position a checkmate? */
export function isCheckmate(fen) {
  try {
    const chess = new Chess(fen)
    return chess.isCheckmate()
  } catch { return false }
}

/** Is the position a stalemate? */
export function isStalemate(fen) {
  try {
    const chess = new Chess(fen)
    return chess.isStalemate()
  } catch { return false }
}

/** Get all legal moves from a FEN as an array of { from, to, san, promotion } */
export function getLegalMoves(fen) {
  try {
    const chess = new Chess(fen)
    return chess.moves({ verbose: true })
  } catch { return [] }
}

/** Get legal destinations for a specific square */
export function getLegalDestinations(fen, square) {
  try {
    const chess = new Chess(fen)
    return chess
      .moves({ square, verbose: true })
      .map(m => m.to)
  } catch { return [] }
}

/** Apply a move to a FEN, return new FEN or null on failure */
export function applyMove(fen, move) {
  try {
    const chess = new Chess(fen)
    const result = chess.move(move)
    return result ? chess.fen() : null
  } catch { return null }
}

/** Build array of FENs for every position in a PGN */
export function pgnToFens(pgn) {
  try {
    const chess = new Chess()
    chess.loadPgn(pgn)
    const history = chess.history({ verbose: true })
    chess.reset()
    const fens = [chess.fen()]
    for (const m of history) {
      chess.move(m.san)
      fens.push(chess.fen())
    }
    return fens
  } catch { return [] }
}

// ── Board Coordinate Utilities ────────────────────────────────────────────────

const FILES = ['a','b','c','d','e','f','g','h']
const RANKS = ['1','2','3','4','5','6','7','8']

/** 'e4' → { file: 4, rank: 3 } (0-indexed, from white's perspective) */
export function squareToCoords(square) {
  const file = FILES.indexOf(square[0])
  const rank = RANKS.indexOf(square[1])
  return { file, rank }
}

/** { file, rank } → 'e4' */
export function coordsToSquare(file, rank) {
  return `${FILES[file]}${RANKS[rank]}`
}

/**
 * Convert a UCI move (e.g. "e2e4") to from/to squares.
 * Returns { from: 'e2', to: 'e4', promotion: 'q' | undefined }
 */
export function uciToSquares(uci) {
  if (!uci || uci.length < 4) return null
  return {
    from:      uci.slice(0, 2),
    to:        uci.slice(2, 4),
    promotion: uci[4] || undefined,
  }
}

/**
 * Build react-chessboard arrow format from a UCI string.
 * Returns [fromSquare, toSquare, color] or null.
 */
export function uciToArrow(uci, color = 'rgb(0, 128, 255)') {
  const squares = uciToSquares(uci)
  if (!squares) return null
  return [squares.from, squares.to, color]
}

/**
 * Build custom square styles for highlighted squares (legal move dots).
 * Returns object compatible with react-chessboard customSquareStyles.
 */
export function buildLegalMoveStyles(squares, isDark = true) {
  const styles = {}
  for (const sq of squares) {
    styles[sq] = {
      background: isDark
        ? 'radial-gradient(circle, rgba(255,255,255,0.3) 25%, transparent 25%)'
        : 'radial-gradient(circle, rgba(0,0,0,0.15) 25%, transparent 25%)',
      borderRadius: '50%',
    }
  }
  return styles
}

/** Highlight the from/to squares of the last move */
export function buildLastMoveStyles(from, to) {
  if (!from || !to) return {}
  return {
    [from]: { backgroundColor: 'rgba(255, 218, 0, 0.25)' },
    [to]:   { backgroundColor: 'rgba(255, 218, 0, 0.35)' },
  }
}

/** Highlight squares for check (king square) */
export function buildCheckStyle(square) {
  if (!square) return {}
  return {
    [square]: {
      background: 'radial-gradient(circle, rgba(239,68,68,0.8) 0%, rgba(239,68,68,0.2) 70%, transparent 100%)',
    }
  }
}

/** Find the king square for a given color in a FEN */
export function findKingSquare(fen, color) {
  try {
    const chess = new Chess(fen)
    const board = chess.board()
    for (const row of board) {
      for (const sq of row) {
        if (sq?.type === 'k' && sq.color === color) return sq.square
      }
    }
  } catch {}
  return null
}

// ── Move Classification Colors ─────────────────────────────────────────────

export const CLASSIFICATION_META = {
  brilliant:  { label: 'Brilliant',  icon: '⭐', color: '#06b6d4', arrowColor: 'rgba(6,182,212,0.8)' },
  great:      { label: 'Great',      icon: '✦',  color: '#10b981', arrowColor: 'rgba(16,185,129,0.8)' },
  best:       { label: 'Best',       icon: '✓',  color: '#22c55e', arrowColor: 'rgba(34,197,94,0.7)' },
  book:       { label: 'Book',       icon: '📖', color: '#94a3b8', arrowColor: 'rgba(148,163,184,0.6)' },
  inaccuracy: { label: 'Inaccuracy', icon: '⚠️', color: '#eab308', arrowColor: 'rgba(234,179,8,0.8)' },
  mistake:    { label: 'Mistake',    icon: '✗',  color: '#f97316', arrowColor: 'rgba(249,115,22,0.8)' },
  blunder:    { label: 'Blunder',    icon: '💥', color: '#ef4444', arrowColor: 'rgba(239,68,68,0.9)' },
  missed_win: { label: 'Missed Win', icon: '🔥', color: '#a855f7', arrowColor: 'rgba(168,85,247,0.8)' },
}

// ── Centipawn Display ─────────────────────────────────────────────────────────

/** Format centipawns for display: 150 → '+1.5', -320 → '-3.2', 100000 → 'M10' */
export function formatCp(cp) {
  if (cp == null) return '0.0'
  const abs = Math.abs(cp)
  if (abs >= 90000) {
    const moves = Math.ceil((100000 - abs) / 100)
    return `${cp > 0 ? '' : '-'}M${moves}`
  }
  const val = (cp / 100).toFixed(1)
  return cp >= 0 ? `+${val}` : val
}

/** Convert centipawns to a 0–100 winrate percentage (sigmoid) */
export function cpToWinrate(cp) {
  return Math.round(50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1))
}

// ── Opening Detection ─────────────────────────────────────────────────────────

/** Extract opening name from PGN headers */
export function extractOpening(pgn) {
  if (!pgn) return { name: 'Unknown Opening', eco: '' }
  const ecoUrl = pgn.match(/\[ECOUrl ".*\/([^"]+)"\]/)
  const eco    = pgn.match(/\[ECO "([^"]+)"\]/)
  const open   = pgn.match(/\[Opening "([^"]+)"\]/)
  const var_   = pgn.match(/\[Variation "([^"]+)"\]/)

  let name = 'Unknown Opening'
  if (ecoUrl) name = ecoUrl[1].replace(/-/g, ' ')
  else if (open) name = open[1]

  if (var_?.[1] && !name.includes(var_[1])) name += `: ${var_[1]}`

  return { name, eco: eco?.[1] ?? '' }
}

// ── Time Controls ─────────────────────────────────────────────────────────────

/** Parse Chess.com time_control string: '600' → '10 min', '180+2' → '3 min +2' */
export function formatTimeControl(tc) {
  if (!tc) return '?'
  const [base, inc] = tc.split('+').map(Number)
  const mins = Math.floor(base / 60)
  const secs = base % 60
  const baseStr = secs ? `${mins}:${String(secs).padStart(2,'0')}` : `${mins} min`
  return inc ? `${baseStr} +${inc}` : baseStr
}

// ── Misc ──────────────────────────────────────────────────────────────────────

/** Clamp a number between lo and hi */
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

/** Deep merge two objects */
export function deepMerge(target, source) {
  const out = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] ?? {}, source[key])
    } else {
      out[key] = source[key]
    }
  }
  return out
}

/** Debounce a function */
export function debounce(fn, ms) {
  let timer
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms) }
}
