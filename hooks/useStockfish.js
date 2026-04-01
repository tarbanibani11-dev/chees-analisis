/**
 * useStockfish.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages a Stockfish 16 NNUE engine running in a Web Worker.
 *
 * Usage:
 *   const { evaluate, bestMove, evaluation, depth, isReady, isThinking } = useStockfish()
 *   await evaluate(fen, { depth: 18, multiPV: 3 })
 *
 * The hook communicates with Stockfish via UCI protocol over postMessage.
 * We load the engine from a CDN-hosted WASM build (lichess / official SF).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState, useCallback } from 'react'

// ── Stockfish Worker source (inline blob to avoid CORS issues) ────────────────
// We load stockfish.js from a public CDN inside a blob worker so Vite/CORS
// doesn't interfere with SharedArrayBuffer / WASM loading.
const STOCKFISH_CDN = 'https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/stockfish-nnue-16.js'

function createWorkerBlob() {
  const src = `
    // Inline Stockfish worker
    self.importScripts('${STOCKFISH_CDN}');
  `
  return new Blob([src], { type: 'application/javascript' })
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_DEPTH   = 18
const DEFAULT_MULTI_PV = 3

/**
 * Parse a Stockfish "info" line into a structured object.
 * Example input:
 *   info depth 18 seldepth 22 multipv 1 score cp 35 nodes 1234 pv e2e4 e7e5 ...
 */
function parseInfoLine(line) {
  const result = {}

  const depthM    = line.match(/\bdepth (\d+)/)
  const seldepthM = line.match(/\bseldepth (\d+)/)
  const pvM       = line.match(/\bpv (.+)$/)
  const multipvM  = line.match(/\bmultipv (\d+)/)
  const nodesM    = line.match(/\bnodes (\d+)/)
  const npsM      = line.match(/\bnps (\d+)/)
  const scoreM    = line.match(/\bscore (cp|mate) (-?\d+)/)

  if (depthM)    result.depth    = parseInt(depthM[1])
  if (seldepthM) result.seldepth = parseInt(seldepthM[1])
  if (multipvM)  result.multipv  = parseInt(multipvM[1])
  if (nodesM)    result.nodes    = parseInt(nodesM[1])
  if (npsM)      result.nps      = parseInt(npsM[1])
  if (pvM)       result.pv       = pvM[1].split(' ')

  if (scoreM) {
    result.scoreType  = scoreM[1]         // 'cp' or 'mate'
    result.scoreValue = parseInt(scoreM[2])
    // Normalise: centipawns for cp, large value for mate
    result.cp = scoreM[1] === 'cp'
      ? result.scoreValue
      : result.scoreValue > 0
        ? 100000 - result.scoreValue * 100  // white mating
        : -100000 - result.scoreValue * 100 // black mating
  }

  return result
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useStockfish() {
  const workerRef   = useRef(null)
  const resolveRef  = useRef(null)  // resolves current evaluate() Promise
  const linesRef    = useRef({})    // multipv lines accumulator

  const [isReady,    setIsReady]    = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [evaluation, setEvaluation] = useState(null)  // centipawns (white POV)
  const [depth,      setDepth]      = useState(0)
  const [bestMove,   setBestMove]   = useState(null)  // UCI move string e.g. "e2e4"
  const [lines,      setLines]      = useState([])    // array of {cp, pv, depth}

  // ── Initialise worker ────────────────────────────────────────────────────
  useEffect(() => {
    let worker
    try {
      const blob = createWorkerBlob()
      const url  = URL.createObjectURL(blob)
      worker = new Worker(url)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.warn('[Stockfish] Blob worker failed, trying module worker:', e)
      // Fallback – direct script URL (may fail on CORS-restricted envs)
      try {
        worker = new Worker(STOCKFISH_CDN)
      } catch (e2) {
        console.error('[Stockfish] Could not load engine:', e2)
        return
      }
    }

    workerRef.current = worker

    worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : ''
      handleEngineOutput(line)
    }

    worker.onerror = (e) => {
      console.error('[Stockfish] Worker error:', e)
      setIsReady(false)
    }

    // Handshake
    worker.postMessage('uci')

    return () => {
      worker.postMessage('quit')
      worker.terminate()
    }
  }, [])

  // ── Handle engine output ─────────────────────────────────────────────────
  const handleEngineOutput = useCallback((line) => {
    // Engine ready
    if (line === 'uciok') {
      workerRef.current?.postMessage('setoption name MultiPV value 3')
      workerRef.current?.postMessage('setoption name Threads value 2')
      workerRef.current?.postMessage('isready')
      return
    }

    if (line === 'readyok') {
      setIsReady(true)
      return
    }

    // Best move found → analysis complete
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ')
      const bm = parts[1] && parts[1] !== '(none)' ? parts[1] : null
      setBestMove(bm)
      setIsThinking(false)

      const finalLines = Object.values(linesRef.current)
        .sort((a, b) => a.multipv - b.multipv)
      setLines(finalLines)

      if (resolveRef.current) {
        resolveRef.current({ bestMove: bm, lines: finalLines })
        resolveRef.current = null
      }
      return
    }

    // Info lines
    if (line.startsWith('info') && line.includes('score')) {
      const parsed = parseInfoLine(line)
      if (parsed.depth === undefined) return

      setDepth(parsed.depth)

      // Update primary line (multipv 1) for live eval display
      if (parsed.multipv === 1) {
        setEvaluation(parsed.cp ?? null)
      }

      // Accumulate multipv lines
      if (parsed.multipv !== undefined) {
        linesRef.current[parsed.multipv] = parsed
      }
    }
  }, [])

  // ── Public: evaluate a FEN ───────────────────────────────────────────────
  const evaluate = useCallback((fen, options = {}) => {
    const worker = workerRef.current
    if (!worker || !isReady) {
      return Promise.resolve({ bestMove: null, lines: [] })
    }

    const targetDepth  = options.depth   ?? DEFAULT_DEPTH
    const multiPV      = options.multiPV ?? DEFAULT_MULTI_PV

    // Reset accumulator
    linesRef.current = {}
    setIsThinking(true)
    setLines([])

    // Send MultiPV option each time so caller can vary it
    worker.postMessage(`setoption name MultiPV value ${multiPV}`)
    worker.postMessage('ucinewgame')
    worker.postMessage(`position fen ${fen}`)
    worker.postMessage(`go depth ${targetDepth}`)

    return new Promise((resolve) => {
      resolveRef.current = resolve
    })
  }, [isReady])

  // ── Public: stop current search ──────────────────────────────────────────
  const stop = useCallback(() => {
    workerRef.current?.postMessage('stop')
  }, [])

  // ── Public: evaluate a full game (all positions) ─────────────────────────
  /**
   * Evaluates every position in a game sequentially.
   * Returns array of { fen, cp, bestMove, depth } in move order.
   * Calls onProgress(idx, total) after each move.
   */
  const evaluateGame = useCallback(async (fens, options = {}, onProgress) => {
    const results = []
    const depth   = options.depth ?? 14  // lighter depth for full-game scan

    for (let i = 0; i < fens.length; i++) {
      const result = await evaluate(fens[i], { depth, multiPV: 1 })
      results.push({
        fen:      fens[i],
        cp:       result.lines[0]?.cp ?? 0,
        bestMove: result.bestMove,
        depth,
      })
      onProgress?.(i + 1, fens.length)
    }

    return results
  }, [evaluate])

  return {
    isReady,
    isThinking,
    evaluation,   // live centipawn eval (white POV) during analysis
    depth,        // current search depth
    bestMove,     // UCI format best move after search
    lines,        // array of multipv lines
    evaluate,     // (fen, opts) => Promise<{bestMove, lines}>
    evaluateGame, // (fens[], opts, onProgress) => Promise<result[]>
    stop,
  }
}
