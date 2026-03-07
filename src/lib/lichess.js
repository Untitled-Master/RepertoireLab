// ─── Lichess API client ─────────────────────────────────────────────────────────
// Fetches games for a given user from the Lichess API.
// Streams NDJSON (newline-delimited JSON) and fires onGame() for each game.

const LICHESS_API = 'https://lichess.org/api'

/**
 * Fetch games for a Lichess user with per-game streaming.
 *
 * @param {string} username  – Lichess username
 * @param {object} [opts]
 * @param {'white'|'black'} [opts.color]  – Filter by color played
 * @param {number|null} [opts.max]        – Maximum number of games (null = no limit)
 * @param {string} [opts.perfType]        – Comma-separated perf types (e.g. 'blitz,rapid')
 * @param {AbortSignal} [opts.signal]     – AbortController signal
 * @param {(game: object) => void} [opts.onGame]
 *   – Called each time a complete game object is parsed from the stream.
 * @returns {Promise<object[]|null>}      – Final array of all game objects, or null if user not found
 */
export async function fetchUserGames(username, { color, max = 50, perfType, signal, onGame } = {}) {
  const params = new URLSearchParams({
    pgnInJson: 'true',
    clocks: 'false',
    evals: 'false',
    opening: 'true',
  })

  if (max != null) params.set('max', String(max))
  if (color) params.set('color', color)
  if (perfType) params.set('perfType', perfType)

  const url = `${LICHESS_API}/games/user/${encodeURIComponent(username)}?${params}`

  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/x-ndjson' },
    mode: 'cors',
    credentials: 'omit',
    signal,
  })

  if (res.status === 404) return null // user not found
  if (!res.ok) throw new Error(`Lichess API error: ${res.status}`)

  // Stream NDJSON line by line via ReadableStream
  if (res.body && onGame) {
    const games = []
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() // keep incomplete trailing line

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const game = JSON.parse(trimmed)
        games.push(game)
        onGame(game)
      }
    }

    // Handle remaining data in buffer
    const remaining = buffer.trim()
    if (remaining) {
      const game = JSON.parse(remaining)
      games.push(game)
      onGame(game)
    }

    return games
  }

  // Fallback when no onGame callback or no streaming support
  const text = await res.text()
  const lines = text.trim().split('\n').filter(Boolean)
  return lines.map((line) => JSON.parse(line))
}
