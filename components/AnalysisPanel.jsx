/**
 * AnalysisPanel.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Shows real-time Stockfish analysis output:
 *   - Best move arrow (passed as customArrows to react-chessboard via parent)
 *   - Multi-PV top 3 candidate lines with eval scores
 *   - Depth indicator and NPS counter
 *   - Engine status (loading / thinking / ready)
 *
 * Also exports: getArrowsFromLines() for use in the Chessboard component.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from 'react'
import { uciToSquares, formatCp, CLASSIFICATION_META } from '../utils/chessUtils'
import { Chess } from 'chess.js'

// ── Arrow Builder ─────────────────────────────────────────────────────────────

/**
 * Convert Stockfish multi-PV lines to react-chessboard arrow format.
 * Returns array of [fromSq, toSq, color] tuples.
 *
 * @param {Array}  lines     - Stockfish multipv lines: [{pv, cp, multipv}]
 * @param {string} fen       - Current position FEN
 * @param {string} bestMove  - UCI best move string (e.g. 'e2e4')
 * @returns {Array}          - [[from, to, color], ...]
 */
export function getArrowsFromLines(lines, fen, bestMove) {
  const arrows = []
  if (!lines?.length && !bestMove) return arrows

  const arrowColors = [
    'rgba(0, 163, 255, 0.85)',   // PV1 — bright blue
    'rgba(0, 163, 255, 0.45)',   // PV2 — medium blue
    'rgba(0, 163, 255, 0.25)',   // PV3 — faint blue
  ]

  // Use lines if available
  if (lines?.length) {
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      const line = lines[i]
      const uci  = line.pv?.[0]
      if (!uci) continue
      const sq = uciToSquares(uci)
      if (sq) arrows.push([sq.from, sq.to, arrowColors[i]])
    }
    return arrows
  }

  // Fallback to bestMove only
  if (bestMove) {
    const sq = uciToSquares(bestMove)
    if (sq) arrows.push([sq.from, sq.to, arrowColors[0]])
  }

  return arrows
}

/**
 * Build the arrow for the last PLAYED move (yellow highlight).
 */
export function getLastMoveArrow(move) {
  if (!move?.from || !move?.to) return []
  return [[move.from, move.to, 'rgba(255, 218, 0, 0.5)']]
}

// ── PV Line Display ───────────────────────────────────────────────────────────

/** Convert a PV array of UCI moves to SAN notation for a given FEN */
function pvToSan(pv, fen, maxMoves = 5) {
  if (!pv?.length) return []
  try {
    const chess = new Chess(fen)
    const sans  = []
    for (let i = 0; i < Math.min(pv.length, maxMoves); i++) {
      const uci = pv[i]
      const move = chess.move({
        from:      uci.slice(0, 2),
        to:        uci.slice(2, 4),
        promotion: uci[4] || undefined,
      })
      if (!move) break
      sans.push(move.san)
    }
    return sans
  } catch { return [] }
}

function PvLine({ line, index, fen, isThinking, onClick }) {
  const sans    = useMemo(() => pvToSan(line.pv, fen, 6), [line.pv, fen])
  const evalStr = formatCp(line.cp)
  const isPositive = (line.cp ?? 0) >= 0

  const colors = [
    { dot: '#38bdf8', text: 'text-sky-300',   eval: 'text-sky-200' },
    { dot: '#94a3b8', text: 'text-gray-400',  eval: 'text-gray-400' },
    { dot: '#64748b', text: 'text-gray-500',  eval: 'text-gray-500' },
  ]
  const c = colors[index] ?? colors[2]

  return (
    <button
      onClick={() => onClick?.(line.pv?.[0])}
      className="w-full text-left flex items-start gap-2 py-1.5 px-2 rounded
                 hover:bg-white/6 transition-all duration-100 group"
    >
      {/* Rank dot */}
      <span
        className="mt-0.5 flex-shrink-0 w-3 h-3 rounded-full border"
        style={{
          borderColor: c.dot,
          background:  index === 0 ? c.dot : 'transparent',
          boxShadow:   index === 0 ? `0 0 6px ${c.dot}` : 'none',
        }}
      />

      {/* Eval */}
      <span className={`font-mono text-xs font-600 flex-shrink-0 w-12 ${c.eval}`}>
        {isPositive ? evalStr : evalStr}
      </span>

      {/* Move sequence */}
      <span className={`font-mono text-xs ${c.text} truncate flex-1`}>
        {sans.join(' ')}
        {isThinking && index === 0 && (
          <span className="engine-thinking ml-1 opacity-50">…</span>
        )}
      </span>
    </button>
  )
}

// ── Engine Status Bar ─────────────────────────────────────────────────────────

function EngineStatus({ isReady, isThinking, depth, isAnalyzing, progress }) {
  if (!isReady) {
    return (
      <div className="flex items-center gap-2">
        <span className="engine-thinking inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
        <span className="text-xs font-mono text-amber-500/70">Loading Stockfish 16…</span>
      </div>
    )
  }

  if (isAnalyzing) {
    return (
      <div className="flex items-center gap-2 flex-1">
        <span className="engine-thinking inline-block w-1.5 h-1.5 rounded-full bg-sky-400" />
        <span className="text-xs font-mono text-sky-400">Analysing full game</span>
        <span className="text-xs font-mono text-gray-600 ml-auto">{progress}%</span>
      </div>
    )
  }

  if (isThinking) {
    return (
      <div className="flex items-center gap-2">
        <span className="engine-thinking inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <span className="text-xs font-mono text-gray-500">
          Stockfish 16 · depth <span className="text-emerald-400 font-600">{depth}</span>
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
      <span className="text-xs font-mono text-gray-600">
        Stockfish 16 · depth {depth}
      </span>
    </div>
  )
}

// ── Classification Banner ─────────────────────────────────────────────────────

function ClassificationBanner({ classification, cpLoss, cpBefore, cpAfter }) {
  if (!classification) return null
  const meta = CLASSIFICATION_META[classification]
  if (!meta) return null

  const showLoss = cpLoss != null && cpLoss > 10 && classification !== 'book' && classification !== 'best'

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg border slide-up"
      style={{
        background:   `${meta.color}18`,
        borderColor:  `${meta.color}40`,
        boxShadow:    ['brilliant','blunder'].includes(classification)
          ? `0 0 12px ${meta.color}25`
          : 'none',
      }}
    >
      <span className="text-lg">{meta.icon}</span>
      <div className="flex flex-col">
        <span className="font-display font-700 text-sm" style={{ color: meta.color }}>
          {meta.label}
        </span>
        {showLoss && (
          <span className="font-mono text-xs text-gray-600">
            {formatCp(cpBefore)} → {formatCp(cpAfter)}
            <span className="ml-1 text-red-400">({formatCp(-cpLoss)})</span>
          </span>
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AnalysisPanel({
  // Engine state
  isEngineReady,
  isThinking,
  isAnalyzing,
  progress,
  depth,
  lines,
  bestMove,
  // Current position context
  fen,
  currentMove,       // verbose move object with .classification, .cpLoss etc.
  // Callbacks
  onBestMoveClick,   // (uciMove: string) => void — highlight best move on board
}) {
  const hasPvLines = lines?.length > 0

  return (
    <div className="flex flex-col gap-2">

      {/* Engine status */}
      <div className="flex items-center justify-between">
        <EngineStatus
          isReady={isEngineReady}
          isThinking={isThinking}
          depth={depth}
          isAnalyzing={isAnalyzing}
          progress={progress}
        />
        {isThinking && (
          <div className="flex gap-0.5">
            {[0, 0.15, 0.3].map((d, i) => (
              <span
                key={i}
                className="engine-thinking inline-block w-1 h-1 rounded-full bg-sky-500"
                style={{ animationDelay: `${d}s` }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Move classification for current move */}
      {currentMove?.classification && (
        <ClassificationBanner
          classification={currentMove.classification}
          cpLoss={currentMove.cpLoss}
          cpBefore={currentMove.cpBefore}
          cpAfter={currentMove.cpAfter}
        />
      )}

      {/* Best move / PV lines */}
      {(hasPvLines || bestMove) && (
        <div className="glass rounded-lg py-1">
          <div className="px-2 pb-1 flex items-center justify-between">
            <span className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">
              Best lines
            </span>
            {lines?.[0]?.depth && (
              <span className="text-[10px] font-mono text-gray-700">
                d{lines[0].depth}
              </span>
            )}
          </div>

          {hasPvLines ? (
            lines.slice(0, 3).map((line, i) => (
              <PvLine
                key={i}
                line={line}
                index={i}
                fen={fen}
                isThinking={isThinking}
                onClick={onBestMoveClick}
              />
            ))
          ) : bestMove ? (
            <PvLine
              line={{ pv: [bestMove], cp: null, multipv: 1 }}
              index={0}
              fen={fen}
              isThinking={isThinking}
              onClick={onBestMoveClick}
            />
          ) : null}
        </div>
      )}

      {/* Empty state */}
      {!hasPvLines && !bestMove && isEngineReady && !isThinking && !isAnalyzing && (
        <div className="text-center py-3">
          <p className="text-xs font-mono text-gray-700">
            Select a move to see analysis
          </p>
        </div>
      )}
    </div>
  )
}
