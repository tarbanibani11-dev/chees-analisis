/**
 * useChesscomAPI.js
 * ─────────────────────────────────────────────────────────────────────────────
 * React hook for the Chess.com public API.
 *
 * Features:
 *  - Fetch recent games for a username (last N months)
 *  - localStorage caching (TTL: 5 minutes per archive)
 *  - Rate-limit-aware: 1 request / 200ms minimum gap
 *  - Fetch player profile and stats
 *  - Abort on unmount / new fetch
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { parsePgnHeaders, lookupEco } from '../utils/pgnParser'
import { formatTimeControl } from '../utils/chessUtils'

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE          = 'https://api.chess.com/pub'
const HEADERS       = { 'User-Agent': 'ChessLens/1.0 (game-analysis-app)' }
const CACHE_TTL_MS  = 5 * 60 * 1000      // 5 minutes
const REQUEST_GAP   = 200                 // ms between requests
const MAX_GAMES     = 50

// ── LocalStorage Cache ────────────────────────────────────────────────────────

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(`chesslens:${key}`)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL_MS) { localStorage.removeItem(`chesslens:${key}`); return null }
    return data
  } catch { return null }
}

function cacheSet(key, data) {
  try { localStorage.setItem(`chesslens:${key}`, JSON.stringify({ data, ts: Date.now() })) } catch {}
}

// ── Rate-limited fetch ────────────────────────────────────────────────────────

let lastRequestTime = 0

async function rateLimitedFetch(url, signal) {
  const now = Date.now()
  const wait = REQUEST_GAP - (now - lastRequestTime)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastRequestTime = Date.now()

  const res = await fetch(url, { headers: HEADERS, signal })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${res.statusText}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// ── Game Enrichment ───────────────────────────────────────────────────────────

/** Add derived fields to a raw Chess.com game object */
function enrichGame(game, username) {
  const lc       = username.toLowerCase()
  const isWhite  = game.white?.username?.toLowerCase() === lc
  const me       = isWhite ? game.white : game.black
  const opponent = isWhite ? game.black : game.white

  let result = 'draw'
  if (me?.result === 'win')                                           result = 'win'
  else if (['checkmated','resigned','timeout','abandoned','lose'].includes(me?.result)) result = 'loss'

  const headers  = parsePgnHeaders(game.pgn)
  const ecoInfo  = lookupEco(headers.ECO)

  return {
    ...game,
    // Derived
    _id:          game.url ?? `${game.end_time}`,
    _result:      result,                               // 'win' | 'loss' | 'draw'
    _isWhite:     isWhite,
    _myColor:     isWhite ? 'white' : 'black',
    _myRating:    me?.rating ?? null,
    _oppRating:   opponent?.rating ?? null,
    _opponent:    opponent?.username ?? '?',
    _opening:     ecoInfo?.name ?? headers.Opening ?? 'Unknown Opening',
    _eco:         headers.ECO ?? '',
    _timeControl: formatTimeControl(game.time_control),
    _endTime:     game.end_time ? new Date(game.end_time * 1000) : null,
  }
}

// ── API Functions ─────────────────────────────────────────────────────────────

async function fetchArchiveUrls(username, signal) {
  const cacheKey = `archives:${username.toLowerCase()}`
  const cached   = cacheGet(cacheKey)
  if (cached) return cached

  const data = await rateLimitedFetch(`${BASE}/player/${username}/games/archives`, signal)
  cacheSet(cacheKey, data.archives ?? [])
  return data.archives ?? []
}

async function fetchMonthGames(archiveUrl, signal) {
  const cacheKey = `month:${archiveUrl}`
  const cached   = cacheGet(cacheKey)
  if (cached) return cached

  const data = await rateLimitedFetch(archiveUrl, signal)
  const games = data.games ?? []
  cacheSet(cacheKey, games)
  return games
}

async function fetchPlayerProfile(username, signal) {
  const cacheKey = `profile:${username.toLowerCase()}`
  const cached   = cacheGet(cacheKey)
  if (cached) return cached

  const data = await rateLimitedFetch(`${BASE}/player/${username}`, signal)
  cacheSet(cacheKey, data)
  return data
}

async function fetchPlayerStats(username, signal) {
  const cacheKey = `stats:${username.toLowerCase()}`
  const cached   = cacheGet(cacheKey)
  if (cached) return cached

  const data = await rateLimitedFetch(`${BASE}/player/${username}/stats`, signal)
  cacheSet(cacheKey, data)
  return data
}

// ── Main Hook ─────────────────────────────────────────────────────────────────

export function useChesscomAPI() {
  const [games,   setGames]   = useState([])
  const [profile, setProfile] = useState(null)
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [progress, setProgress] = useState(0)  // 0–100 fetch progress

  const abortRef = useRef(null)

  // Cancel any in-flight request on unmount
  useEffect(() => () => abortRef.current?.abort(), [])

  /** Validate that a username exists on Chess.com */
  const validateUser = useCallback(async (username) => {
    try {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      const profile = await fetchPlayerProfile(username.trim(), abortRef.current.signal)
      return !!profile?.username
    } catch {
      return false
    }
  }, [])

  /** Fetch recent games for a username */
  const fetchGames = useCallback(async (username, options = {}) => {
    if (!username?.trim()) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal

    setLoading(true)
    setError(null)
    setGames([])
    setProgress(0)

    try {
      // 1. Fetch profile in parallel
      const profilePromise = fetchPlayerProfile(username.trim(), signal)
        .then(p => setProfile(p))
        .catch(() => {})

      // 2. Fetch archive URLs
      setProgress(5)
      const archives = await fetchArchiveUrls(username.trim(), signal)
      if (!archives.length) throw new Error(`No games found for "${username}"`)

      // How many months to fetch (default: 2)
      const monthsBack   = options.monthsBack ?? 2
      const targetMonths = archives.slice(-monthsBack).reverse()
      const allGames     = []

      // 3. Fetch each month
      for (let i = 0; i < targetMonths.length; i++) {
        if (signal.aborted) break
        const monthGames = await fetchMonthGames(targetMonths[i], signal)
        allGames.push(...monthGames)
        setProgress(5 + Math.round(((i + 1) / targetMonths.length) * 85))
        if (allGames.length >= MAX_GAMES * 2) break
      }

      await profilePromise

      // 4. Enrich and sort
      const enriched = allGames
        .map(g => enrichGame(g, username.trim()))
        .filter(g => g.pgn)  // only games with PGN
        .reverse()            // newest first
        .slice(0, MAX_GAMES)

      setGames(enriched)
      setProgress(100)

      // 5. Fetch stats separately (non-blocking)
      fetchPlayerStats(username.trim(), signal)
        .then(s => setStats(s))
        .catch(() => {})

    } catch (e) {
      if (e.name === 'AbortError') return
      const msg = e.status === 404
        ? `Player "${username}" not found on Chess.com`
        : e.status === 429
          ? 'Rate limited by Chess.com. Please wait a moment.'
          : e.message || 'Failed to fetch games'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  /** Clear all cached data */
  const clearCache = useCallback(() => {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('chesslens:'))
        .forEach(k => localStorage.removeItem(k))
    } catch {}
  }, [])

  /** Cancel current fetch */
  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
  }, [])

  return {
    games,    // enriched game objects
    profile,  // Chess.com player profile
    stats,    // Chess.com player stats (ratings by time control)
    loading,
    error,
    progress,
    fetchGames,
    validateUser,
    clearCache,
    cancel,
  }
}

// ── Stat Helpers (usable standalone) ─────────────────────────────────────────

/** Get rating for a time control from Chess.com stats */
export function getRating(stats, timeControl) {
  const map = {
    bullet:  stats?.chess_bullet?.last?.rating,
    blitz:   stats?.chess_blitz?.last?.rating,
    rapid:   stats?.chess_rapid?.last?.rating,
    daily:   stats?.chess_daily?.last?.rating,
  }
  return map[timeControl] ?? null
}

/** Get win/loss/draw counts from Chess.com stats for a time control */
export function getRecord(stats, timeControl) {
  const tc = stats?.[`chess_${timeControl}`]?.record
  if (!tc) return null
  return { wins: tc.win ?? 0, losses: tc.loss ?? 0, draws: tc.draw ?? 0 }
}
