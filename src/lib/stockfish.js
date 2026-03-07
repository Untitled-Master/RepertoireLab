// ─── Lichess Cloud Eval API client ──────────────────────────────────────────
// Fetches cached engine evaluations from Lichess's cloud analysis database.
// ~320 million positions available; openings have the best coverage.
// API docs: https://lichess.org/api#tag/Analysis/operation/apiCloudEval

const CLOUD_EVAL_URL = 'https://lichess.org/api/cloud-eval'

/**
 * Fetch cloud evaluation for a given FEN position.
 *
 * @param {string} fen - FEN string for the position
 * @param {object} [options]
 * @param {number} [options.multiPv=3] - Number of principal variations (1-5)
 * @param {string} [options.variant='standard'] - Chess variant
 * @param {AbortSignal} [options.signal] - AbortController signal for cancellation
 * @returns {Promise<{ fen, knodes, depth, pvs: Array<{ moves, cp?, mate? }> } | null>}
 *   Returns the cloud eval result, or null if position is not in database.
 */
export async function fetchCloudEval(fen, { multiPv = 3, variant = 'standard', signal } = {}) {
  const params = new URLSearchParams({
    fen,
    multiPv: String(multiPv),
    variant,
  })

  const res = await fetch(`${CLOUD_EVAL_URL}?${params}`, { signal })

  if (res.status === 404) {
    // Position not in the cloud database
    return null
  }

  if (!res.ok) {
    throw new Error(`Cloud eval request failed: ${res.status}`)
  }

  return res.json()
}

// ─── Format evaluation score for display ────────────────────────────────────
// Cloud eval scores (cp / mate) are always from WHITE's perspective.
// No turn-based flip is needed.
export function formatScore(score) {
  if (!score) return '—'

  if (score.type === 'mate') {
    const m = score.value
    return m > 0 ? `M${m}` : `M${m}`
  }

  const cp = score.value / 100
  const sign = cp > 0 ? '+' : ''
  return `${sign}${cp.toFixed(1)}`
}

// ─── Convert eval to percentage for the eval bar (0-100, white perspective) ─
// Cloud eval scores are already from white's perspective — no flip needed.
export function evalToWhitePercent(score) {
  if (!score) return 50

  if (score.type === 'mate') {
    return score.value > 0 ? 100 : 0
  }

  const cp = score.value
  // Sigmoid-like mapping: ±500cp maps to roughly ±45% from center
  const percent = 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1)
  return Math.max(1, Math.min(99, percent))
}

// ─── Convert UCI move (e.g., 'e2e4') to { from, to } ───────────────────────
export function uciToSquares(uciMove) {
  if (!uciMove || uciMove.length < 4) return null
  return {
    from: uciMove.slice(0, 2),
    to: uciMove.slice(2, 4),
  }
}

// ─── Parse cloud eval response into normalized eval info ────────────────────
// Transforms the raw API response into a structure the UI can consume.
export function parseCloudEval(data) {
  if (!data || !data.pvs || data.pvs.length === 0) return null

  const primary = data.pvs[0]
  const score = 'mate' in primary
    ? { type: 'mate', value: primary.mate }
    : { type: 'cp', value: primary.cp ?? 0 }

  return {
    depth: data.depth || 0,
    knodes: data.knodes || 0,
    score,
    pvs: data.pvs.map((pv) => ({
      moves: pv.moves ? pv.moves.split(' ') : [],
      score: 'mate' in pv
        ? { type: 'mate', value: pv.mate }
        : { type: 'cp', value: pv.cp ?? 0 },
    })),
  }
}
