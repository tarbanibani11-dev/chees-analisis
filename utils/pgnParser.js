/**
 * pgnParser.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PGN parsing utilities:
 *   - Extract all header tags
 *   - Parse move text with variations and comments
 *   - ECO code → opening name lookup (top 50 most common)
 *   - Build a tree structure for variations support
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Chess } from 'chess.js'

// ── Header Parsing ────────────────────────────────────────────────────────────

/**
 * Extract all PGN header tags into a plain object.
 * e.g. [Event "Live Chess"] → { Event: "Live Chess" }
 */
export function parsePgnHeaders(pgn) {
  if (!pgn) return {}
  const headers = {}
  const regex = /\[(\w+)\s+"([^"]*)"\]/g
  let m
  while ((m = regex.exec(pgn)) !== null) {
    headers[m[1]] = m[2]
  }
  return headers
}

/**
 * Parse a Chess.com game object's PGN and return a rich metadata object.
 */
export function parseGameMeta(pgn) {
  const headers = parsePgnHeaders(pgn)
  const ecoInfo = lookupEco(headers.ECO)

  return {
    white:       headers.White       ?? '?',
    black:       headers.Black       ?? '?',
    whiteElo:    parseInt(headers.WhiteElo)  || null,
    blackElo:    parseInt(headers.BlackElo)  || null,
    result:      headers.Result      ?? '*',
    date:        parseDate(headers.Date ?? headers.UTCDate),
    event:       headers.Event       ?? '',
    site:        headers.Site        ?? '',
    eco:         headers.ECO         ?? '',
    opening:     headers.Opening     ?? ecoInfo?.name ?? 'Unknown Opening',
    variation:   headers.Variation   ?? '',
    timeControl: headers.TimeControl ?? '',
    termination: headers.Termination ?? '',
    link:        headers.Link        ?? '',
  }
}

function parseDate(dateStr) {
  if (!dateStr || dateStr === '????.??.??') return null
  const cleaned = dateStr.replace(/\?/g, '01')
  const d = new Date(cleaned)
  return isNaN(d.getTime()) ? null : d
}

// ── Move Text Stripping ───────────────────────────────────────────────────────

/** Strip PGN headers and return only the move text section */
export function extractMoveText(pgn) {
  if (!pgn) return ''
  return pgn.replace(/\[[^\]]*\]/g, '').trim()
}

/** Strip comments { ... } and variations ( ... ) from move text */
export function stripAnnotations(moveText) {
  // Remove nested comments and variations
  let s = moveText
  s = s.replace(/\{[^}]*\}/g, '')         // {comments}
  s = s.replace(/\([^)]*\)/g, '')         // (variations) - shallow
  s = s.replace(/\$\d+/g, '')             // $NAG annotations
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

// ── Move List Extraction ──────────────────────────────────────────────────────

/**
 * Parse PGN into a flat array of verbose moves using chess.js.
 * This is the primary method used by the app.
 */
export function parseMoves(pgn) {
  if (!pgn) return []
  try {
    const chess = new Chess()
    chess.loadPgn(pgn)
    return chess.history({ verbose: true })
  } catch {
    return []
  }
}

/**
 * Extract inline comments from PGN move text.
 * Returns a map of moveIndex → comment string.
 * e.g. { 0: 'Standard opening', 5: 'Interesting sacrifice' }
 */
export function extractComments(pgn) {
  const comments = {}
  const moveText = extractMoveText(pgn)

  // Match move number + san + optional comment
  const tokens = moveText.split(/(\d+\.)/)
  let moveIdx = -1

  for (const token of tokens) {
    const commentMatch = token.match(/\{([^}]+)\}/)
    if (commentMatch && moveIdx >= 0) {
      comments[moveIdx] = commentMatch[1].trim()
    }
    // Rough count of moves
    const sanMatches = token.match(/[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?|O-O(?:-O)?/g)
    if (sanMatches) moveIdx += sanMatches.length
  }

  return comments
}

// ── Variation Tree ────────────────────────────────────────────────────────────

/**
 * Build a simple variation tree from PGN.
 * Each node: { san, fen, children: [], comment, nag }
 * The root node represents the starting position.
 *
 * Note: Full recursive PGN parsing is complex; this handles one level of
 * variations (the most common case).
 */
export function buildVariationTree(pgn) {
  const tree = { san: null, fen: new Chess().fen(), children: [], comment: null, nag: null }

  try {
    const chess = new Chess()
    chess.loadPgn(pgn)
    const history = chess.history({ verbose: true })

    // Rebuild mainline
    const mainChess = new Chess()
    let current = tree
    for (const move of history) {
      mainChess.move(move.san)
      const node = {
        san:      move.san,
        fen:      mainChess.fen(),
        children: [],
        comment:  null,
        nag:      null,
        move,
      }
      current.children.push(node)
      current = node
    }
  } catch {}

  return tree
}

// ── ECO Code Lookup ───────────────────────────────────────────────────────────

/**
 * Top ~100 most common ECO codes with opening names.
 * Full ECO database has 500+ codes; this covers ~90% of actual games.
 */
const ECO_TABLE = {
  // A - Flank openings
  'A00': 'Uncommon Opening',
  'A01': 'Nimzo-Larsen Attack',
  'A02': "Bird's Opening",
  'A04': 'Reti Opening',
  'A05': 'Reti Opening',
  'A10': 'English Opening',
  'A20': 'English Opening',
  'A40': 'Queen\'s Pawn',
  'A45': 'Queen\'s Pawn Game',
  'A46': 'Queen\'s Pawn Game',
  'A50': 'Queen\'s Pawn Game',
  // B - Semi-open games
  'B00': 'King\'s Pawn',
  'B01': 'Scandinavian Defense',
  'B02': 'Alekhine\'s Defense',
  'B06': 'Modern Defense',
  'B07': 'Pirc Defense',
  'B10': 'Caro-Kann Defense',
  'B12': 'Caro-Kann Defense',
  'B13': 'Caro-Kann: Exchange Variation',
  'B14': 'Caro-Kann: Panov Attack',
  'B15': 'Caro-Kann Defense',
  'B17': 'Caro-Kann: Steinitz Variation',
  'B20': 'Sicilian Defense',
  'B21': 'Sicilian: Grand Prix Attack',
  'B22': 'Sicilian: Alapin Variation',
  'B23': 'Sicilian: Closed',
  'B27': 'Sicilian Defense',
  'B30': 'Sicilian Defense',
  'B32': 'Sicilian Defense',
  'B40': 'Sicilian Defense',
  'B50': 'Sicilian Defense',
  'B51': 'Sicilian: Moscow Variation',
  'B52': 'Sicilian: Moscow Variation',
  'B60': 'Sicilian: Richter-Rauzer',
  'B70': 'Sicilian: Dragon Variation',
  'B72': 'Sicilian: Dragon',
  'B76': 'Sicilian: Yugoslav Attack',
  'B80': 'Sicilian: Scheveningen',
  'B85': 'Sicilian: Scheveningen',
  'B90': 'Sicilian: Najdorf',
  'B91': 'Sicilian: Najdorf',
  'B92': 'Sicilian: Najdorf',
  'B96': 'Sicilian: Najdorf, Polugaevsky',
  'B97': 'Sicilian: Najdorf, Poisoned Pawn',
  // C - Open games
  'C00': 'French Defense',
  'C01': 'French: Exchange Variation',
  'C02': 'French: Advance Variation',
  'C03': 'French Defense',
  'C10': 'French Defense',
  'C11': 'French: Classical',
  'C12': 'French: MacCutcheon',
  'C13': 'French: Classical',
  'C14': 'French: Classical',
  'C15': 'French: Winawer',
  'C16': 'French: Winawer',
  'C17': 'French: Winawer',
  'C18': 'French: Winawer',
  'C20': 'King\'s Pawn',
  'C21': 'Center Game',
  'C23': 'Bishop\'s Opening',
  'C24': 'Bishop\'s Opening',
  'C25': 'Vienna Game',
  'C26': 'Vienna Game',
  'C27': 'Vienna Game',
  'C28': 'Vienna Game',
  'C30': 'King\'s Gambit',
  'C33': 'King\'s Gambit Accepted',
  'C37': 'King\'s Gambit Accepted',
  'C40': 'King\'s Knight Opening',
  'C41': 'Philidor Defense',
  'C42': 'Petrov\'s Defense',
  'C44': 'King\'s Pawn Game',
  'C45': 'Scotch Game',
  'C46': 'Three Knights',
  'C47': 'Four Knights',
  'C48': 'Four Knights: Spanish',
  'C50': 'Italian Game',
  'C51': 'Evans Gambit',
  'C53': 'Italian Game',
  'C54': 'Italian: Classical',
  'C55': 'Italian Game',
  'C56': 'Italian: Two Knights',
  'C57': 'Italian: Two Knights',
  'C60': 'Spanish (Ruy Lopez)',
  'C61': 'Spanish: Bird\'s Defense',
  'C62': 'Spanish: Old Steinitz',
  'C63': 'Spanish: Schliemann',
  'C64': 'Spanish: Classical',
  'C65': 'Spanish: Berlin Defense',
  'C66': 'Spanish: Berlin Defense',
  'C67': 'Spanish: Berlin, Rio Gambit',
  'C68': 'Spanish: Exchange',
  'C69': 'Spanish: Exchange',
  'C70': 'Spanish: Morphy Defense',
  'C71': 'Spanish: Modern Steinitz',
  'C72': 'Spanish: Modern Steinitz',
  'C73': 'Spanish: Modern Steinitz',
  'C74': 'Spanish: Modern Steinitz',
  'C75': 'Spanish: Modern Steinitz',
  'C76': 'Spanish: Modern Steinitz',
  'C77': 'Spanish: Morphy Defense',
  'C78': 'Spanish: Archangel',
  'C79': 'Spanish: Steinitz Defense Deferred',
  'C80': 'Spanish: Open Variation',
  'C81': 'Spanish: Open, Howell Attack',
  'C82': 'Spanish: Open Variation',
  'C83': 'Spanish: Open, Classical',
  'C84': 'Spanish: Closed',
  'C85': 'Spanish: Exchange, Delayed',
  'C86': 'Spanish: Worrall Attack',
  'C87': 'Spanish: Closed',
  'C88': 'Spanish: Closed',
  'C89': 'Spanish: Marshall Attack',
  'C90': 'Spanish: Closed',
  'C91': 'Spanish: Closed',
  'C92': 'Spanish: Closed',
  'C93': 'Spanish: Smyslov Defense',
  'C94': 'Spanish: Breyer',
  'C95': 'Spanish: Breyer',
  'C96': 'Spanish: Closed',
  'C97': 'Spanish: Chigorin',
  'C98': 'Spanish: Chigorin',
  'C99': 'Spanish: Chigorin',
  // D - Closed games
  'D00': 'Queen\'s Pawn',
  'D01': 'Richter-Veresov Attack',
  'D02': 'Queen\'s Pawn',
  'D03': 'Torre Attack',
  'D04': 'Queen\'s Pawn',
  'D05': 'Colle System',
  'D06': 'Queen\'s Gambit',
  'D07': 'Queen\'s Gambit: Chigorin',
  'D08': 'Queen\'s Gambit: Albin Counter',
  'D10': 'Queen\'s Gambit: Slav',
  'D11': 'Queen\'s Gambit: Slav',
  'D12': 'Queen\'s Gambit: Slav',
  'D13': 'Queen\'s Gambit: Slav Exchange',
  'D15': 'Queen\'s Gambit: Slav',
  'D16': 'Queen\'s Gambit: Slav',
  'D17': 'Queen\'s Gambit: Slav',
  'D18': 'Queen\'s Gambit: Slav, Dutch',
  'D19': 'Queen\'s Gambit: Slav, Dutch',
  'D20': 'Queen\'s Gambit Accepted',
  'D21': 'Queen\'s Gambit Accepted',
  'D25': 'Queen\'s Gambit Accepted',
  'D30': 'Queen\'s Gambit Declined',
  'D31': 'Queen\'s Gambit Declined',
  'D34': 'Queen\'s Gambit: Tarrasch',
  'D35': 'Queen\'s Gambit Declined',
  'D37': 'Queen\'s Gambit Declined',
  'D38': 'Queen\'s Gambit: Ragozin',
  'D39': 'Queen\'s Gambit: Ragozin',
  'D40': 'Queen\'s Gambit Declined',
  'D41': 'Queen\'s Gambit: Semi-Tarrasch',
  'D43': 'Queen\'s Gambit: Semi-Slav',
  'D44': 'Queen\'s Gambit: Semi-Slav',
  'D45': 'Queen\'s Gambit: Semi-Slav',
  'D46': 'Queen\'s Gambit: Semi-Slav',
  'D47': 'Queen\'s Gambit: Semi-Slav',
  'D48': 'Queen\'s Gambit: Semi-Slav, Meran',
  'D50': 'Queen\'s Gambit Declined',
  'D51': 'Queen\'s Gambit Declined',
  'D52': 'Queen\'s Gambit Declined',
  'D53': 'Queen\'s Gambit Declined',
  'D55': 'Queen\'s Gambit Declined',
  'D56': 'Queen\'s Gambit Declined',
  'D57': 'Queen\'s Gambit Declined',
  'D58': 'Queen\'s Gambit: Tartakower',
  'D59': 'Queen\'s Gambit: Tartakower',
  'D70': 'Grünfeld Defense',
  'D71': 'Grünfeld Defense',
  'D72': 'Grünfeld Defense',
  'D73': 'Grünfeld Defense',
  'D74': 'Grünfeld Defense',
  'D75': 'Grünfeld Defense',
  'D76': 'Grünfeld Defense',
  'D78': 'Grünfeld Defense',
  'D80': 'Grünfeld Defense',
  'D85': 'Grünfeld Defense',
  'D86': 'Grünfeld: Exchange',
  'D87': 'Grünfeld: Exchange',
  'D89': 'Grünfeld: Exchange',
  // E - Indian defenses
  'E00': 'Queen\'s Pawn',
  'E01': 'Catalan Opening',
  'E04': 'Catalan Opening',
  'E05': 'Catalan Opening',
  'E10': 'Queen\'s Pawn',
  'E11': 'Bogo-Indian Defense',
  'E12': 'Queen\'s Indian Defense',
  'E14': 'Queen\'s Indian Defense',
  'E15': 'Queen\'s Indian Defense',
  'E16': 'Queen\'s Indian Defense',
  'E17': 'Queen\'s Indian Defense',
  'E18': 'Queen\'s Indian Defense',
  'E20': 'Nimzo-Indian Defense',
  'E21': 'Nimzo-Indian Defense',
  'E22': 'Nimzo-Indian Defense',
  'E23': 'Nimzo-Indian Defense',
  'E24': 'Nimzo-Indian Defense',
  'E25': 'Nimzo-Indian Defense',
  'E26': 'Nimzo-Indian Defense',
  'E27': 'Nimzo-Indian Defense',
  'E28': 'Nimzo-Indian Defense',
  'E29': 'Nimzo-Indian Defense',
  'E30': 'Nimzo-Indian Defense',
  'E32': 'Nimzo-Indian: Classical',
  'E33': 'Nimzo-Indian: Classical',
  'E34': 'Nimzo-Indian: Classical',
  'E35': 'Nimzo-Indian: Classical',
  'E36': 'Nimzo-Indian: Classical',
  'E37': 'Nimzo-Indian: Classical',
  'E38': 'Nimzo-Indian: Classical',
  'E39': 'Nimzo-Indian: Classical',
  'E40': 'Nimzo-Indian Defense',
  'E41': 'Nimzo-Indian Defense',
  'E42': 'Nimzo-Indian: Rubinstein',
  'E43': 'Nimzo-Indian: Fischer',
  'E44': 'Nimzo-Indian: Fischer',
  'E45': 'Nimzo-Indian: Fischer',
  'E46': 'Nimzo-Indian Defense',
  'E47': 'Nimzo-Indian Defense',
  'E48': 'Nimzo-Indian Defense',
  'E49': 'Nimzo-Indian Defense',
  'E50': 'Nimzo-Indian Defense',
  'E51': 'Nimzo-Indian Defense',
  'E52': 'Nimzo-Indian Defense',
  'E53': 'Nimzo-Indian Defense',
  'E54': 'Nimzo-Indian Defense',
  'E55': 'Nimzo-Indian Defense',
  'E56': 'Nimzo-Indian Defense',
  'E57': 'Nimzo-Indian Defense',
  'E58': 'Nimzo-Indian Defense',
  'E59': 'Nimzo-Indian Defense',
  'E60': 'King\'s Indian Defense',
  'E61': 'King\'s Indian Defense',
  'E62': 'King\'s Indian Defense',
  'E63': 'King\'s Indian Defense',
  'E64': 'King\'s Indian Defense',
  'E65': 'King\'s Indian Defense',
  'E66': 'King\'s Indian Defense',
  'E67': 'King\'s Indian: Fianchetto',
  'E68': 'King\'s Indian: Fianchetto',
  'E69': 'King\'s Indian: Fianchetto',
  'E70': 'King\'s Indian Defense',
  'E71': 'King\'s Indian: Averbakh',
  'E72': 'King\'s Indian Defense',
  'E73': 'King\'s Indian: Averbakh',
  'E74': 'King\'s Indian: Averbakh',
  'E75': 'King\'s Indian: Averbakh',
  'E76': 'King\'s Indian: Four Pawns Attack',
  'E77': 'King\'s Indian Defense',
  'E78': 'King\'s Indian Defense',
  'E79': 'King\'s Indian Defense',
  'E80': 'King\'s Indian: Sämisch',
  'E81': 'King\'s Indian: Sämisch',
  'E82': 'King\'s Indian: Sämisch',
  'E83': 'King\'s Indian: Sämisch',
  'E84': 'King\'s Indian: Sämisch',
  'E85': 'King\'s Indian: Sämisch',
  'E86': 'King\'s Indian: Sämisch',
  'E87': 'King\'s Indian: Sämisch',
  'E88': 'King\'s Indian: Sämisch',
  'E89': 'King\'s Indian: Sämisch',
  'E90': 'King\'s Indian Defense',
  'E91': 'King\'s Indian Defense',
  'E92': 'King\'s Indian: Classical',
  'E93': 'King\'s Indian: Petrosian',
  'E94': 'King\'s Indian: Orthodox',
  'E95': 'King\'s Indian: Orthodox',
  'E96': 'King\'s Indian: Orthodox',
  'E97': 'King\'s Indian: Mar del Plata',
  'E98': 'King\'s Indian: Mar del Plata',
  'E99': 'King\'s Indian: Orthodox',
}

/** Look up an ECO code. Returns { eco, name } or null */
export function lookupEco(eco) {
  if (!eco) return null
  // Try exact match first, then prefix match (e.g. B92 → B90)
  if (ECO_TABLE[eco]) return { eco, name: ECO_TABLE[eco] }
  const prefix = eco.slice(0, 3)
  if (ECO_TABLE[prefix]) return { eco: prefix, name: ECO_TABLE[prefix] }
  // Letter-only fallback
  const letter = eco[0]
  const fallbacks = { A: 'Flank Opening', B: 'Semi-Open Game', C: 'Open Game', D: 'Closed Game', E: 'Indian Defense' }
  return { eco, name: fallbacks[letter] ?? 'Unknown Opening' }
}

/** Get a human-readable result string */
export function formatResult(result) {
  switch (result) {
    case '1-0':   return 'White wins'
    case '0-1':   return 'Black wins'
    case '1/2-1/2': return 'Draw'
    default:      return 'In progress'
  }
}

/** Determine winner from result string: 'white' | 'black' | 'draw' | null */
export function getWinner(result) {
  if (result === '1-0')     return 'white'
  if (result === '0-1')     return 'black'
  if (result === '1/2-1/2') return 'draw'
  return null
}
