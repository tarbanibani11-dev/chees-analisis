/**
 * EvaluationGraph.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders a Recharts area/line chart of the evaluation over the full game.
 *
 * Props:
 *   evalHistory     - array of { moveIdx, cp, label, classification, isWhite }
 *   currentMoveIdx  - currently viewed half-move (0-based, -1 = start)
 *   onMoveClick     - (moveIdx: number) => void
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
  Dot,
} from 'recharts'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_CP   = 1000  // clamp range for display

function clampCp(cp) {
  return Math.max(-MAX_CP, Math.min(MAX_CP, cp ?? 0))
}

function cpToDisplay(cp) {
  const abs = Math.abs(cp)
  if (abs >= 100000) return cp > 0 ? 'M+' : 'M-'
  return (cp / 100).toFixed(1)
}

const CLASSIFICATION_COLORS = {
  brilliant:  '#06b6d4',  // cyan
  great:      '#10b981',  // emerald
  best:       '#22c55e',  // green
  inaccuracy: '#eab308',  // yellow
  mistake:    '#f97316',  // orange
  blunder:    '#ef4444',  // red
  missed_win: '#a855f7',  // purple
  book:       '#94a3b8',  // slate
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null

  const evalStr = cpToDisplay(d.cp)
  const sign    = d.cp >= 0 ? '+' : ''
  const cls     = d.classification
  const clsColor = cls ? CLASSIFICATION_COLORS[cls] : '#94a3b8'

  return (
    <div
      className="glass rounded-lg px-3 py-2 text-xs font-mono pointer-events-none"
      style={{ background: '#1a1a22', border: '1px solid rgba(255,255,255,0.1)' }}
    >
      <div className="text-gray-300 mb-1 font-500">{d.label}</div>
      <div className="flex items-center gap-2">
        <span style={{ color: d.cp >= 0 ? '#e8e8e8' : '#aaa' }}>
          {sign}{evalStr}
        </span>
        {cls && (
          <span style={{ color: clsColor, textTransform: 'capitalize' }}>
            · {cls.replace('_', ' ')}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Custom Active Dot ─────────────────────────────────────────────────────────

function ClassificationDot(props) {
  const { cx, cy, payload, currentMoveIdx } = props
  if (!payload) return null

  const cls = payload.classification
  const isBlunder    = cls === 'blunder'
  const isBrilliant  = cls === 'brilliant'
  const isCurrent    = payload.moveIdx - 1 === currentMoveIdx

  if (!isBlunder && !isBrilliant && !isCurrent) return null

  const color = cls ? CLASSIFICATION_COLORS[cls] : '#38bdf8'
  const r = isCurrent ? 5 : 4

  return (
    <g>
      {(isBlunder || isBrilliant) && (
        <circle cx={cx} cy={cy} r={r + 4} fill={color} opacity={0.2} />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={color}
        stroke={isCurrent ? '#fff' : color}
        strokeWidth={isCurrent ? 2 : 1}
      />
    </g>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function EvaluationGraph({ evalHistory, currentMoveIdx, onMoveClick }) {
  // Transform data for recharts
  const data = useMemo(() => {
    if (!evalHistory?.length) return []
    return evalHistory.map((point) => ({
      ...point,
      cpClamped: clampCp(point.cp),
      // Split into white/black fill areas
      whiteArea: point.cp >= 0 ? clampCp(point.cp) : 0,
      blackArea: point.cp < 0  ? clampCp(point.cp) : 0,
    }))
  }, [evalHistory])

  const handleClick = useCallback((chartData) => {
    if (!chartData?.activePayload?.length) return
    const point = chartData.activePayload[0]?.payload
    if (!point) return
    // moveIdx 0 = start pos, moveIdx N = after move N-1
    onMoveClick?.(point.moveIdx - 1)
  }, [onMoveClick])

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-28 text-gray-700 font-mono text-xs">
        Eval graph will appear after analysis
      </div>
    )
  }

  // Current position marker
  const currentX = currentMoveIdx + 1  // +1 because moveIdx 0 = start

  return (
    <div className="w-full select-none" style={{ height: 120 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onClick={handleClick}
          style={{ cursor: 'pointer' }}
        >
          <defs>
            <linearGradient id="gradWhite" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#e8e8e8" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#e8e8e8" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="gradBlack" x1="0" y1="1" x2="0" y2="0">
              <stop offset="5%"  stopColor="#374151" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#374151" stopOpacity={0.2} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="2 6"
            stroke="rgba(255,255,255,0.04)"
            vertical={false}
          />

          <XAxis
            dataKey="moveIdx"
            tick={{ fill: '#4b5563', fontSize: 9, fontFamily: 'DM Mono' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />

          <YAxis
            domain={[-MAX_CP, MAX_CP]}
            tick={{ fill: '#4b5563', fontSize: 9, fontFamily: 'DM Mono' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v === 0 ? '0' : `${v > 0 ? '+' : ''}${(v/100).toFixed(0)}`}
            width={28}
            ticks={[-1000, -500, 0, 500, 1000]}
          />

          <Tooltip
            content={<CustomTooltip />}
            cursor={{
              stroke: 'rgba(255,255,255,0.15)',
              strokeWidth: 1,
              strokeDasharray: '3 3',
            }}
          />

          {/* Zero line */}
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />

          {/* Current move marker */}
          {currentX >= 0 && (
            <ReferenceLine
              x={currentX}
              stroke="#38bdf8"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          )}

          {/* White advantage area */}
          <Area
            type="monotone"
            dataKey="whiteArea"
            stroke="rgba(232,232,232,0.6)"
            strokeWidth={1.5}
            fill="url(#gradWhite)"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />

          {/* Black advantage area */}
          <Area
            type="monotone"
            dataKey="blackArea"
            stroke="rgba(100,116,139,0.5)"
            strokeWidth={1.5}
            fill="url(#gradBlack)"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />

          {/* Classification dots overlay — use cpClamped for positioning */}
          <Area
            type="monotone"
            dataKey="cpClamped"
            stroke="transparent"
            fill="transparent"
            dot={(dotProps) => (
              <ClassificationDot
                key={dotProps.index}
                {...dotProps}
                currentMoveIdx={currentMoveIdx}
              />
            )}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
