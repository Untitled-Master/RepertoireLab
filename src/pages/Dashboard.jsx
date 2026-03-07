import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Chessground } from 'chessground'
import { Chess } from 'chess.js'
import {
  RotateCcw, Undo2, RefreshCw, ExternalLink,
  Swords, Crown, Target, CircleDot,
  ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight,
  Zap, Shield, Sun, Moon, Palette,
  GripVertical, User, Cpu, Loader2,
  Volume2, VolumeX, Trophy, TrendingUp, BarChart3,
  BookOpen, ArrowRight, Settings,
} from 'lucide-react'
import {
  fetchCloudEval, parseCloudEval,
  formatScore, evalToWhitePercent, uciToSquares,
} from '@/lib/stockfish'
import { fetchUserGames } from '@/lib/lichess'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'

// ─── localStorage persistence ───────────────────────────────────────────────────
const PREFS_KEY = 'chess-preferences'
const DEFAULT_PREFS = {
  colorMode: 'dark',
  boardTheme: 'brown',
  pieceTheme: 'cburnett',
  boardSize: 0, // 0 = auto
  soundVolume: 0.7, // 0 = muted, 0..1
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_PREFS, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_PREFS }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch { /* ignore */ }
}

// ─── Board theme definitions ────────────────────────────────────────────────────
const BOARD_THEMES = [
  { id: 'brown', label: 'Brown', light: '#f0d9b5', dark: '#b58863' },
  { id: 'blue', label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'green', label: 'Green', light: '#ffffdd', dark: '#86a666' },
  { id: 'purple', label: 'Purple', light: '#e8e0f0', dark: '#9070b0' },
  { id: 'ic', label: 'Newspaper', light: '#ececec', dark: '#c0c0c0' },
]

// ─── Piece theme definitions ────────────────────────────────────────────────────
const LICHESS_PIECE_CDN = 'https://lichess1.org/assets/piece'

const PIECE_THEMES = [
  { id: 'cburnett', label: 'CBurnett' },
  { id: 'merida', label: 'Merida' },
  { id: 'alpha', label: 'Alpha' },
  { id: 'california', label: 'California' },
  { id: 'cardinal', label: 'Cardinal' },
  { id: 'staunty', label: 'Staunty' },
  { id: 'tatiana', label: 'Tatiana' },
  { id: 'kosal', label: 'Kosal' },
  { id: 'maestro', label: 'Maestro' },
  { id: 'fresca', label: 'Fresca' },
  { id: 'letter', label: 'Letter' },
  { id: 'pixel', label: 'Pixel' },
]

const PIECE_MAP = [
  { role: 'pawn', file: 'P' },
  { role: 'knight', file: 'N' },
  { role: 'bishop', file: 'B' },
  { role: 'rook', file: 'R' },
  { role: 'queen', file: 'Q' },
  { role: 'king', file: 'K' },
]

const PIECE_COLORS = [
  { color: 'white', prefix: 'w' },
  { color: 'black', prefix: 'b' },
]

function generatePieceCSS(theme) {
  return PIECE_MAP.flatMap(({ role, file }) =>
    PIECE_COLORS.map(({ color, prefix }) =>
      `.cg-wrap piece.${role}.${color} { background-image: url('${LICHESS_PIECE_CDN}/${theme}/${prefix}${file}.svg') !important; }`
    )
  ).join('\n')
}

// ─── Dot pattern background (Vercel-style) ─────────────────────────────────────
const DotPattern = () => (
  <div
    className="pointer-events-none absolute inset-0 z-0 opacity-[0.4]"
    style={{
      backgroundImage: `radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground) / 0.15) 1px, transparent 0)`,
      backgroundSize: '24px 24px',
    }}
  />
)

// ─── Lichess sounds ─────────────────────────────────────────────────────────────
const SOUND_BASE = 'https://lichess1.org/assets/sound/standard'
const sounds = {
  move: `${SOUND_BASE}/Move.mp3`,
  capture: `${SOUND_BASE}/Capture.mp3`,
  check: `${SOUND_BASE}/Check.mp3`,
  castle: `${SOUND_BASE}/Move.mp3`,
  promote: `${SOUND_BASE}/Confirmation.mp3`,
  gameEnd: `${SOUND_BASE}/Victory.mp3`,
  gameStart: `${SOUND_BASE}/Confirmation.mp3`,
  illegal: `${SOUND_BASE}/Error.mp3`,
  notify: `${SOUND_BASE}/GenericNotify.mp3`,
}

// Module-level volume, kept in sync with React state via volumeRef
let _soundVolume = loadPrefs().soundVolume

function playSound(name) {
  if (_soundVolume <= 0) return
  try {
    const audio = new Audio(sounds[name] || sounds.move)
    audio.volume = _soundVolume
    audio.play().catch(() => {})
  } catch {
    // sounds are best-effort
  }
}

// Determine and play the correct sound for a chess.js move object
function playSoundForMoveObj(moveObj) {
  if (!moveObj) { playSound('move'); return }
  const chess = new Chess(moveObj.after)
  if (chess.isCheckmate() || chess.isStalemate() || chess.isDraw()) {
    playSound('gameEnd')
  } else if (chess.inCheck()) {
    playSound('check')
  } else if (moveObj.captured) {
    playSound('capture')
  } else if (moveObj.flags.includes('k') || moveObj.flags.includes('q')) {
    playSound('castle')
  } else if (moveObj.flags.includes('p')) {
    playSound('promote')
  } else {
    playSound('move')
  }
}

// ─── Opening tree builder ───────────────────────────────────────────────────────
// Builds a trie from fetched games. Each node holds the move, count, results, and
// children keyed by SAN. The root node represents the starting position.
//
// Tree shape:
//   { children: { 'd4': { san: 'd4', count: 12, wins: 8, draws: 2, losses: 2,
//       children: { 'd5': { ... }, 'Nf6': { ... } } } } }

function buildOpeningTree(games, forColor) {
  const root = { children: {} }

  for (const game of games) {
    if (!game.moves) continue

    const moves = game.moves.trim().split(/\s+/)
    // Determine result relative to the queried user
    let result = 'draw'
    if (game.winner === forColor) result = 'win'
    else if (game.winner && game.winner !== forColor) result = 'loss'

    let node = root
    for (const san of moves) {
      if (!node.children[san]) {
        node.children[san] = { san, count: 0, wins: 0, draws: 0, losses: 0, children: {} }
      }
      const child = node.children[san]
      child.count++
      if (result === 'win') child.wins++
      else if (result === 'loss') child.losses++
      else child.draws++
      node = child
    }
  }

  return root
}

// Resolve the current node in the opening tree given the move history on the board
function getTreeNode(root, moveHistory) {
  if (!root) return null
  let node = root
  for (const san of moveHistory) {
    if (!node.children[san]) return null
    node = node.children[san]
  }
  return node
}

// Get sorted next moves from a tree node (by count, descending)
function getNextMoves(node) {
  if (!node) return []
  return Object.values(node.children)
    .sort((a, b) => b.count - a.count)
}

// Convert SAN move to { from, to } squares using a chess.js instance at the current position
function sanToSquares(chess, san) {
  try {
    const clone = new Chess(chess.fen())
    const move = clone.move(san)
    if (!move) return null
    return { from: move.from, to: move.to }
  } catch {
    return null
  }
}

// ─── Chess helpers ──────────────────────────────────────────────────────────────
function getLegalDests(chess) {
  const dests = new Map()
  for (const move of chess.moves({ verbose: true })) {
    if (!dests.has(move.from)) dests.set(move.from, [])
    dests.get(move.from).push(move.to)
  }
  return dests
}

function turnColor(chess) {
  return chess.turn() === 'w' ? 'white' : 'black'
}

function getCheckSquare(chess) {
  if (!chess.inCheck()) return undefined
  const color = chess.turn()
  const kingSquares = chess.findPiece({ type: 'k', color })
  return kingSquares[0] || undefined
}

// ─── KPI tile (shadcn-style) ────────────────────────────────────────────────────
const KpiCard = ({ icon: Icon, iconColor, bg, label, value, sub }) => (
  <Card className="border-border bg-card/50 backdrop-blur-sm rounded-lg border shadow-sm hover:shadow-md transition-shadow">
    <CardContent className="p-4 sm:p-5">
      <div className={`w-9 h-9 rounded-md ${bg} flex items-center justify-center mb-3 border border-border/50`}>
        <Icon size={16} className={iconColor} strokeWidth={2} />
      </div>
      <p className="text-xl sm:text-2xl font-semibold text-foreground tracking-tight leading-none mb-1">{value ?? '—'}</p>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground/80 mt-1">{sub}</p>}
    </CardContent>
  </Card>
)

// ─── Status badge ───────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  let classes = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
  let label = 'In Progress'

  if (status.includes('Checkmate')) {
    classes = 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
    label = 'Checkmate'
  } else if (status.includes('Stalemate') || status.includes('Draw')) {
    classes = 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
    label = 'Draw'
  } else if (status.includes('Check')) {
    classes = 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20'
    label = 'Check'
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium border ${classes}`}>
      <span className="w-1 h-1 rounded-full bg-current" />
      {label}
    </span>
  )
}

// ─── Board theme color swatch ───────────────────────────────────────────────────
const ThemeSwatch = ({ theme, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 w-full px-3 py-2 rounded-md text-left text-sm transition-colors ${
      isActive
        ? 'bg-accent text-foreground border border-border'
        : 'hover:bg-muted/50 text-muted-foreground'
    }`}
  >
    <div className="flex w-6 h-6 rounded overflow-hidden border border-border/50 shrink-0">
      <div className="w-3 h-6" style={{ backgroundColor: theme.light }} />
      <div className="w-3 h-6" style={{ backgroundColor: theme.dark }} />
    </div>
    <span className="text-xs font-medium">{theme.label}</span>
  </button>
)

// ─── Piece theme swatch ─────────────────────────────────────────────────────────
const PieceSwatch = ({ theme, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 w-full px-3 py-2 rounded-md text-left text-sm transition-colors ${
      isActive
        ? 'bg-accent text-foreground border border-border'
        : 'hover:bg-muted/50 text-muted-foreground'
    }`}
  >
    <div className="w-6 h-6 shrink-0">
      <img
        src={`${LICHESS_PIECE_CDN}/${theme.id}/wN.svg`}
        alt={theme.label}
        className="w-6 h-6"
        loading="lazy"
      />
    </div>
    <span className="text-xs font-medium">{theme.label}</span>
  </button>
)

// ─── Skeleton primitives ────────────────────────────────────────────────────────
const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse rounded-md bg-muted/60 ${className}`} />
)

const KpiCardSkeleton = () => (
  <Card className="border-border bg-card/50 backdrop-blur-sm rounded-lg border shadow-sm">
    <CardContent className="p-4 sm:p-5">
      <Skeleton className="w-9 h-9 rounded-md mb-3" />
      <Skeleton className="w-16 h-6 mb-1" />
      <Skeleton className="w-24 h-3 mt-1" />
    </CardContent>
  </Card>
)

const OpeningTreeSkeleton = () => (
  <div className="divide-y divide-border">
    {[0.9, 0.7, 0.5, 0.35, 0.2].map((opacity, i) => (
      <div key={i} className="flex items-center gap-3 px-4 py-2.5" style={{ opacity }}>
        <Skeleton className="w-12 h-5" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <Skeleton className="w-full h-2 rounded-full" />
          <div className="flex justify-between">
            <Skeleton className="w-14 h-2.5" />
            <Skeleton className="w-20 h-2.5" />
          </div>
        </div>
      </div>
    ))}
  </div>
)

// ─── Evaluation bar ─────────────────────────────────────────────────────────
const EvalBar = ({ whitePercent, score, orientation }) => {
  const flipped = orientation === 'black'
  const whiteHeight = flipped ? (100 - whitePercent) : whitePercent
  const blackHeight = 100 - whiteHeight

  return (
    <div className="eval-bar-container" title={score || '0.0'}>
      <div
        className="eval-bar-black"
        style={{ height: `${blackHeight}%` }}
      />
      <div className="eval-bar-score">
        <span className="text-[9px] font-mono font-semibold leading-none select-none">
          {score || '0.0'}
        </span>
      </div>
      <div
        className="eval-bar-white"
        style={{ height: `${whiteHeight}%` }}
      />
    </div>
  )
}

// ─── Main ───────────────────────────────────────────────────────────────────
function Dashboard() {
  const boardRef = useRef(null)
  const cgRef = useRef(null)
  const chessRef = useRef(new Chess())
  const historyRef = useRef(null)
  const [orientation, setOrientation] = useState('white')
  const [moveHistory, setMoveHistory] = useState([])
  const [status, setStatus] = useState('')
  const [promotionPending, setPromotionPending] = useState(null)

  // ── Move navigation state ──────────────────────────────────────────────
  // gameHistory stores verbose move objects for replaying positions.
  // viewIndex: null = viewing live (latest) position, number = viewing
  // position after half-move N (0-indexed). Use -1 for the start position.
  const gameHistoryRef = useRef([])
  const [viewIndex, setViewIndex] = useState(null)

  // ── Preferences (persisted) ────────────────────────────────────────────
  const initialPrefs = useRef(loadPrefs())
  const [colorMode, setColorMode] = useState(initialPrefs.current.colorMode)
  const [boardTheme, setBoardTheme] = useState(initialPrefs.current.boardTheme)
  const [pieceTheme, setPieceTheme] = useState(initialPrefs.current.pieceTheme)
  const [boardSize, setBoardSize] = useState(initialPrefs.current.boardSize)
  const [soundVolume, setSoundVolume] = useState(initialPrefs.current.soundVolume)

  // Keep module-level _soundVolume in sync with React state
  const volumeRef = useRef(soundVolume)
  volumeRef.current = soundVolume
  _soundVolume = soundVolume

  // ── Resizing state ─────────────────────────────────────────────────────
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef({ startX: 0, startY: 0, startSize: 0 })

  // ── Mobile UI state ────────────────────────────────────────────────────
  const [mobileTab, setMobileTab] = useState('tree') // 'tree' | 'notation' | 'eval' | 'settings'

  // ── Engine analysis state (Lichess Cloud Eval) ─────────────────────
  const abortRef = useRef(null)
  const [engineOn, setEngineOn] = useState(false)
  const [engineLoading, setEngineLoading] = useState(false)
  const [engineError, setEngineError] = useState(null)
  const [evalInfo, setEvalInfo] = useState(null) // { depth, knodes, score, pvs }
  const [bestMove, setBestMove] = useState(null) // UCI string e.g. 'e2e4'
  const [cloudNotFound, setCloudNotFound] = useState(false)

  // ── URL query params (from Home page) ──────────────────────────────────
  const [searchParams] = useSearchParams()
  const queryUser = searchParams.get('user')
  const queryColor = searchParams.get('color') // 'white', 'black', or null (both)
  const querySpeeds = searchParams.get('speeds') // comma-separated perfTypes or null
  const queryMax = searchParams.get('max') // number string, 'all', or null (default 50)

  // ── Lichess user games state ───────────────────────────────────────────
  const [userGames, setUserGames] = useState(null) // array of game objects or null
  const [gamesLoading, setGamesLoading] = useState(false)
  const [gamesError, setGamesError] = useState(null)
  const gamesBufferRef = useRef([]) // accumulates games during streaming

  // ── Opening tree (built from fetched games) ────────────────────────────
  const openingTree = useMemo(() => {
    if (!userGames || userGames.length === 0) return null
    const color = queryColor || 'white'
    return buildOpeningTree(userGames, color)
  }, [userGames, queryColor])

  // Current node in the opening tree (follows the moves on the board)
  const treeNode = useMemo(() => {
    return getTreeNode(openingTree, moveHistory)
  }, [openingTree, moveHistory])

  // Sorted next moves from the current tree node
  const nextMoves = useMemo(() => {
    return getNextMoves(treeNode)
  }, [treeNode])

  // Total games at current position (sum of children or root count)
  const positionGames = useMemo(() => {
    if (!treeNode) return 0
    return Object.values(treeNode.children).reduce((sum, c) => sum + c.count, 0)
  }, [treeNode])

  // Game statistics computed from fetched games
  const gameStats = useMemo(() => {
    if (!userGames || userGames.length === 0) return null
    const color = queryColor || 'white'
    let wins = 0, draws = 0, losses = 0
    let totalRating = 0, ratingCount = 0

    for (const game of userGames) {
      if (game.winner === color) wins++
      else if (!game.winner) draws++
      else losses++

      // Opponent rating
      const oppSide = color === 'white' ? 'black' : 'white'
      const oppRating = game.players?.[oppSide]?.rating
      if (oppRating) {
        totalRating += oppRating
        ratingCount++
      }
    }

    const avgOppRating = ratingCount > 0 ? Math.round(totalRating / ratingCount) : null
    const winRate = userGames.length > 0 ? Math.round((wins / userGames.length) * 100) : 0

    return { wins, draws, losses, total: userGames.length, avgOppRating, winRate }
  }, [userGames, queryColor])

   // ── Opening tree arrows for the board ──────────────────────────────────
  const treeArrows = useMemo(() => {
    if (!nextMoves.length || !chessRef.current) return []
    const top = nextMoves.slice(0, 5)

    return top.map((move, idx) => {
      const sq = sanToSquares(chessRef.current, move.san)
      if (!sq) return null
      // Opacity decreases by rank: 1st=1.0, 2nd=0.75, 3rd=0.55, 4th=0.4, 5th=0.3
      const opacity = [1.0, 0.75, 0.55, 0.4, 0.3][idx] || 0.3
      const brush = `treeArrow${idx}`
      return { orig: sq.from, dest: sq.to, brush, opacity }
    }).filter(Boolean)
  }, [nextMoves, moveHistory]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist preferences on change ──────────────────────────────────────
  useEffect(() => {
    savePrefs({ colorMode, boardTheme, pieceTheme, boardSize, soundVolume })
  }, [colorMode, boardTheme, pieceTheme, boardSize, soundVolume])

  // ── Fetch user games from Lichess when URL params are present ──────────
  useEffect(() => {
    if (!queryUser) return

    const controller = new AbortController()
    let rafId = null
    let dirty = false

    gamesBufferRef.current = []
    setGamesLoading(true)
    setGamesError(null)
    setUserGames(null)

    // Flush accumulated games to React state at most once per frame
    const scheduleFlush = () => {
      if (dirty) return // already scheduled
      dirty = true
      rafId = requestAnimationFrame(() => {
        dirty = false
        setUserGames([...gamesBufferRef.current])
      })
    }

    fetchUserGames(queryUser, {
      color: queryColor || undefined,
      max: queryMax === 'all' ? null : queryMax ? parseInt(queryMax, 10) : 50,
      perfType: querySpeeds || undefined,
      signal: controller.signal,
      onGame: (game) => {
        gamesBufferRef.current.push(game)
        scheduleFlush()
      },
    })
      .then((games) => {
        if (games === null) {
          setGamesError(`User "${queryUser}" not found`)
        } else {
          // Final flush — ensure all games are in state
          setUserGames([...games])
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setGamesError(err.message || 'Failed to fetch games')
      })
      .finally(() => setGamesLoading(false))

    return () => {
      controller.abort()
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [queryUser, queryColor, querySpeeds, queryMax])

  // ── Toggle dark class on <html> ────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement
    if (colorMode === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [colorMode])

  // ── Inject piece theme CSS dynamically ─────────────────────────────────
  useEffect(() => {
    const STYLE_ID = 'piece-theme-css'
    let styleEl = document.getElementById(STYLE_ID)

    if (pieceTheme === 'cburnett') {
      // Use the statically imported cburnett CSS — remove override
      if (styleEl) styleEl.textContent = ''
      return
    }

    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = STYLE_ID
      document.head.appendChild(styleEl)
    }

    styleEl.textContent = generatePieceCSS(pieceTheme)

    return () => {
      // Don't remove on unmount — just clear on theme change
    }
  }, [pieceTheme])

  // ── Smooth theme transition (temporary class during switch) ────────────
  const triggerThemeTransition = useCallback(() => {
    const root = document.documentElement
    root.classList.add('theme-transition')
    const timeout = setTimeout(() => root.classList.remove('theme-transition'), 400)
    return () => clearTimeout(timeout)
  }, [])

  const toggleColorMode = useCallback(() => {
    triggerThemeTransition()
    setColorMode(prev => prev === 'dark' ? 'light' : 'dark')
  }, [triggerThemeTransition])

  const changeBoardTheme = useCallback((theme) => {
    setBoardTheme(theme)
  }, [])

  const changePieceTheme = useCallback((theme) => {
    setPieceTheme(theme)
  }, [])

  // ── Board size computation ─────────────────────────────────────────────
  const computedBoardSize = useMemo(() => {
    if (boardSize > 0) return boardSize
    return 0 // 0 signals "auto" — handled in CSS
  }, [boardSize])

  const boardStyle = useMemo(() => {
    if (computedBoardSize > 0) {
      return { width: `${computedBoardSize}px`, height: `${computedBoardSize}px` }
    }
    // Account for eval bar (34px = 26px bar + 8px gap) when engine is on
    const evalOffset = engineOn ? ' - 34px' : ''
    return {
      width: `min(calc(100vh - 12rem), min(calc(80vw${evalOffset}), 560px))`,
      height: `min(calc(100vh - 12rem), min(calc(80vw${evalOffset}), 560px))`,
    }
  }, [computedBoardSize, engineOn])

  // ── Resize handlers ────────────────────────────────────────────────────
  const onResizeStart = useCallback((e) => {
    e.preventDefault()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const currentSize = boardRef.current?.getBoundingClientRect().width || 400

    resizeRef.current = { startX: clientX, startY: clientY, startSize: currentSize }
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const onMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const clientY = e.touches ? e.touches[0].clientY : e.clientY
      const { startX, startY, startSize } = resizeRef.current
      const dx = clientX - startX
      const dy = clientY - startY
      const delta = Math.max(dx, dy) // Use whichever is larger
      const newSize = Math.max(280, Math.min(800, Math.round(startSize + delta)))
      setBoardSize(newSize)
    }

    const onEnd = () => {
      setIsResizing(false)
      // Redraw chessground after resize
      if (cgRef.current) {
        cgRef.current.redrawAll()
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onEnd)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onEnd)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [isResizing])

  // Redraw chessground when board size changes (debounced for smoothness)
  useEffect(() => {
    if (cgRef.current && boardSize > 0) {
      const timer = setTimeout(() => cgRef.current?.redrawAll(), 10)
      return () => clearTimeout(timer)
    }
  }, [boardSize])

  // Stats derived from move history
  const stats = useMemo(() => {
    const chess = chessRef.current
    const history = chess.history({ verbose: true })
    const captures = history.filter(m => m.isCapture()).length
    const checks = history.filter(m => m.san.includes('+')).length
    const moveNum = Math.ceil(moveHistory.length / 2)
    return { captures, checks, moveNum, halfMoves: moveHistory.length }
  }, [moveHistory])

  // Compute paired moves for display
  const movePairs = useMemo(() => {
    const pairs = []
    for (let i = 0; i < moveHistory.length; i += 2) {
      pairs.push({
        num: Math.floor(i / 2) + 1,
        white: moveHistory[i],
        black: moveHistory[i + 1] || null,
      })
    }
    return pairs
  }, [moveHistory])

  const updateStatus = useCallback(() => {
    const chess = chessRef.current
    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'Black' : 'White'
      setStatus(`Checkmate! ${winner} wins.`)
    } else if (chess.isStalemate()) {
      setStatus('Stalemate! Draw.')
    } else if (chess.isDraw()) {
      if (chess.isInsufficientMaterial()) setStatus('Draw — insufficient material.')
      else if (chess.isThreefoldRepetition()) setStatus('Draw — threefold repetition.')
      else if (chess.isDrawByFiftyMoves()) setStatus('Draw — fifty-move rule.')
      else setStatus('Draw.')
    } else {
      const turn = chess.turn() === 'w' ? 'White' : 'Black'
      const check = chess.inCheck() ? ' — Check!' : ''
      setStatus(`${turn} to move${check}`)
    }
  }, [])

  const syncBoard = useCallback(() => {
    const chess = chessRef.current
    const cg = cgRef.current
    if (!cg) return

    const color = turnColor(chess)
    const isOver = chess.isGameOver()

    cg.set({
      fen: chess.fen(),
      turnColor: color,
      check: getCheckSquare(chess),
      movable: {
        free: false,
        color: isOver ? undefined : color,
        dests: isOver ? new Map() : getLegalDests(chess),
      },
    })

    updateStatus()
  }, [updateStatus])

  // Show a specific position on the board (view-only, no moves allowed)
  const showPosition = useCallback((fen, lastMoveSquares) => {
    const cg = cgRef.current
    if (!cg) return

    const chess = new Chess(fen)

    cg.set({
      fen,
      turnColor: turnColor(chess),
      check: getCheckSquare(chess),
      lastMove: lastMoveSquares || undefined,
      movable: {
        free: false,
        color: undefined,
        dests: new Map(),
      },
    })
  }, [])

  const makeMove = useCallback((orig, dest, promotion) => {
    // Only allow moves when viewing the live (latest) position
    if (viewIndex !== null) return false

    const chess = chessRef.current
    try {
      const moveObj = chess.move({
        from: orig,
        to: dest,
        promotion: promotion || undefined,
      })

      if (!moveObj) return false

      if (chess.isCheckmate() || chess.isStalemate() || chess.isDraw()) {
        playSound('gameEnd')
      } else if (chess.inCheck()) {
        playSound('check')
      } else if (moveObj.isCapture()) {
        playSound('capture')
      } else if (moveObj.isKingsideCastle() || moveObj.isQueensideCastle()) {
        playSound('castle')
      } else if (moveObj.isPromotion()) {
        playSound('promote')
      } else {
        playSound('move')
      }

      gameHistoryRef.current = [...gameHistoryRef.current, moveObj]
      setMoveHistory(prev => [...prev, moveObj.san])
      syncBoard()
      cgRef.current?.set({ lastMove: [orig, dest] })

      return true
    } catch {
      syncBoard()
      return false
    }
  }, [syncBoard, viewIndex])

  const isPromotion = useCallback((orig, dest) => {
    const chess = chessRef.current
    const piece = chess.get(orig)
    if (!piece || piece.type !== 'p') return false
    const destRank = dest[1]
    if (piece.color === 'w' && destRank === '8') return true
    if (piece.color === 'b' && destRank === '1') return true
    return false
  }, [])

  const onMove = useCallback((orig, dest) => {
    if (isPromotion(orig, dest)) {
      setPromotionPending({ orig, dest })
      return
    }
    makeMove(orig, dest)
  }, [makeMove, isPromotion])

  // Initialize board
  useEffect(() => {
    if (boardRef.current && !cgRef.current) {
      const chess = chessRef.current
      cgRef.current = Chessground(boardRef.current, {
        orientation,
        fen: chess.fen(),
        turnColor: turnColor(chess),
        movable: {
          free: false,
          color: 'white',
          dests: getLegalDests(chess),
          showDests: true,
        },
        draggable: { enabled: true, showGhost: true },
        selectable: { enabled: true },
        animation: { enabled: true, duration: 200 },
        highlight: { lastMove: true, check: true },
        premovable: { enabled: false },
        events: { move: onMove },
      })
      updateStatus()
      // Play game start sound
      playSound('gameStart')
    }
    return () => {
      if (cgRef.current) {
        cgRef.current.destroy()
        cgRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cgRef.current) cgRef.current.set({ events: { move: onMove } })
  }, [onMove])

  useEffect(() => {
    if (cgRef.current) cgRef.current.set({ orientation })
  }, [orientation])

  useEffect(() => {
    if (!historyRef.current) return
    if (viewIndex === null) {
      // Scroll to bottom when at live position
      historyRef.current.scrollTop = historyRef.current.scrollHeight
    } else {
      // Scroll to keep the active move row visible
      const rowIdx = viewIndex === -1 ? 0 : Math.floor(viewIndex / 2)
      const rows = historyRef.current.querySelectorAll('tbody tr')
      if (rows[rowIdx]) {
        rows[rowIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [moveHistory, viewIndex])

  // ── Cloud eval: fetch evaluation for a given FEN ─────────────────────
  const doCloudEval = useCallback(async (fen, signal) => {
    const chess = new Chess(fen)
    if (chess.isCheckmate() || chess.isStalemate() || chess.isDraw()) {
      setEvalInfo(null)
      setBestMove(null)
      setCloudNotFound(false)
      setEngineLoading(false)
      return
    }

    setEngineLoading(true)
    setEngineError(null)
    setCloudNotFound(false)

    try {
      const data = await fetchCloudEval(fen, { multiPv: 3, signal })

      if (!data) {
        // Position not in database
        setCloudNotFound(true)
        setEvalInfo(null)
        setBestMove(null)
        setEngineLoading(false)
        return
      }

      const parsed = parseCloudEval(data)
      setEvalInfo(parsed)
      setCloudNotFound(false)

      // Set best move from the first PV line
      if (parsed?.pvs?.[0]?.moves?.[0]) {
        setBestMove(parsed.pvs[0].moves[0])
      } else {
        setBestMove(null)
      }

      setEngineLoading(false)
    } catch (err) {
      if (err.name === 'AbortError') return
      setEngineError('Failed to fetch cloud eval')
      setEngineLoading(false)
    }
  }, [])

  // Compute the FEN for the currently viewed position
  const viewedFen = useMemo(() => {
    if (viewIndex === null) return chessRef.current.fen()
    if (viewIndex === -1) return new Chess().fen()
    const chess = new Chess()
    const history = gameHistoryRef.current
    for (let i = 0; i <= viewIndex && i < history.length; i++) {
      const m = history[i]
      chess.move({ from: m.from, to: m.to, promotion: m.promotion || undefined })
    }
    return chess.fen()
  }, [viewIndex, moveHistory]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Engine toggle: fetch or clear ─────────────────────────────────────
  useEffect(() => {
    if (!engineOn) {
      // Cancel any in-flight request
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
      setEvalInfo(null)
      setBestMove(null)
      setCloudNotFound(false)
      setEngineLoading(false)
      setEngineError(null)
      return
    }

    // Fetch for the current position
    const controller = new AbortController()
    abortRef.current = controller
    doCloudEval(viewedFen, controller.signal)

    return () => {
      controller.abort()
    }
  }, [engineOn]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-fetch when viewed position changes ─────────────────────────────
  useEffect(() => {
    if (!engineOn) return

    // Cancel previous request
    if (abortRef.current) {
      abortRef.current.abort()
    }

    setEvalInfo(null)
    setBestMove(null)

    const controller = new AbortController()
    abortRef.current = controller
    doCloudEval(viewedFen, controller.signal)

    return () => {
      controller.abort()
    }
  }, [viewedFen, engineOn, doCloudEval])

  // ── Draw arrows on the board (engine best-move + opening tree) ─────────
  useEffect(() => {
    const cg = cgRef.current
    if (!cg) return

    const shapes = []
    const customBrushes = {}

    // Opening tree arrows (always shown when available)
    if (treeArrows.length > 0) {
      for (const arrow of treeArrows) {
        customBrushes[arrow.brush] = {
          key: arrow.brush,
          color: '#15803d', // green-700
          opacity: arrow.opacity,
          lineWidth: 10,
        }
        shapes.push({ orig: arrow.orig, dest: arrow.dest, brush: arrow.brush })
      }
    }

    // Engine best-move arrow (drawn on top of tree arrows)
    if (engineOn && bestMove) {
      const sq = uciToSquares(bestMove)
      if (sq) {
        shapes.push({ orig: sq.from, dest: sq.to, brush: 'paleBlue' })
      }
    }

    cg.set({ drawable: { autoShapes: shapes, brushes: customBrushes } })
  }, [bestMove, engineOn, treeArrows])

  const toggleEngine = useCallback(() => {
    setEngineOn(prev => !prev)
  }, [])

  // Derived engine display values
  const evalScore = useMemo(() => {
    if (!evalInfo?.score) return '0.0'
    return formatScore(evalInfo.score)
  }, [evalInfo])

  const evalPercent = useMemo(() => {
    if (!evalInfo?.score) return 50
    return evalToWhitePercent(evalInfo.score)
  }, [evalInfo])

  // Convert each PV line's UCI moves to SAN for display
  const pvLinesSan = useMemo(() => {
    if (!evalInfo?.pvs?.length) return []
    return evalInfo.pvs.map((pv) => {
      try {
        const chess = new Chess(viewedFen)
        const sans = []
        for (const uci of pv.moves.slice(0, 8)) {
          const from = uci.slice(0, 2)
          const to = uci.slice(2, 4)
          const promotion = uci.length > 4 ? uci[4] : undefined
          const move = chess.move({ from, to, promotion })
          if (!move) break
          sans.push(move.san)
        }
        return { sans, score: pv.score }
      } catch {
        return { sans: [], score: pv.score }
      }
    }).filter((line) => line.sans.length > 0)
  }, [evalInfo, viewedFen])

  const flipBoard = () => setOrientation(prev => (prev === 'white' ? 'black' : 'white'))

  const resetBoard = () => {
    chessRef.current = new Chess()
    gameHistoryRef.current = []
    setMoveHistory([])
    setViewIndex(null)
    setPromotionPending(null)
    setEvalInfo(null)
    setBestMove(null)
    setCloudNotFound(false)
    if (cgRef.current) {
      cgRef.current.destroy()
      const chess = chessRef.current
      cgRef.current = Chessground(boardRef.current, {
        orientation,
        fen: chess.fen(),
        turnColor: 'white',
        movable: { free: false, color: 'white', dests: getLegalDests(chess), showDests: true },
        draggable: { enabled: true, showGhost: true },
        selectable: { enabled: true },
        animation: { enabled: true, duration: 200 },
        highlight: { lastMove: true, check: true },
        premovable: { enabled: false },
        events: { move: onMove },
      })
    }
    updateStatus()
    playSound('gameStart')
  }

  const undoMove = () => {
    // If viewing a past position, jump to live first
    if (viewIndex !== null) {
      setViewIndex(null)
      syncBoard()
      return
    }
    const undone = chessRef.current.undo()
    if (undone) {
      gameHistoryRef.current = gameHistoryRef.current.slice(0, -1)
      setMoveHistory(prev => prev.slice(0, -1))
      syncBoard()
      cgRef.current?.set({ lastMove: undefined })
    }
  }

  // ── Move navigation ─────────────────────────────────────────────────
  // Reconstruct position at a given half-move index by replaying moves
  const replayToIndex = useCallback((idx) => {
    const history = gameHistoryRef.current
    const chess = new Chess()
    let lastFrom = null
    let lastTo = null

    for (let i = 0; i <= idx && i < history.length; i++) {
      const m = history[i]
      chess.move({ from: m.from, to: m.to, promotion: m.promotion || undefined })
      lastFrom = m.from
      lastTo = m.to
    }

    return { fen: chess.fen(), lastMove: lastFrom ? [lastFrom, lastTo] : undefined }
  }, [])

  const isAtLive = viewIndex === null

  const goToStart = useCallback(() => {
    if (moveHistory.length === 0) return
    setViewIndex(-1)
    const startFen = new Chess().fen()
    showPosition(startFen, undefined)
    playSound('move')
  }, [moveHistory.length, showPosition])

  const goBack = useCallback(() => {
    if (moveHistory.length === 0) return
    const current = viewIndex === null ? moveHistory.length - 1 : viewIndex
    if (current <= -1) return

    const newIdx = current - 1
    setViewIndex(newIdx)

    if (newIdx === -1) {
      showPosition(new Chess().fen(), undefined)
    } else {
      const { fen, lastMove } = replayToIndex(newIdx)
      showPosition(fen, lastMove)
    }
    playSound('move')
  }, [viewIndex, moveHistory.length, showPosition, replayToIndex])

  const goForward = useCallback(() => {
    if (moveHistory.length === 0) return
    if (viewIndex === null) return // already at live

    const newIdx = viewIndex + 1
    const history = gameHistoryRef.current
    if (newIdx >= moveHistory.length - 1) {
      // Return to live position
      setViewIndex(null)
      syncBoard()
      // Restore last move highlight from the game
      if (history.length > 0) {
        const last = history[history.length - 1]
        cgRef.current?.set({ lastMove: [last.from, last.to] })
      }
    } else {
      setViewIndex(newIdx)
      const { fen, lastMove } = replayToIndex(newIdx)
      showPosition(fen, lastMove)
    }
    playSoundForMoveObj(history[newIdx])
  }, [viewIndex, moveHistory.length, syncBoard, showPosition, replayToIndex])

  const goToEnd = useCallback(() => {
    if (viewIndex === null) return
    setViewIndex(null)
    syncBoard()
    // Restore last move highlight
    const history = gameHistoryRef.current
    if (history.length > 0) {
      const last = history[history.length - 1]
      cgRef.current?.set({ lastMove: [last.from, last.to] })
      playSoundForMoveObj(last)
    }
  }, [viewIndex, syncBoard])

  const goToMove = useCallback((idx) => {
    if (idx < 0 || idx >= moveHistory.length) return
    const history = gameHistoryRef.current
    if (idx === moveHistory.length - 1) {
      // Clicked on the last move — return to live
      setViewIndex(null)
      syncBoard()
      if (history.length > 0) {
        const last = history[history.length - 1]
        cgRef.current?.set({ lastMove: [last.from, last.to] })
      }
    } else {
      setViewIndex(idx)
      const { fen, lastMove } = replayToIndex(idx)
      showPosition(fen, lastMove)
    }
    playSoundForMoveObj(history[idx])
  }, [moveHistory.length, syncBoard, showPosition, replayToIndex])

  // ── Keyboard navigation ─────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      // Don't capture when focus is in an input/select/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          goBack()
          break
        case 'ArrowRight':
          e.preventDefault()
          goForward()
          break
        case 'ArrowUp':
        case 'Home':
          e.preventDefault()
          goToStart()
          break
        case 'ArrowDown':
        case 'End':
          e.preventDefault()
          goToEnd()
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goBack, goForward, goToStart, goToEnd])

  const handlePromotion = (piece) => {
    if (!promotionPending) return
    makeMove(promotionPending.orig, promotionPending.dest, piece)
    setPromotionPending(null)
  }

  const cancelPromotion = () => {
    setPromotionPending(null)
    syncBoard()
  }

  const resetBoardSize = useCallback(() => {
    setBoardSize(0)
    // Wait for DOM to update then redraw
    setTimeout(() => cgRef.current?.redrawAll(), 50)
  }, [])

  // Board theme class for the wrapper (brown uses the imported CSS, others use our custom CSS)
  const boardThemeClass = boardTheme === 'brown' ? '' : `board-theme-${boardTheme}`

  return (
    <div className="relative flex flex-col min-w-0 flex-1 min-h-screen bg-background">
      <DotPattern />

      {/* ── Promotion dialog ──────────────────────────────────────────────── */}
      {promotionPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={cancelPromotion}>
          <div className="rounded-lg border border-border bg-card p-6 w-full max-w-xs shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-1">Promote Pawn</h3>
            <p className="text-xs text-muted-foreground mb-4">Choose a piece for promotion:</p>
            <div className="flex gap-2 justify-center">
              {[
                { piece: 'q', label: 'Queen', symbol: '\u265B' },
                { piece: 'r', label: 'Rook', symbol: '\u265C' },
                { piece: 'b', label: 'Bishop', symbol: '\u265D' },
                { piece: 'n', label: 'Knight', symbol: '\u265E' },
              ].map(({ piece, label, symbol }) => (
                <button
                  key={piece}
                  onClick={() => handlePromotion(piece)}
                  className="flex flex-col items-center gap-1.5 rounded-md border border-border bg-muted/50 hover:bg-accent px-4 py-3 transition-all duration-150 hover:scale-105 hover:border-muted-foreground/30"
                  title={label}
                >
                  <span className="text-3xl text-foreground">{symbol}</span>
                  <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex h-14 min-h-[52px] items-center justify-between border-b border-border bg-background/80 backdrop-blur-md px-4 md:px-6 shrink-0">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-muted/50 border border-border flex items-center justify-center">
              <Crown size={16} className="text-foreground" strokeWidth={2} />
            </div>
            <span className="text-base font-semibold text-foreground tracking-tight">RepertoireLab</span>
          </div>
          {queryUser && (
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-card/50 px-2.5 py-1 ml-2">
              <User size={12} className="text-muted-foreground" strokeWidth={2} />
              <span className="text-[10px] font-medium text-foreground uppercase tracking-wider">{queryUser}</span>
              {queryColor && (
                <span className="text-[10px] text-muted-foreground hidden sm:inline">({queryColor})</span>
              )}
            </div>
          )}
          {!queryUser && (
            <div className="hidden md:flex items-center gap-1.5 rounded-md border border-border bg-card/50 px-2.5 py-1 ml-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">Live</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <StatusBadge status={status} />
          <div className="h-4 w-px bg-border mx-1.5 hidden sm:block" />

          {/* Light/Dark toggle */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={toggleColorMode}
            title={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {colorMode === 'dark' ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
          </Button>

          {/* Board theme selector — hidden on mobile */}
          <div className="hidden sm:block">
            <Select value={boardTheme} onValueChange={changeBoardTheme}>
              <SelectTrigger className="h-8 w-[120px] text-xs gap-1">
                <Palette size={14} className="shrink-0 text-muted-foreground" strokeWidth={2} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BOARD_THEMES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <div className="flex w-4 h-4 rounded overflow-hidden border border-border/50 shrink-0">
                        <div className="w-2 h-4" style={{ backgroundColor: t.light }} />
                        <div className="w-2 h-4" style={{ backgroundColor: t.dark }} />
                      </div>
                      <span>{t.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Piece theme selector — hidden on mobile */}
          <div className="hidden sm:block">
            <Select value={pieceTheme} onValueChange={changePieceTheme}>
              <SelectTrigger className="h-8 w-[130px] text-xs gap-1">
                <User size={14} className="shrink-0 text-muted-foreground" strokeWidth={2} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIECE_THEMES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <img
                        src={`${LICHESS_PIECE_CDN}/${t.id}/wN.svg`}
                        alt=""
                        className="w-4 h-4 shrink-0"
                        loading="lazy"
                      />
                      <span>{t.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Volume control — hidden on mobile (accessible in settings tab) */}
          <div className="hidden sm:flex items-center gap-1">
            <button
              onClick={() => setSoundVolume(prev => prev > 0 ? 0 : 0.7)}
              className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title={soundVolume > 0 ? 'Mute sounds' : 'Unmute sounds'}
            >
              {soundVolume > 0
                ? <Volume2 size={14} strokeWidth={2} />
                : <VolumeX size={14} strokeWidth={2} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={soundVolume}
              onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
              className="w-16 h-1 accent-foreground cursor-pointer"
              title={`Volume: ${Math.round(soundVolume * 100)}%`}
            />
          </div>

          {/* Mobile mute button — visible only below sm */}
          <button
            onClick={() => setSoundVolume(prev => prev > 0 ? 0 : 0.7)}
            className="sm:hidden p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title={soundVolume > 0 ? 'Mute sounds' : 'Unmute sounds'}
          >
            {soundVolume > 0
              ? <Volume2 size={14} strokeWidth={2} />
              : <VolumeX size={14} strokeWidth={2} />}
          </button>

          <div className="h-4 w-px bg-border mx-1 hidden sm:block" />
          <a
            href="https://github.com/lichess-org/chessground"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>GitHub</span>
            <ExternalLink size={12} strokeWidth={2} />
          </a>
        </div>
      </header>

      {/* ── Games loading / error banner ────────────────────────────────── */}
      {queryUser && (gamesLoading || gamesError || userGames) && (
        <div className="relative z-20 border-b border-border bg-card/50 backdrop-blur-sm px-4 md:px-6 py-2.5 overflow-hidden">
          {/* Animated progress bar when loading */}
          {gamesLoading && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-muted overflow-hidden">
              <div className="h-full bg-foreground/60 animate-[loading_1.5s_ease-in-out_infinite]" style={{ width: '40%' }} />
            </div>
          )}
          {gamesLoading && (
            <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin" strokeWidth={2} />
              <span>
                Fetching games for <span className="font-medium text-foreground">{queryUser}</span>
                {userGames && userGames.length > 0 && (
                  <> — <span className="font-mono font-medium text-foreground">{userGames.length}</span> loaded</>
                )}
                ...
              </span>
            </div>
          )}
          {gamesError && (
            <div className="flex items-center gap-2.5 text-xs text-destructive">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
              {gamesError}
            </div>
          )}
          {userGames && !gamesLoading && !gamesError && (
            <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
              <span>
                Loaded <span className="font-medium text-foreground">{userGames.length}</span> game{userGames.length !== 1 ? 's' : ''} for{' '}
                <a
                  href={`https://lichess.org/@/${queryUser}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground hover:underline"
                >
                  {queryUser}
                </a>
                {queryColor && <span className="text-muted-foreground"> ({queryColor})</span>}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Main content — 3-column: left sidebar | board | right sidebar ── */}
      <div className="flex flex-1 min-h-0 relative z-10">

        {/* ── Left sidebar (Opening tree + game stats) ──────────────────────── */}
        <div className="hidden xl:flex flex-col w-[280px] shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-border bg-background/50 backdrop-blur-sm">
          <div className="p-4 space-y-4">

            {/* Hero badge */}
            <div className="relative w-full rounded-lg overflow-hidden border border-border p-4">
              <div className="absolute inset-0 bg-background/85" />
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage: `radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground) / 0.3) 1px, transparent 0)`,
                  backgroundSize: '20px 20px',
                }}
              />
              <div className="relative">
                {queryUser ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        <User size={10} className="shrink-0" strokeWidth={2} />
                        {queryColor || 'both'}
                      </span>
                      <StatusBadge status={status} />
                    </div>
                    <h2 className="text-base font-semibold text-foreground tracking-tight">{queryUser}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {gameStats ? `${gameStats.total} games analyzed` : gamesLoading ? 'Loading games...' : status || 'White to move'}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        <CircleDot size={10} className="text-green-500 shrink-0" strokeWidth={2} />
                        Live
                      </span>
                      <StatusBadge status={status} />
                    </div>
                    <h2 className="text-base font-semibold text-foreground tracking-tight">Chess Board</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{status || 'White to move'}</p>
                  </>
                )}
              </div>
            </div>

            {/* Game Stats KPI Cards (when games are loaded) */}
            {gameStats && (
              <div className="grid grid-cols-1 gap-3">
                <KpiCard
                  icon={Trophy} bg="bg-emerald-500/10" iconColor="text-emerald-600 dark:text-emerald-400"
                  label="Win Rate" value={`${gameStats.winRate}%`}
                  sub={`${gameStats.wins}W / ${gameStats.draws}D / ${gameStats.losses}L`}
                />
                <KpiCard
                  icon={BarChart3} bg="bg-blue-500/10" iconColor="text-blue-600 dark:text-blue-400"
                  label="Games Analyzed" value={gameStats.total}
                  sub={`Playing as ${queryColor || 'both'}`}
                />
                <KpiCard
                  icon={TrendingUp} bg="bg-amber-500/10" iconColor="text-amber-600 dark:text-amber-400"
                  label="Avg Opponent" value={gameStats.avgOppRating || '—'}
                  sub="Average opponent rating"
                />
              </div>
            )}

            {/* Loading skeleton KPI Cards */}
            {!gameStats && gamesLoading && (
              <div className="grid grid-cols-1 gap-3">
                <KpiCardSkeleton />
                <KpiCardSkeleton />
                <KpiCardSkeleton />
              </div>
            )}

            {/* Fallback KPI Cards (when no games loaded — sandbox mode) */}
            {!gameStats && !gamesLoading && (
              <div className="grid grid-cols-1 gap-3">
                <KpiCard
                  icon={Swords} bg="bg-blue-500/10" iconColor="text-blue-600 dark:text-blue-400"
                  label="Moves played" value={stats.moveNum}
                  sub={`${stats.halfMoves} half-moves`}
                />
                <KpiCard
                  icon={Shield} bg="bg-emerald-500/10" iconColor="text-emerald-600 dark:text-emerald-400"
                  label="Turn"
                  value={chessRef.current.isGameOver() ? 'Game Over' : chessRef.current.turn() === 'w' ? 'White' : 'Black'}
                  sub={orientation === 'white' ? 'Playing as White' : 'Playing as Black'}
                />
              </div>
            )}

            {/* Board Theme Card (sidebar) */}
            <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
              <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                <CardTitle className="text-sm font-semibold text-foreground">Board Theme</CardTitle>
              </CardHeader>
              <CardContent className="p-2">
                <div className="space-y-0.5">
                  {BOARD_THEMES.map((t) => (
                    <ThemeSwatch
                      key={t.id}
                      theme={t}
                      isActive={boardTheme === t.id}
                      onClick={() => changeBoardTheme(t.id)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Piece Theme Card (sidebar) */}
            <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
              <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                <CardTitle className="text-sm font-semibold text-foreground">Piece Theme</CardTitle>
              </CardHeader>
              <CardContent className="p-2">
                <div className="space-y-0.5">
                  {PIECE_THEMES.map((t) => (
                    <PieceSwatch
                      key={t.id}
                      theme={t}
                      isActive={pieceTheme === t.id}
                      onClick={() => changePieceTheme(t.id)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Sound Card (sidebar) */}
            <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
              <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                <CardTitle className="text-sm font-semibold text-foreground">Sound</CardTitle>
              </CardHeader>
              <CardContent className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSoundVolume(prev => prev > 0 ? 0 : 0.7)}
                    className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                    title={soundVolume > 0 ? 'Mute sounds' : 'Unmute sounds'}
                  >
                    {soundVolume > 0
                      ? <Volume2 size={16} strokeWidth={2} />
                      : <VolumeX size={16} strokeWidth={2} />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={soundVolume}
                    onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
                    className="flex-1 h-1.5 accent-foreground cursor-pointer"
                    title={`Volume: ${Math.round(soundVolume * 100)}%`}
                  />
                  <span className="text-xs text-muted-foreground tabular-nums w-8 text-right shrink-0">
                    {Math.round(soundVolume * 100)}%
                  </span>
                </div>
              </CardContent>
            </Card>

          </div>
        </div>

        {/* ── Center — Board ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-w-0">
          <div className="flex flex-col items-center justify-center px-4 md:px-6 py-6 min-h-[calc(100vh-3.5rem)]">

            {/* Controls bar */}
            <div className="flex items-center gap-1.5 mb-4">
              <Button variant="outline" size="sm" onClick={flipBoard} className="h-8 gap-1.5 text-xs">
                <RotateCcw size={14} strokeWidth={2} />
                <span className="hidden sm:inline">Flip</span>
              </Button>
              <Button variant="outline" size="sm" onClick={undoMove} disabled={moveHistory.length === 0} className="h-8 gap-1.5 text-xs">
                <Undo2 size={14} strokeWidth={2} />
                <span className="hidden sm:inline">Undo</span>
              </Button>
              <Button variant="outline" size="sm" onClick={resetBoard} className="h-8 gap-1.5 text-xs">
                <RefreshCw size={14} strokeWidth={2} />
                <span className="hidden sm:inline">New Game</span>
              </Button>
              {boardSize > 0 && (
                <Button variant="outline" size="sm" onClick={resetBoardSize} className="h-8 gap-1.5 text-xs">
                  <GripVertical size={14} strokeWidth={2} />
                  <span className="hidden sm:inline">Auto Size</span>
                </Button>
              )}
              <div className="h-5 w-px bg-border mx-0.5" />
              <Button
                variant={engineOn ? 'default' : 'outline'}
                size="sm"
                onClick={toggleEngine}
                disabled={engineLoading}
                className="h-8 gap-1.5 text-xs"
                title={engineOn ? 'Stop engine analysis' : 'Start engine analysis'}
              >
                {engineLoading ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : <Cpu size={14} strokeWidth={2} />}
                <span className="hidden sm:inline">{engineLoading ? 'Loading...' : engineOn ? 'Engine On' : 'Engine'}</span>
              </Button>
            </div>

            {/* Board with eval bar and resize handle */}
            <div className="flex items-stretch gap-2 max-w-full">
              {engineOn && (
                <EvalBar
                  whitePercent={evalPercent}
                  score={evalScore}
                  orientation={orientation}
                />
              )}
              <div className={`relative board-resize-wrapper ${boardThemeClass}`}>
                <div
                  ref={boardRef}
                  className="rounded-md overflow-hidden border border-border shadow-lg"
                  style={boardStyle}
                />
                {/* Resize handle — bottom-right corner */}
                <div
                  className="board-resize-handle"
                  onMouseDown={onResizeStart}
                  onTouchStart={onResizeStart}
                  title="Drag to resize board"
                />
                {boardSize > 0 && (
                  <div className="absolute -bottom-6 left-1/2 -translate-x-1/2">
                    <span className="text-[10px] text-muted-foreground/60 font-mono tabular-nums">{boardSize}px</span>
                  </div>
                )}
              </div>
            </div>

            {/* Move navigation bar */}
            {moveHistory.length > 0 && (
              <div className="flex items-center gap-1 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={goToStart}
                  disabled={viewIndex === -1}
                  title="Go to start (Home)"
                >
                  <ChevronsLeft size={14} strokeWidth={2} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={goBack}
                  disabled={viewIndex === -1}
                  title="Previous move (←)"
                >
                  <ChevronLeft size={14} strokeWidth={2} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={goForward}
                  disabled={isAtLive}
                  title="Next move (→)"
                >
                  <ChevronRight size={14} strokeWidth={2} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={goToEnd}
                  disabled={isAtLive}
                  title="Go to latest (End)"
                >
                  <ChevronsRight size={14} strokeWidth={2} />
                </Button>
                {!isAtLive && (
                  <span className="text-[10px] text-muted-foreground font-mono ml-2">
                    {viewIndex === -1 ? 'Start' : `Move ${Math.floor(viewIndex / 2) + 1}${viewIndex % 2 === 0 ? '.' : '...'}`}
                  </span>
                )}
              </div>
            )}

            {/* Status below board */}
            <div className={`flex items-center gap-2 ${boardSize > 0 ? 'mt-8' : 'mt-4'}`}>
              <StatusBadge status={status} />
              <span className="text-xs text-muted-foreground">{status}</span>
            </div>

            {/* Mobile-only KPI row (visible below xl) */}
            <div className="xl:hidden grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 w-full max-w-xl">
              {gamesLoading && !gameStats ? (
                <>
                  <KpiCardSkeleton />
                  <KpiCardSkeleton />
                  <KpiCardSkeleton />
                  <KpiCardSkeleton />
                </>
              ) : gameStats ? (
                <>
                  <KpiCard
                    icon={Trophy} bg="bg-emerald-500/10" iconColor="text-emerald-600 dark:text-emerald-400"
                    label="Win Rate" value={`${gameStats.winRate}%`}
                  />
                  <KpiCard
                    icon={BarChart3} bg="bg-blue-500/10" iconColor="text-blue-600 dark:text-blue-400"
                    label="Games" value={gameStats.total}
                  />
                  <KpiCard
                    icon={TrendingUp} bg="bg-amber-500/10" iconColor="text-amber-600 dark:text-amber-400"
                    label="Avg Opp" value={gameStats.avgOppRating || '—'}
                  />
                  <KpiCard
                    icon={Shield} bg="bg-emerald-500/10" iconColor="text-emerald-600 dark:text-emerald-400"
                    label="Record"
                    value={`${gameStats.wins}-${gameStats.draws}-${gameStats.losses}`}
                  />
                </>
              ) : (
                <>
                  <KpiCard
                    icon={Swords} bg="bg-blue-500/10" iconColor="text-blue-600 dark:text-blue-400"
                    label="Moves" value={stats.moveNum}
                  />
                  <KpiCard
                    icon={Target} bg="bg-red-500/10" iconColor="text-red-600 dark:text-red-400"
                    label="Captures" value={stats.captures}
                  />
                  <KpiCard
                    icon={Zap} bg="bg-amber-500/10" iconColor="text-amber-600 dark:text-amber-400"
                    label="Checks" value={stats.checks}
                  />
                  <KpiCard
                    icon={Shield} bg="bg-emerald-500/10" iconColor="text-emerald-600 dark:text-emerald-400"
                    label="Turn"
                    value={chessRef.current.isGameOver() ? 'Over' : chessRef.current.turn() === 'w' ? 'White' : 'Black'}
                  />
                </>
              )}
            </div>

            {/* ── Mobile tab bar + panels (below xl) ────────────────────── */}
            <div className="xl:hidden w-full max-w-xl mt-6">
              {/* Tab bar */}
              <div className="flex border border-border rounded-lg overflow-hidden bg-card/50">
                {[
                  { id: 'tree', label: 'Opening Tree', icon: BookOpen },
                  { id: 'notation', label: 'Moves', icon: Swords },
                  { id: 'eval', label: 'Eval', icon: Cpu },
                  { id: 'settings', label: 'Settings', icon: Settings },
                ].map(({ id, label, icon: TabIcon }) => (
                  <button
                    key={id}
                    onClick={() => setMobileTab(id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors ${
                      mobileTab === id
                        ? 'bg-accent text-foreground border-b-2 border-foreground'
                        : 'text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    <TabIcon size={14} strokeWidth={2} />
                    <span className="hidden xs:inline sm:inline">{label}</span>
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="mt-3">
                {/* ── Opening Tree tab ────────────────────────────────── */}
                {mobileTab === 'tree' && (
                  <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
                    <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <BookOpen size={14} className="text-muted-foreground" strokeWidth={2} />
                          <CardTitle className="text-sm font-semibold text-foreground">Opening Tree</CardTitle>
                        </div>
                        {positionGames > 0 && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {positionGames} game{positionGames !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      {gamesLoading && !openingTree ? (
                        <OpeningTreeSkeleton />
                      ) : !openingTree ? (
                        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-4">
                          <div className="w-10 h-10 rounded-md bg-muted/50 border border-border flex items-center justify-center">
                            <BookOpen size={18} className="text-muted-foreground" strokeWidth={2} />
                          </div>
                          <p className="text-sm text-muted-foreground">No opening data</p>
                          <p className="text-xs text-muted-foreground/70">Search a user from the home page to see their opening tree.</p>
                        </div>
                      ) : nextMoves.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-6 gap-2 text-center px-4">
                          <p className="text-sm text-muted-foreground">No games reach this position</p>
                          <p className="text-xs text-muted-foreground/70">Try going back or resetting the board.</p>
                        </div>
                      ) : (
                        <div className="max-h-[300px] overflow-y-auto no-scrollbar">
                          {nextMoves.map((move) => {
                            const total = move.count
                            const winPct = total > 0 ? Math.round((move.wins / total) * 100) : 0
                            const drawPct = total > 0 ? Math.round((move.draws / total) * 100) : 0
                            const lossPct = 100 - winPct - drawPct

                            return (
                              <button
                                key={move.san}
                                onClick={() => {
                                  if (viewIndex !== null) return
                                  const chess = chessRef.current
                                  const cg = cgRef.current
                                  if (!chess || !cg) return
                                  try {
                                    const result = chess.move(move.san)
                                    if (!result) return
                                    gameHistoryRef.current = [...gameHistoryRef.current, result]
                                    setMoveHistory(prev => [...prev, result.san])
                                    syncBoard()
                                    playSound(result.captured ? 'capture' : 'move')
                                  } catch { /* ignore invalid */ }
                                }}
                                className="flex items-center gap-3 w-full px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/50 transition-colors text-left group"
                              >
                                <span className="text-sm font-mono font-semibold text-foreground min-w-[48px]">
                                  {move.san}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex h-2 rounded-full overflow-hidden bg-muted/50">
                                    {winPct > 0 && (
                                      <div
                                        className="bg-emerald-500 transition-all duration-300"
                                        style={{ width: `${winPct}%` }}
                                      />
                                    )}
                                    {drawPct > 0 && (
                                      <div
                                        className="bg-muted-foreground/40 transition-all duration-300"
                                        style={{ width: `${drawPct}%` }}
                                      />
                                    )}
                                    {lossPct > 0 && (
                                      <div
                                        className="bg-red-500 transition-all duration-300"
                                        style={{ width: `${lossPct}%` }}
                                      />
                                    )}
                                  </div>
                                  <div className="flex items-center justify-between mt-1">
                                    <span className="text-[10px] text-muted-foreground">
                                      {total} game{total !== 1 ? 's' : ''}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      <span className="text-emerald-600 dark:text-emerald-400">{winPct}%</span>
                                      {' / '}
                                      <span>{drawPct}%</span>
                                      {' / '}
                                      <span className="text-red-600 dark:text-red-400">{lossPct}%</span>
                                    </span>
                                  </div>
                                </div>
                                <ArrowRight size={12} className="text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" strokeWidth={2} />
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* ── Notation tab ────────────────────────────────────── */}
                {mobileTab === 'notation' && (
                  <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
                    <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold text-foreground">Notation</CardTitle>
                        <span className="text-xs font-semibold text-foreground rounded-md border border-border bg-muted/50 px-2 py-0.5">
                          {stats.halfMoves}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      {moveHistory.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-4">
                          <div className="w-10 h-10 rounded-md bg-muted/50 border border-border flex items-center justify-center">
                            <Swords size={18} className="text-muted-foreground" strokeWidth={2} />
                          </div>
                          <p className="text-sm text-muted-foreground">No moves yet</p>
                          <p className="text-xs text-muted-foreground/70">Play a move to start recording.</p>
                        </div>
                      ) : (
                        <>
                          <div className="overflow-y-auto max-h-[300px]" style={{ WebkitOverflowScrolling: 'touch' }}>
                            <table className="w-full text-left">
                              <thead>
                                <tr className="border-b border-border bg-muted/30">
                                  <th className="h-8 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-12">#</th>
                                  <th className="h-8 px-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">White</th>
                                  <th className="h-8 px-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Black</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {movePairs.map((pair, i) => {
                                  const whiteIdx = i * 2
                                  const blackIdx = i * 2 + 1
                                  const activeIdx = viewIndex === null ? moveHistory.length - 1 : viewIndex
                                  const isActiveWhite = activeIdx === whiteIdx
                                  const isActiveBlack = activeIdx === blackIdx
                                  return (
                                    <tr key={pair.num} className="group hover:bg-muted/30 transition-colors">
                                      <td className="px-4 py-2 text-xs text-muted-foreground font-mono tabular-nums">{pair.num}.</td>
                                      <td
                                        className={`px-3 py-2 text-sm font-mono cursor-pointer select-none transition-colors ${
                                          isActiveWhite
                                            ? 'text-foreground font-semibold bg-accent/50'
                                            : 'text-foreground/80 hover:bg-muted/40'
                                        }`}
                                        onClick={() => goToMove(whiteIdx)}
                                      >
                                        {pair.white}
                                      </td>
                                      <td
                                        className={`px-3 py-2 text-sm font-mono transition-colors ${
                                          pair.black
                                            ? isActiveBlack
                                              ? 'text-foreground font-semibold bg-accent/50 cursor-pointer select-none'
                                              : 'text-foreground/80 hover:bg-muted/40 cursor-pointer select-none'
                                            : ''
                                        }`}
                                        onClick={pair.black ? () => goToMove(blackIdx) : undefined}
                                      >
                                        {pair.black || ''}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                          <div className="px-4 py-3 border-t border-border bg-muted/20">
                            <span className="text-xs text-muted-foreground">
                              {stats.halfMoves} half-move{stats.halfMoves !== 1 ? 's' : ''} &middot; Move {stats.moveNum}
                            </span>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* ── Eval tab ────────────────────────────────────────── */}
                {mobileTab === 'eval' && (
                  <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
                    <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Cpu size={14} className="text-muted-foreground" strokeWidth={2} />
                          <CardTitle className="text-sm font-semibold text-foreground">Cloud Eval</CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                          {engineOn && evalInfo && (
                            <span className="text-[10px] font-mono text-muted-foreground">
                              d{evalInfo.depth}
                            </span>
                          )}
                          <Button
                            variant={engineOn ? 'default' : 'outline'}
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={toggleEngine}
                            disabled={engineLoading}
                          >
                            {engineLoading ? 'Loading...' : engineOn ? 'On' : 'Off'}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      {!engineOn ? (
                        <div className="flex flex-col items-center justify-center py-6 gap-2 text-center px-4">
                          <div className="w-10 h-10 rounded-md bg-muted/50 border border-border flex items-center justify-center">
                            <Cpu size={18} className="text-muted-foreground" strokeWidth={2} />
                          </div>
                          <p className="text-sm text-muted-foreground">Cloud analysis off</p>
                          <p className="text-xs text-muted-foreground/70">Toggle to analyze the current position via Lichess cloud eval.</p>
                        </div>
                      ) : engineError ? (
                        <div className="flex flex-col items-center justify-center py-6 gap-2 text-center px-4">
                          <p className="text-sm text-red-500">{engineError}</p>
                          <p className="text-xs text-muted-foreground/70">Check your connection and try again.</p>
                        </div>
                      ) : engineLoading ? (
                        <div className="flex flex-col items-center justify-center py-6 gap-2 text-center px-4">
                          <Loader2 size={20} className="text-muted-foreground animate-spin" strokeWidth={2} />
                          <p className="text-sm text-muted-foreground">Fetching cloud eval...</p>
                        </div>
                      ) : cloudNotFound ? (
                        <div className="flex flex-col items-center justify-center py-6 gap-2 text-center px-4">
                          <div className="w-10 h-10 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                            <Cpu size={18} className="text-amber-600 dark:text-amber-400" strokeWidth={2} />
                          </div>
                          <p className="text-sm text-muted-foreground">Position not in database</p>
                          <p className="text-xs text-muted-foreground/70">This position hasn&apos;t been analyzed in the Lichess cloud yet.</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-border">
                          <div className="px-4 py-3">
                            <div className="flex items-baseline justify-between mb-1">
                              <span className="text-2xl font-semibold font-mono text-foreground tracking-tight">
                                {evalScore}
                              </span>
                              {evalInfo && (
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  depth {evalInfo.depth}{evalInfo.knodes ? ` \u00b7 ${Math.round(evalInfo.knodes / 1000)}M nodes` : ''}
                                </span>
                              )}
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-foreground rounded-full transition-all duration-300"
                                style={{ width: `${evalPercent}%` }}
                              />
                            </div>
                          </div>
                          {pvLinesSan.length > 0 && (
                            <div className="px-4 py-3 space-y-2.5">
                              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Principal variations</p>
                              {pvLinesSan.map((line, lineIdx) => (
                                <div key={lineIdx} className="space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded border ${
                                      lineIdx === 0
                                        ? 'bg-accent text-foreground border-border'
                                        : 'bg-muted/50 text-muted-foreground border-border/50'
                                    }`}>
                                      {formatScore(line.score)}
                                    </span>
                                    {lineIdx === 0 && (
                                      <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">best</span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-0.5">
                                    {line.sans.map((san, i) => (
                                      <span
                                        key={i}
                                        className={`text-xs font-mono px-1 py-0.5 rounded ${
                                          lineIdx === 0 && i === 0
                                            ? 'text-foreground font-semibold'
                                            : 'text-muted-foreground'
                                        }`}
                                      >
                                        {i % 2 === 0 && <span className="text-muted-foreground/50 mr-0.5">{Math.floor(i / 2) + Math.ceil((viewIndex === null ? moveHistory.length : viewIndex + 1) / 2) + 1}.</span>}
                                        {san}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* ── Settings tab ────────────────────────────────────── */}
                {mobileTab === 'settings' && (
                  <div className="space-y-3">
                    {/* Board Theme */}
                    <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
                      <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                        <CardTitle className="text-sm font-semibold text-foreground">Board Theme</CardTitle>
                      </CardHeader>
                      <CardContent className="p-2">
                        <div className="space-y-0.5">
                          {BOARD_THEMES.map((t) => (
                            <ThemeSwatch
                              key={t.id}
                              theme={t}
                              isActive={boardTheme === t.id}
                              onClick={() => changeBoardTheme(t.id)}
                            />
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Piece Theme */}
                    <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
                      <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                        <CardTitle className="text-sm font-semibold text-foreground">Piece Theme</CardTitle>
                      </CardHeader>
                      <CardContent className="p-2">
                        <div className="space-y-0.5">
                          {PIECE_THEMES.map((t) => (
                            <PieceSwatch
                              key={t.id}
                              theme={t}
                              isActive={pieceTheme === t.id}
                              onClick={() => changePieceTheme(t.id)}
                            />
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Sound */}
                    <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
                      <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                        <CardTitle className="text-sm font-semibold text-foreground">Sound</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setSoundVolume(prev => prev > 0 ? 0 : 0.7)}
                            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                            title={soundVolume > 0 ? 'Mute sounds' : 'Unmute sounds'}
                          >
                            {soundVolume > 0
                              ? <Volume2 size={16} strokeWidth={2} />
                              : <VolumeX size={16} strokeWidth={2} />}
                          </button>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={soundVolume}
                            onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
                            className="flex-1 h-1.5 accent-foreground cursor-pointer"
                            title={`Volume: ${Math.round(soundVolume * 100)}%`}
                          />
                          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right shrink-0">
                            {Math.round(soundVolume * 100)}%
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* ── Right sidebar (notation + resources) ─────────────────────────── */}
        <div className="hidden xl:flex flex-col w-[320px] shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto border-l border-border bg-background/50 backdrop-blur-sm">
          <div className="p-4 space-y-4">

            {/* Engine Analysis Card */}
            <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
              <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu size={14} className="text-muted-foreground" strokeWidth={2} />
                    <CardTitle className="text-sm font-semibold text-foreground">Cloud Eval</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    {engineOn && evalInfo && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        d{evalInfo.depth}
                      </span>
                    )}
                    <Button
                      variant={engineOn ? 'default' : 'outline'}
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={toggleEngine}
                      disabled={engineLoading}
                    >
                      {engineLoading ? 'Loading...' : engineOn ? 'On' : 'Off'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!engineOn ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2 text-center px-4">
                    <div className="w-10 h-10 rounded-md bg-muted/50 border border-border flex items-center justify-center">
                      <Cpu size={18} className="text-muted-foreground" strokeWidth={2} />
                    </div>
                    <p className="text-sm text-muted-foreground">Cloud analysis off</p>
                    <p className="text-xs text-muted-foreground/70">Toggle to analyze the current position via Lichess cloud eval.</p>
                  </div>
                ) : engineError ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2 text-center px-4">
                    <p className="text-sm text-red-500">{engineError}</p>
                    <p className="text-xs text-muted-foreground/70">Check your connection and try again.</p>
                  </div>
                ) : engineLoading ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2 text-center px-4">
                    <Loader2 size={20} className="text-muted-foreground animate-spin" strokeWidth={2} />
                    <p className="text-sm text-muted-foreground">Fetching cloud eval...</p>
                  </div>
                ) : cloudNotFound ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2 text-center px-4">
                    <div className="w-10 h-10 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                      <Cpu size={18} className="text-amber-600 dark:text-amber-400" strokeWidth={2} />
                    </div>
                    <p className="text-sm text-muted-foreground">Position not in database</p>
                    <p className="text-xs text-muted-foreground/70">This position hasn&apos;t been analyzed in the Lichess cloud yet.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {/* Eval score */}
                    <div className="px-4 py-3">
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-2xl font-semibold font-mono text-foreground tracking-tight">
                          {evalScore}
                        </span>
                        {evalInfo && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            depth {evalInfo.depth}{evalInfo.knodes ? ` \u00b7 ${Math.round(evalInfo.knodes / 1000)}M nodes` : ''}
                          </span>
                        )}
                      </div>
                      {/* Mini eval bar (horizontal) */}
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-foreground rounded-full transition-all duration-300"
                          style={{ width: `${evalPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* PV lines */}
                    {pvLinesSan.length > 0 && (
                      <div className="px-4 py-3 space-y-2.5">
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Principal variations</p>
                        {pvLinesSan.map((line, lineIdx) => (
                          <div key={lineIdx} className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded border ${
                                lineIdx === 0
                                  ? 'bg-accent text-foreground border-border'
                                  : 'bg-muted/50 text-muted-foreground border-border/50'
                              }`}>
                                {formatScore(line.score)}
                              </span>
                              {lineIdx === 0 && (
                                <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">best</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-0.5">
                              {line.sans.map((san, i) => (
                                <span
                                  key={i}
                                  className={`text-xs font-mono px-1 py-0.5 rounded ${
                                    lineIdx === 0 && i === 0
                                      ? 'text-foreground font-semibold'
                                      : 'text-muted-foreground'
                                  }`}
                                >
                                  {i % 2 === 0 && <span className="text-muted-foreground/50 mr-0.5">{Math.floor(i / 2) + Math.ceil((viewIndex === null ? moveHistory.length : viewIndex + 1) / 2) + 1}.</span>}
                                  {san}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Notation Card */}
            <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
              <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-foreground">Notation</CardTitle>
                  <span className="text-xs font-semibold text-foreground rounded-md border border-border bg-muted/50 px-2 py-0.5">
                    {stats.halfMoves}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {moveHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-4">
                    <div className="w-10 h-10 rounded-md bg-muted/50 border border-border flex items-center justify-center">
                      <Swords size={18} className="text-muted-foreground" strokeWidth={2} />
                    </div>
                    <p className="text-sm text-muted-foreground">No moves yet</p>
                    <p className="text-xs text-muted-foreground/70">Play a move to start recording.</p>
                  </div>
                ) : (
                  <>
                    <div ref={historyRef} className="overflow-y-auto max-h-[340px]" style={{ WebkitOverflowScrolling: 'touch' }}>
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-border bg-muted/30">
                            <th className="h-8 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-12">#</th>
                            <th className="h-8 px-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">White</th>
                            <th className="h-8 px-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Black</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {movePairs.map((pair, i) => {
                            const whiteIdx = i * 2
                            const blackIdx = i * 2 + 1
                            // Determine which move is "active" (currently viewed)
                            const activeIdx = viewIndex === null ? moveHistory.length - 1 : viewIndex
                            const isActiveWhite = activeIdx === whiteIdx
                            const isActiveBlack = activeIdx === blackIdx
                            return (
                              <tr key={pair.num} className="group hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-2 text-xs text-muted-foreground font-mono tabular-nums">{pair.num}.</td>
                                <td
                                  className={`px-3 py-2 text-sm font-mono cursor-pointer select-none transition-colors ${
                                    isActiveWhite
                                      ? 'text-foreground font-semibold bg-accent/50'
                                      : 'text-foreground/80 hover:bg-muted/40'
                                  }`}
                                  onClick={() => goToMove(whiteIdx)}
                                >
                                  {pair.white}
                                </td>
                                <td
                                  className={`px-3 py-2 text-sm font-mono transition-colors ${
                                    pair.black
                                      ? isActiveBlack
                                        ? 'text-foreground font-semibold bg-accent/50 cursor-pointer select-none'
                                        : 'text-foreground/80 hover:bg-muted/40 cursor-pointer select-none'
                                      : ''
                                  }`}
                                  onClick={pair.black ? () => goToMove(blackIdx) : undefined}
                                >
                                  {pair.black || ''}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-4 py-3 border-t border-border bg-muted/20">
                      <span className="text-xs text-muted-foreground">
                        {stats.halfMoves} half-move{stats.halfMoves !== 1 ? 's' : ''} &middot; Move {stats.moveNum}
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Opening Tree Card */}
            <Card className="rounded-lg border border-border bg-card/50 shadow-sm">
              <CardHeader className="px-4 py-3 border-b border-border space-y-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen size={14} className="text-muted-foreground" strokeWidth={2} />
                    <CardTitle className="text-sm font-semibold text-foreground">Opening Tree</CardTitle>
                  </div>
                  {positionGames > 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {positionGames} game{positionGames !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {gamesLoading && !openingTree ? (
                  <OpeningTreeSkeleton />
                ) : !openingTree ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-4">
                    <div className="w-10 h-10 rounded-md bg-muted/50 border border-border flex items-center justify-center">
                      <BookOpen size={18} className="text-muted-foreground" strokeWidth={2} />
                    </div>
                    <p className="text-sm text-muted-foreground">No opening data</p>
                    <p className="text-xs text-muted-foreground/70">Search a user from the home page to see their opening tree.</p>
                  </div>
                ) : nextMoves.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2 text-center px-4">
                    <p className="text-sm text-muted-foreground">No games reach this position</p>
                    <p className="text-xs text-muted-foreground/70">Try going back or resetting the board.</p>
                  </div>
                ) : (
                  <div className="max-h-[340px] overflow-y-auto no-scrollbar">
                    {nextMoves.map((move) => {
                      const total = move.count
                      const winPct = total > 0 ? Math.round((move.wins / total) * 100) : 0
                      const drawPct = total > 0 ? Math.round((move.draws / total) * 100) : 0
                      const lossPct = 100 - winPct - drawPct

                      return (
                        <button
                          key={move.san}
                          onClick={() => {
                            // Play this move on the board
                            if (viewIndex !== null) return // can't play while viewing history
                            const chess = chessRef.current
                            const cg = cgRef.current
                            if (!chess || !cg) return
                            try {
                              const result = chess.move(move.san)
                              if (!result) return
                              gameHistoryRef.current = [...gameHistoryRef.current, result]
                              setMoveHistory(prev => [...prev, result.san])
                              syncBoard()
                              playSound(result.captured ? 'capture' : 'move')
                            } catch { /* ignore invalid */ }
                          }}
                          className="flex items-center gap-3 w-full px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/50 transition-colors text-left group"
                        >
                          {/* Move SAN */}
                          <span className="text-sm font-mono font-semibold text-foreground min-w-[48px]">
                            {move.san}
                          </span>

                          {/* Win/Draw/Loss bar */}
                          <div className="flex-1 min-w-0">
                            <div className="flex h-2 rounded-full overflow-hidden bg-muted/50">
                              {winPct > 0 && (
                                <div
                                  className="bg-emerald-500 transition-all duration-300"
                                  style={{ width: `${winPct}%` }}
                                />
                              )}
                              {drawPct > 0 && (
                                <div
                                  className="bg-muted-foreground/40 transition-all duration-300"
                                  style={{ width: `${drawPct}%` }}
                                />
                              )}
                              {lossPct > 0 && (
                                <div
                                  className="bg-red-500 transition-all duration-300"
                                  style={{ width: `${lossPct}%` }}
                                />
                              )}
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-[10px] text-muted-foreground">
                                {total} game{total !== 1 ? 's' : ''}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                <span className="text-emerald-600 dark:text-emerald-400">{winPct}%</span>
                                {' / '}
                                <span>{drawPct}%</span>
                                {' / '}
                                <span className="text-red-600 dark:text-red-400">{lossPct}%</span>
                              </span>
                            </div>
                          </div>

                          {/* Arrow hint */}
                          <ArrowRight size={12} className="text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" strokeWidth={2} />
                        </button>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>

      {/* ── Fetching games modal ───────────────────────────────────────── */}
      {gamesLoading && queryUser && (() => {
        const loaded = userGames?.length || 0
        const total = queryMax === 'all' ? null : queryMax ? parseInt(queryMax, 10) : 50
        const pct = total ? Math.min(Math.round((loaded / total) * 100), 100) : null
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="max-w-[340px] w-full mx-4 rounded-xl border border-border bg-card p-6 shadow-lg">
              {/* Header */}
              <div className="flex items-center gap-3 mb-5">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-foreground/5">
                  <Loader2 size={20} className="animate-spin text-foreground" strokeWidth={2} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Fetching Games</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Streaming games for <span className="font-medium text-foreground">{queryUser}</span>
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 rounded-full bg-muted overflow-hidden mb-3">
                {pct !== null ? (
                  <div
                    className="h-full bg-foreground/70 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                ) : (
                  <div
                    className="h-full bg-foreground/70 rounded-full animate-[loading_1.5s_ease-in-out_infinite]"
                    style={{ width: '40%' }}
                  />
                )}
              </div>

              {/* Count label */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  <span className="font-mono font-medium text-foreground">{loaded}</span>
                  {total
                    ? <> / <span className="font-mono">{total}</span> games</>
                    : <> games loaded</>
                  }
                </span>
                {pct !== null && (
                  <span className="font-mono">{pct}%</span>
                )}
              </div>
            </div>
          </div>
        )
      })()}


    </div>
  )
}

export default Dashboard
