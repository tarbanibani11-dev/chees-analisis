import { useState, useCallback, useEffect, useRef } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { useAnalysis } from './hooks/useAnalysis'
import EvaluationGraph from './components/EvaluationGraph'

// ─── Constants ──────────────────────────────────────────────────────────────

const MOVE_CLASSIFICATIONS = {
  brilliant:  { label: 'Brilliant',  icon: '⭐', badge: 'badge-brilliant' },
  great:      { label: 'Great',      icon: '✦',  badge: 'badge-great' },
  best:       { label: 'Best',       icon: '✓',  badge: 'badge-best' },
  book:       { label: 'Book',       icon: '📖', badge: 'badge-book' },
  inaccuracy: { label: 'Inaccuracy', icon: '⚠️', badge: 'badge-inaccuracy' },
  mistake:    { label: 'Mistake',    icon: '✗',  badge: 'badge-mistake' },
  blunder:    { label: 'Blunder',    icon: '💥', badge: 'badge-blunder' },
  missed_win: { label: 'Missed Win', icon: '🔥', badge: 'badge-missed-win' },
}

// ─── Chess.com API ───────────────────────────────────────────────────────────

async function fetchArchives(username) {
  const res = await fetch(
    `https://api.chess.com/pub/player/${username}/games/archives`,
    { headers: { 'User-Agent': 'ChessAnalyzer/1.0' } }
  )
  if (!res.ok) throw new Error(`Player "${username}" not found`)
  const data = await res.json()
  return data.archives
}

async function fetchMonthGames(archiveUrl) {
  const res = await fetch(archiveUrl, { headers: { 'User-Agent': 'ChessAnalyzer/1.0' } })
  if (!res.ok) throw new Error('Failed to fetch games')
  const data = await res.json()
  return data.games || []
}

function formatResult(game, username) {
  const lc = username.toLowerCase()
  const isWhite = game.white?.username?.toLowerCase() === lc
  const me = isWhite ? game.white : game.black
  if (!me) return '?'
  if (me.result === 'win') return 'W'
  if (['checkmated','resigned','timeout','abandoned'].includes(me.result)) return 'L'
  return 'D'
}

function getOpponent(game, username) {
  const lc = username.toLowerCase()
  return game.white?.username?.toLowerCase() === lc
    ? game.black?.username
    : game.white?.username
}

function parseOpening(pgn) {
  if (!pgn) return 'Unknown Opening'
  const m = pgn.match(/\[ECOUrl ".*\/([^"]+)"\]/)
  if (m) return m[1].replace(/-/g, ' ')
  const eco = pgn.match(/\[ECO "([^"]+)"\]/)
  if (eco) return eco[1]
  return 'Unknown Opening'
}

// ─── EvalBar ────────────────────────────────────────────────────────────────

function EvalBar({ evaluation, isWhitePerspective = true }) {
  const MAX_CP = 1000
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const cp = typeof evaluation === 'number' ? clamp(evaluation, -MAX_CP, MAX_CP) : 0
  const whiteShare = (cp + MAX_CP) / (MAX_CP * 2)
  const blackFill = isWhitePerspective ? 1 - whiteShare : whiteShare
  const blackPct = Math.round(blackFill * 100)

  const displayVal = evaluation == null
    ? '0.0'
    : Math.abs(evaluation) >= 100000
      ? `M${Math.ceil(Math.abs(evaluation) / 100)}`
      : (evaluation / 100).toFixed(1)

  return (
    <div
      className="relative flex flex-col items-center justify-center rounded-lg overflow-hidden"
      style={{ width: 24, height: '100%', minHeight: 200, background: '#e8e8e8' }}
      title={`Eval: ${evaluation >= 0 ? '+' : ''}${displayVal}`}
    >
      <div
        className="eval-bar-fill absolute top-0 left-0 w-full"
        style={{ height: `${blackPct}%`, background: 'linear-gradient(180deg,#1a1a1f,#2d2d35)' }}
      />
      <span
        className="relative z-10 font-mono font-500 select-none"
        style={{
          color: cp > 0 ? '#1a1a1f' : '#e8e8e8',
          fontSize: 9,
          letterSpacing: '-0.03em',
          transform: 'rotate(-90deg)',
          whiteSpace: 'nowrap',
        }}
      >
        {cp >= 0 ? `+${displayVal}` : displayVal}
      </span>
    </div>
  )
}

// ─── AnalysisProgress ────────────────────────────────────────────────────────

function AnalysisProgress({ isAnalyzing, progress, isEngineReady, onAnalyze, isDisabled }) {
  if (!isEngineReady) {
    return (
      <div className="flex items-center gap-2 text-xs font-mono text-gray-600">
        <span className="engine-thinking inline-block w-1.5 h-1.5 bg-gray-600 rounded-full" />
        Loading engine…
      </div>
    )
  }
  if (isAnalyzing) {
    return (
      <div className="flex items-center gap-2 flex-1">
        <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #38bdf8, #818cf8)',
            }}
          />
        </div>
        <span className="text-xs font-mono text-gray-500 flex-shrink-0">{progress}%</span>
      </div>
    )
  }
  return (
    <button
      onClick={onAnalyze}
      disabled={isDisabled}
      className="btn-primary px-3 py-1.5 rounded-lg text-xs text-white
                 disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none"
    >
      ⚡ Analyse
    </button>
  )
}

// ─── AccuracyBadge ───────────────────────────────────────────────────────────

function AccuracyBadge({ accuracy, side }) {
  const color = accuracy >= 90 ? '#10b981'
    : accuracy >= 75 ? '#22c55e'
    : accuracy >= 60 ? '#eab308'
    : '#ef4444'
  return (
    <div className="flex flex-col items-center">
      <span className="text-gray-600 font-mono text-[10px] uppercase">{side}</span>
      <span className="font-display font-700 text-lg" style={{ color }}>{accuracy}%</span>
    </div>
  )
}

// ─── SummaryPanel ─────────────────────────────────────────────────────────────

function SummaryPanel({ summary, accuracy }) {
  if (!summary) return null
  const items = [
    { key: 'brilliant',   icon: '⭐', label: 'Brilliant', color: '#06b6d4' },
    { key: 'great',       icon: '✦',  label: 'Great',     color: '#10b981' },
    { key: 'inaccuracies',icon: '⚠️', label: 'Inaccuracy',color: '#eab308' },
    { key: 'mistakes',    icon: '✗',  label: 'Mistake',   color: '#f97316' },
    { key: 'blunders',    icon: '💥', label: 'Blunder',   color: '#ef4444' },
  ]
  return (
    <div className="glass rounded-lg px-3 py-2.5 flex items-center gap-3 flex-wrap">
      <AccuracyBadge accuracy={accuracy.white} side="White" />
      <div className="w-px h-8 bg-white/10" />
      <AccuracyBadge accuracy={accuracy.black} side="Black" />
      <div className="w-px h-8 bg-white/10" />
      <div className="flex gap-3 flex-wrap">
        {items.map(({ key, icon, label, color }) => (
          <div key={key} className="flex flex-col items-center">
            <span className="text-[10px] font-mono text-gray-600">{label}</span>
            <div className="flex items-center gap-1">
              <span className="text-sm">{icon}</span>
              <span className="font-mono font-600 text-sm" style={{ color }}>
                {summary.total[key] ?? 0}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── GameSelector ─────────────────────────────────────────────────────────────

function GameSelector({ onGameLoad }) {
  const [username, setUsername] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [games, setGames]       = useState([])
  const [fetched, setFetched]   = useState(false)

  const handleFetch = async () => {
    if (!username.trim()) return
    setLoading(true); setError(null); setGames([]); setFetched(false)
    try {
      const archives = await fetchArchives(username.trim())
      if (!archives.length) throw new Error('No games found')
      const recentArchives = archives.slice(-2).reverse()
      const allGames = []
      for (const url of recentArchives) {
        const mg = await fetchMonthGames(url)
        allGames.push(...mg)
        if (allGames.length >= 50) break
      }
      setGames(allGames.slice(-50).reverse())
      setFetched(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const resultColor = (r) => ({ W: 'text-emerald-400', L: 'text-red-400', D: 'text-amber-400' }[r] || 'text-gray-400')

  return (
    <div className="flex flex-col gap-4 h-full">
      <div>
        <h1 className="font-display text-2xl font-800 tracking-tight text-white">
          Chess<span className="text-sky-400">Lens</span>
        </h1>
        <p className="text-xs text-gray-500 mt-0.5 font-mono">Game Analysis Engine</p>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5
                     text-sm font-mono text-white placeholder-gray-600
                     focus:outline-none focus:border-sky-500/60 transition-all duration-200"
          placeholder="Chess.com username…"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
        />
        <button
          onClick={handleFetch}
          disabled={loading || !username.trim()}
          className="btn-primary px-4 py-2.5 rounded-lg text-sm text-white
                     disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
        >
          {loading
            ? <span className="flex items-center gap-1">
                {[0,0.2,0.4].map((d,i) => (
                  <span key={i} className="engine-thinking inline-block w-1.5 h-1.5 bg-white rounded-full"
                        style={{animationDelay:`${d}s`}} />
                ))}
              </span>
            : 'Fetch'
          }
        </button>
      </div>

      {error && (
        <div className="text-red-400 text-xs font-mono bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 slide-up">
          ✗ {error}
        </div>
      )}

      {fetched && games.length > 0 && (
        <div className="flex flex-col gap-1 overflow-y-auto flex-1 stagger">
          <p className="text-xs text-gray-500 font-mono mb-1">{games.length} recent games</p>
          {games.map((game, i) => {
            const result   = formatResult(game, username)
            const opponent = getOpponent(game, username)
            const opening  = parseOpening(game.pgn)
            const date     = game.end_time
              ? new Date(game.end_time * 1000).toLocaleDateString('en-GB', { day:'2-digit', month:'short' })
              : '—'
            return (
              <button
                key={game.url || i}
                onClick={() => onGameLoad(game, username.trim())}
                className="glass rounded-lg px-3 py-2.5 text-left hover:bg-white/8 transition-all duration-150 slide-up"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-mono font-500 text-sm ${resultColor(result)}`}>
                    {result === 'W' ? 'WIN' : result === 'L' ? 'LOSS' : 'DRAW'}
                  </span>
                  <span className="text-gray-500 font-mono text-xs">{date}</span>
                </div>
                <div className="text-white/80 text-xs font-mono mt-0.5 truncate">
                  vs <span className="text-white font-500">{opponent}</span>
                </div>
                <div className="text-gray-600 text-xs truncate mt-0.5">
                  {opening} · <span className="text-gray-500 capitalize">{game.time_class}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-auto">
        <PgnUpload onGameLoad={onGameLoad} />
      </div>
    </div>
  )
}

// ─── PgnUpload ────────────────────────────────────────────────────────────────

function PgnUpload({ onGameLoad }) {
  const [pgn, setPgn]           = useState('')
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border-t border-white/5 pt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-gray-500 hover:text-gray-300 font-mono flex items-center gap-1.5 transition-colors"
      >
        <span style={{ transform: expanded ? 'rotate(90deg)' : 'none', display:'inline-block', transition:'transform 0.2s' }}>▶</span>
        Paste PGN instead
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-2 slide-up">
          <textarea
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5
                       text-xs font-mono text-gray-300 placeholder-gray-700
                       focus:outline-none focus:border-sky-500/60 resize-none transition-all duration-200"
            rows={5}
            placeholder="Paste PGN here…"
            value={pgn}
            onChange={(e) => setPgn(e.target.value)}
          />
          <button
            onClick={() => { onGameLoad({ pgn: pgn.trim() }, null); setExpanded(false); setPgn('') }}
            disabled={!pgn.trim()}
            className="btn-primary py-2 rounded-lg text-xs text-white font-mono
                       disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
          >
            Load PGN
          </button>
        </div>
      )}
    </div>
  )
}

// ─── MoveList ─────────────────────────────────────────────────────────────────

function MoveList({ moves, currentMoveIdx, onMoveClick }) {
  const currentRef = useRef(null)
  useEffect(() => { currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [currentMoveIdx])

  const pairs = []
  for (let i = 0; i < moves.length; i += 2) pairs.push([moves[i], moves[i + 1]])

  if (!moves.length) return <div className="text-gray-600 text-xs font-mono text-center py-8">No moves yet</div>

  return (
    <div className="overflow-y-auto flex flex-col gap-0.5">
      {pairs.map((pair, pairIdx) => {
        const base = pairIdx * 2
        return (
          <div key={pairIdx} className="flex items-stretch gap-1">
            <span className="text-gray-600 font-mono text-xs w-6 flex-shrink-0 flex items-center">{pairIdx + 1}.</span>
            <MoveToken move={pair[0]} idx={base}     isCurrent={currentMoveIdx === base}     onClick={onMoveClick} refProp={currentMoveIdx === base     ? currentRef : null} />
            {pair[1] && <MoveToken move={pair[1]} idx={base+1} isCurrent={currentMoveIdx === base+1} onClick={onMoveClick} refProp={currentMoveIdx === base+1 ? currentRef : null} />}
          </div>
        )
      })}
    </div>
  )
}

function MoveToken({ move, idx, isCurrent, onClick, refProp }) {
  const clsData = move.classification ? MOVE_CLASSIFICATIONS[move.classification] : null
  return (
    <button
      ref={refProp}
      onClick={() => onClick(idx)}
      className={`flex-1 text-left px-1.5 py-0.5 rounded text-xs font-mono
                  transition-all duration-100 flex items-center gap-1 truncate
                  ${isCurrent ? 'bg-sky-500/25 text-sky-200 font-600' : 'hover:bg-white/8 text-gray-300'}`}
    >
      <span className="truncate">{move.san}</span>
      {clsData && <span className="text-[10px] flex-shrink-0">{clsData.icon}</span>}
    </button>
  )
}

// ─── BoardControls ────────────────────────────────────────────────────────────

function BoardControls({ onFirst, onPrev, onNext, onLast, onFlip, isPlaying, onPlayPause }) {
  const btnCls = `w-9 h-9 flex items-center justify-center rounded-lg
                  glass hover:bg-white/12 transition-all duration-150
                  text-gray-300 hover:text-white active:scale-95 text-sm`
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onFlip}      className={btnCls} title="Flip board">⇅</button>
      <div className="w-px h-6 bg-white/10 mx-0.5" />
      <button onClick={onFirst}     className={btnCls} title="First move">⏮</button>
      <button onClick={onPrev}      className={btnCls} title="Previous">◀</button>
      <button onClick={onPlayPause} className={`${btnCls} ${isPlaying ? 'bg-sky-500/20 text-sky-300' : ''}`} title="Play/Pause">
        {isPlaying ? '⏸' : '▶'}
      </button>
      <button onClick={onNext}      className={btnCls} title="Next">▶▶</button>
      <button onClick={onLast}      className={btnCls} title="Last move">⏭</button>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [game, setGame]             = useState(new Chess())
  const [moves, setMoves]           = useState([])
  const [currentMoveIdx, setCurrentMoveIdx] = useState(-1)
  const [boardOrientation, setBoardOrientation] = useState('white')
  const [isPlaying, setIsPlaying]   = useState(false)
  const [evaluation, setEvaluation] = useState(null)
  const [loadedGame, setLoadedGame] = useState(null)
  const [activeUsername, setActiveUsername] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rawMoveCache, setRawMoveCache] = useState([])

  const playIntervalRef = useRef(null)
  const analysisTriggeredRef = useRef(false)

  const {
    isEngineReady,
    isAnalyzing,
    progress,
    analysedMoves,
    evalHistory,
    accuracy,
    summary,
    analyzeGame,
    abortAnalysis,
  } = useAnalysis()

  // Use real analysed moves when available
  const displayMoves = analysedMoves.length ? analysedMoves : moves

  // ── Load game ────────────────────────────────────────────────────────────
  const handleGameLoad = useCallback((gameData, username) => {
    const pgn = gameData.pgn || ''
    const chess = new Chess()
    try { chess.loadPgn(pgn) } catch { alert('Failed to parse PGN'); return }
    const rawMoves = chess.history({ verbose: true })
    setMoves(rawMoves.map(m => ({ ...m, classification: 'book' })))
    setRawMoveCache(rawMoves)
    setCurrentMoveIdx(-1)
    setLoadedGame(gameData)
    setActiveUsername(username)
    setGame(new Chess())
    setEvaluation(0)
    analysisTriggeredRef.current = false
    if (username) {
      const lc = username.toLowerCase()
      setBoardOrientation(gameData.black?.username?.toLowerCase() === lc ? 'black' : 'white')
    }
  }, [])

  // Auto-trigger analysis when engine is ready and game is loaded
  useEffect(() => {
    if (isEngineReady && rawMoveCache.length && loadedGame && !analysisTriggeredRef.current && !isAnalyzing) {
      analysisTriggeredRef.current = true
      analyzeGame(loadedGame.pgn || '', rawMoveCache)
    }
  }, [isEngineReady, rawMoveCache, loadedGame, isAnalyzing, analyzeGame])

  // Sync moves when analysis completes
  useEffect(() => {
    if (analysedMoves.length) setMoves(analysedMoves)
  }, [analysedMoves])

  // ── Navigation ───────────────────────────────────────────────────────────
  const goToMove = useCallback((idx) => {
    const chess = new Chess()
    const src = displayMoves.length ? displayMoves : moves
    for (let i = 0; i <= idx && i < src.length; i++) chess.move(src[i].san)
    setGame(chess)
    setCurrentMoveIdx(idx)
    if (evalHistory.length) {
      setEvaluation(evalHistory[idx + 1]?.cp ?? null)
    }
  }, [moves, displayMoves, evalHistory])

  const goFirst = useCallback(() => { setGame(new Chess()); setCurrentMoveIdx(-1); setEvaluation(evalHistory[0]?.cp ?? 0) }, [evalHistory])
  const goPrev  = useCallback(() => { if (currentMoveIdx > -1) goToMove(currentMoveIdx - 1) }, [currentMoveIdx, goToMove])
  const goNext  = useCallback(() => { if (currentMoveIdx < displayMoves.length - 1) goToMove(currentMoveIdx + 1) }, [currentMoveIdx, displayMoves, goToMove])
  const goLast  = useCallback(() => { if (displayMoves.length) goToMove(displayMoves.length - 1) }, [displayMoves, goToMove])

  // ── Auto-play ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setCurrentMoveIdx(prev => {
          if (prev >= displayMoves.length - 1) { setIsPlaying(false); return prev }
          const next = prev + 1
          goToMove(next)
          return next
        })
      }, 800)
    } else {
      clearInterval(playIntervalRef.current)
    }
    return () => clearInterval(playIntervalRef.current)
  }, [isPlaying, displayMoves, goToMove])

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft')  goPrev()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowUp')    goFirst()
      if (e.key === 'ArrowDown')  goLast()
      if (e.key === ' ')          { e.preventDefault(); setIsPlaying(p => !p) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goPrev, goNext, goFirst, goLast])

  const currentMove = currentMoveIdx >= 0 ? displayMoves[currentMoveIdx] : null
  const clsData = currentMove?.classification ? MOVE_CLASSIFICATIONS[currentMove.classification] : null

  return (
    <div className="min-h-screen bg-[#0d0d0f] text-white overflow-hidden">
      <div className="flex h-screen overflow-hidden">

        {/* ── Sidebar ── */}
        <aside
          className="flex-shrink-0 overflow-y-auto transition-all duration-300 ease-in-out border-r border-white/5"
          style={{ width: sidebarOpen ? 272 : 0, overflow: sidebarOpen ? 'auto' : 'hidden', background: '#111115' }}
        >
          <div className="p-4 h-full" style={{ minWidth: 272 }}>
            <GameSelector onGameLoad={handleGameLoad} />
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Header */}
          <header className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 flex-shrink-0" style={{ background: '#111115' }}>
            <button
              onClick={() => setSidebarOpen(p => !p)}
              className="w-8 h-8 flex items-center justify-center rounded glass hover:bg-white/12 text-gray-400 transition-all flex-shrink-0"
            >
              {sidebarOpen ? '←' : '☰'}
            </button>

            {loadedGame ? (
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="font-mono text-sm text-gray-400 truncate">
                  {loadedGame.white?.username || '?'} <span className="text-gray-600">vs</span> {loadedGame.black?.username || '?'}
                </span>
                {clsData && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-mono border flex-shrink-0 ${clsData.badge} slide-up`}>
                    {clsData.icon} {clsData.label}
                  </span>
                )}
                <div className="flex-1" />
                <AnalysisProgress
                  isEngineReady={isEngineReady}
                  isAnalyzing={isAnalyzing}
                  progress={progress}
                  isDisabled={!loadedGame || !rawMoveCache.length}
                  onAnalyze={() => {
                    analysisTriggeredRef.current = true
                    analyzeGame(loadedGame.pgn || '', rawMoveCache)
                  }}
                />
              </div>
            ) : (
              <span className="font-display text-sm text-gray-600">Select a game to analyze</span>
            )}

            <div className="text-xs font-mono text-gray-700 hidden sm:block flex-shrink-0">← → · Space</div>
          </header>

          {/* Body */}
          <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">

            {/* Board column */}
            <div className="flex flex-col items-center p-3 lg:p-5 gap-3 flex-shrink-0">
              <div className="flex gap-3 items-stretch">
                {/* Eval bar */}
                {loadedGame && (
                  <div className="w-6 self-stretch min-h-0" style={{ minHeight: 200 }}>
                    <EvalBar evaluation={evaluation} isWhitePerspective={boardOrientation === 'white'} />
                  </div>
                )}
                {/* Board */}
                <div
                  className="rounded-xl overflow-hidden shadow-2xl"
                  style={{ width: 'min(calc(100vw - 100px), 520px, calc(100vh - 260px))' }}
                >
                  <Chessboard
                    position={game.fen()}
                    boardOrientation={boardOrientation}
                    arePiecesDraggable={false}
                    customBoardStyle={{ borderRadius: 0 }}
                    customDarkSquareStyle={{ backgroundColor: '#4a7c59' }}
                    customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
                  />
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between w-full" style={{ maxWidth: 540 }}>
                <BoardControls
                  onFirst={goFirst} onPrev={goPrev} onNext={goNext} onLast={goLast}
                  onFlip={() => setBoardOrientation(o => o === 'white' ? 'black' : 'white')}
                  isPlaying={isPlaying} onPlayPause={() => setIsPlaying(p => !p)}
                />
                {currentMoveIdx >= 0 && (
                  <span className="font-mono text-xs text-gray-500">
                    {Math.floor(currentMoveIdx / 2) + 1}{currentMoveIdx % 2 === 0 ? '.' : '...'}{currentMove?.san}
                  </span>
                )}
              </div>

              {/* Eval graph */}
              {evalHistory.length > 0 && (
                <div className="w-full glass rounded-lg p-2" style={{ maxWidth: 540 }}>
                  <EvaluationGraph
                    evalHistory={evalHistory}
                    currentMoveIdx={currentMoveIdx}
                    onMoveClick={goToMove}
                  />
                </div>
              )}

              {/* Summary */}
              {summary && (
                <div style={{ maxWidth: 540, width: '100%' }}>
                  <SummaryPanel summary={summary} accuracy={accuracy} />
                </div>
              )}
            </div>

            {/* Move list */}
            <div className="flex-1 overflow-hidden flex flex-col border-t lg:border-t-0 lg:border-l border-white/5 min-w-0">
              <div className="px-4 py-2.5 border-b border-white/5 flex-shrink-0 flex items-center justify-between">
                <span className="font-mono text-xs text-gray-500 uppercase tracking-wider">
                  Moves {displayMoves.length > 0 && `· ${displayMoves.length}`}
                </span>
                {isAnalyzing && (
                  <span className="text-xs font-mono text-sky-500 engine-thinking">Analysing…</span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {displayMoves.length > 0
                  ? <MoveList moves={displayMoves} currentMoveIdx={currentMoveIdx} onMoveClick={goToMove} />
                  : <EmptyState />
                }
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-16 text-center">
      <div className="text-6xl opacity-20 select-none" style={{ filter: 'grayscale(1)' }}>♟</div>
      <div>
        <p className="font-display text-gray-500 text-sm">No game loaded</p>
        <p className="font-mono text-gray-700 text-xs mt-1">Enter a Chess.com username to get started</p>
      </div>
    </div>
  )
}
