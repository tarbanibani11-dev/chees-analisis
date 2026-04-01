/**
 * useAnalysis.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates full-game analysis:
 *  1. Builds FEN for every position in the game
 *  2. Calls Stockfish on each FEN sequentially (via useStockfish)
 *  3. Classifies each move based on eval drop
 *  4. Computes accuracy scores and move summary statistics
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useRef } from 'react'
import { Chess } from 'chess.js'
import { useStockfish } from './useStockfish'

// ── Classification thresholds (centipawns) ────────────────────────────────────

const THRESHOLDS = {
  BRILLIANT:   -30,   // played move is actually better than SF best
  GREAT:        20,   // within 20cp of best
  BEST:         30,   // essentially optimal
  BOOK:         null, // detected separately (first N moves)
  INACCURACY:  100,   // 100–200cp worse than best
  MISTAKE:     200,   // 200–400cp worse
  BLUNDER:     400,   // 400+ cp worse
  MISSED_WIN:  null,  // detected separately
}

const BOOK_MOVE_THRESHOLD = 10  // first 10 half-moves considered "book"

/**
 * classifyMove
 * @param {number} cpBefore  - eval (white POV, centipawns) BEFORE the move
 * @param {number} cpAfter   - eval (white POV, centipawns) AFTER the move
 * @param {number} cpBest    - eval if best move were played
 * @param {boolean} isWhite  - is it white's move?
 * @param {number} moveIdx   - half-move index (for book detection)
 * @returns {string}         - classification key
 */
export function classifyMove(cpBefore, cpAfter, cpBest, isWhite, moveIdx) {
  // Book moves
  if (moveIdx < BOOK_MOVE_THRESHOLD) return 'book'

  // Convert everything to the moving side's POV
  // Positive = good for the moving side
  const signedBefore = isWhite ?  cpBefore : -cpBefore
  const signedAfter  = isWhite ?  cpAfter  : -cpAfter
  const signedBest   = isWhite ?  cpBest   : -cpBest

  // How much worse than the best move (positive = worse)
  const dropFromBest = signedBest - signedAfter

  // How much the position changed for the moving side (negative = lost advantage)
  const evalDrop = signedBefore - signedAfter

  // Was there a winning advantage that got missed?
  const hadWinningAdvantage = signedBefore > 300
  const lostWinningAdvantage = signedAfter < 100
  if (hadWinningAdvantage && lostWinningAdvantage && dropFromBest > 200) {
    return 'missed_win'
  }

  // Brilliant: the engine didn't find this as best but it's surprisingly good
  if (dropFromBest < THRESHOLDS.BRILLIANT) return 'brilliant'

  // Best / Great
  if (dropFromBest <= THRESHOLDS.BEST)  return 'best'
  if (dropFromBest <= THRESHOLDS.GREAT + 10) return 'great'

  // Blunder / Mistake / Inaccuracy
  if (evalDrop >= THRESHOLDS.BLUNDER)    return 'blunder'
  if (evalDrop >= THRESHOLDS.MISTAKE)    return 'mistake'
  if (evalDrop >= THRESHOLDS.INACCURACY) return 'inaccuracy'

  // Fallback
  return 'best'
}

/**
 * computeAccuracy
 * Approximates Chess.com–style accuracy from centipawn loss.
 * Formula inspired by: accuracy = 103.1668 * exp(-0.04354 * acpl) - 3.1669
 */
export function computeAccuracy(moves, forWhite) {
  const sideMoves = moves.filter((_, i) => forWhite ? i % 2 === 0 : i % 2 === 1)
  if (!sideMoves.length) return 0

  const totalLoss = sideMoves.reduce((sum, m) => sum + (m.cpLoss ?? 0), 0)
  const acpl = totalLoss / sideMoves.length  // average centipawn loss

  const accuracy = 103.1668 * Math.exp(-0.04354 * (acpl / 100)) - 3.1669
  return Math.max(0, Math.min(100, Math.round(accuracy * 10) / 10))
}

/**
 * buildFenList
 * Returns array of FENs: index 0 = starting position, index N = after move N-1
 */
function buildFenList(pgnOrMoves) {
  const chess = new Chess()
  if (typeof pgnOrMoves === 'string') {
    try { chess.loadPgn(pgnOrMoves) } catch { return [] }
    const history = chess.history({ verbose: true })
    chess.reset()
    const fens = [chess.fen()]
    for (const m of history) {
      chess.move(m.san)
      fens.push(chess.fen())
    }
    return fens
  }
  // Array of verbose moves
  const fens = [chess.fen()]
  for (const m of pgnOrMoves) {
    chess.move(m.san)
    fens.push(chess.fen())
  }
  return fens
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAnalysis() {
  const { isReady, isThinking, evaluate, stop } = useStockfish()

  const [isAnalyzing,   setIsAnalyzing]   = useState(false)
  const [progress,      setProgress]      = useState(0)   // 0–100
  const [analysedMoves, setAnalysedMoves] = useState([])  // enriched move objects
  const [evalHistory,   setEvalHistory]   = useState([])  // [{moveIdx, cp, label}]
  const [accuracy,      setAccuracy]      = useState({ white: 0, black: 0 })
  const [summary,       setSummary]       = useState(null)

  const abortRef = useRef(false)

  // ── Main analysis entry-point ────────────────────────────────────────────
  const analyzeGame = useCallback(async (pgn, rawMoves, options = {}) => {
    if (!isReady) {
      console.warn('[Analysis] Engine not ready')
      return
    }

    abortRef.current = false
    setIsAnalyzing(true)
    setProgress(0)
    setAnalysedMoves([])
    setEvalHistory([])

    const depth = options.depth ?? 14
    const fens  = buildFenList(rawMoves)

    if (fens.length < 2) {
      setIsAnalyzing(false)
      return
    }

    // We evaluate N+1 positions (including start) so we can compare before/after
    const cpValues = new Array(fens.length).fill(0)

    // ── Step 1: evaluate every FEN ─────────────────────────────────────
    for (let i = 0; i < fens.length; i++) {
      if (abortRef.current) break

      const { lines } = await evaluate(fens[i], { depth, multiPV: 1 })
      cpValues[i] = lines[0]?.cp ?? 0

      setProgress(Math.round((i / fens.length) * 80))  // first 80% = evaluation
    }

    if (abortRef.current) {
      setIsAnalyzing(false)
      return
    }

    // ── Step 2: evaluate best-move counterfactual ───────────────────────
    // For each position we also need "what would eval be if best move was played"
    // We approximate using the NEXT position's eval IF the move was the engine's best.
    // For simplicity: cpBest[i] = cpValues[i+1] if move[i] was SF's choice,
    // otherwise we run a quick 1-move lookup. We skip this for book moves.
    const cpBest = [...cpValues]  // initialise same as actual

    for (let i = 0; i < rawMoves.length; i++) {
      if (abortRef.current) break
      if (i < BOOK_MOVE_THRESHOLD) continue  // skip book moves

      // Evaluate the position before move i to get the best line
      const { lines } = await evaluate(fens[i], { depth: depth - 2, multiPV: 1 })
      const bestMoveLine = lines[0]

      if (bestMoveLine?.pv?.length) {
        // Play the best move and evaluate result
        const chess = new Chess(fens[i])
        try {
          chess.move({ from: bestMoveLine.pv[0].slice(0,2), to: bestMoveLine.pv[0].slice(2,4), promotion: bestMoveLine.pv[0][4] })
          const { lines: bl } = await evaluate(chess.fen(), { depth: depth - 4, multiPV: 1 })
          cpBest[i] = bl[0]?.cp ?? cpBest[i]
        } catch {
          // Invalid move notation, skip
        }
      }

      setProgress(80 + Math.round((i / rawMoves.length) * 20))
    }

    // ── Step 3: classify each move ──────────────────────────────────────
    const enriched = rawMoves.map((m, i) => {
      const isWhite   = i % 2 === 0
      const cpBefore  = cpValues[i]
      const cpAfter   = cpValues[i + 1] ?? cpValues[i]
      const cpBestVal = cpBest[i]
      const cpLoss    = Math.max(0, isWhite
        ? cpBefore - cpAfter
        : cpAfter  - cpBefore)

      const classification = classifyMove(cpBefore, cpAfter, cpBestVal, isWhite, i)

      return {
        ...m,
        classification,
        cpBefore,
        cpAfter,
        cpBest: cpBestVal,
        cpLoss,
        evalForDisplay: isWhite ? cpAfter : -cpAfter,  // always white POV
      }
    })

    // ── Step 4: build eval history for graph ────────────────────────────
    const history = [
      { moveIdx: 0, cp: cpValues[0], label: 'Start', moveNumber: 0 },
      ...rawMoves.map((m, i) => ({
        moveIdx:    i + 1,
        cp:         cpValues[i + 1] ?? 0,
        label:      `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '...'} ${m.san}`,
        moveNumber: Math.floor(i / 2) + 1,
        classification: enriched[i].classification,
        isWhite:    i % 2 === 0,
      }))
    ]

    // ── Step 5: accuracy & summary ───────────────────────────────────────
    const whiteAccuracy = computeAccuracy(enriched, true)
    const blackAccuracy = computeAccuracy(enriched, false)

    const countClassification = (cls) => enriched.filter(m => m.classification === cls).length

    const gameSummary = {
      white: {
        accuracy:    whiteAccuracy,
        brilliant:   enriched.filter((m, i) => i % 2 === 0 && m.classification === 'brilliant').length,
        great:       enriched.filter((m, i) => i % 2 === 0 && m.classification === 'great').length,
        best:        enriched.filter((m, i) => i % 2 === 0 && m.classification === 'best').length,
        inaccuracies:enriched.filter((m, i) => i % 2 === 0 && m.classification === 'inaccuracy').length,
        mistakes:    enriched.filter((m, i) => i % 2 === 0 && m.classification === 'mistake').length,
        blunders:    enriched.filter((m, i) => i % 2 === 0 && m.classification === 'blunder').length,
      },
      black: {
        accuracy:    blackAccuracy,
        brilliant:   enriched.filter((m, i) => i % 2 === 1 && m.classification === 'brilliant').length,
        great:       enriched.filter((m, i) => i % 2 === 1 && m.classification === 'great').length,
        best:        enriched.filter((m, i) => i % 2 === 1 && m.classification === 'best').length,
        inaccuracies:enriched.filter((m, i) => i % 2 === 1 && m.classification === 'inaccuracy').length,
        mistakes:    enriched.filter((m, i) => i % 2 === 1 && m.classification === 'mistake').length,
        blunders:    enriched.filter((m, i) => i % 2 === 1 && m.classification === 'blunder').length,
      },
      total: {
        moves:       enriched.length,
        brilliant:   countClassification('brilliant'),
        blunders:    countClassification('blunder'),
        mistakes:    countClassification('mistake'),
        inaccuracies:countClassification('inaccuracy'),
      }
    }

    setAnalysedMoves(enriched)
    setEvalHistory(history)
    setAccuracy({ white: whiteAccuracy, black: blackAccuracy })
    setSummary(gameSummary)
    setProgress(100)
    setIsAnalyzing(false)
  }, [isReady, evaluate])

  const abortAnalysis = useCallback(() => {
    abortRef.current = true
    stop()
    setIsAnalyzing(false)
  }, [stop])

  return {
    isEngineReady: isReady,
    isAnalyzing,
    progress,
    analysedMoves,
    evalHistory,
    accuracy,
    summary,
    analyzeGame,
    abortAnalysis,
  }
}
