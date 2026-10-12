/* eslint-disable react/prop-types */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chessground } from 'chessgroundx'
import { Chess } from 'chess.js'
import {
  Crown, Search, ChevronRight, Zap, Timer, Gauge, Clock,
  Infinity as InfinityIcon, BookOpen, BarChart3, Cpu, TrendingUp,
  History, X, ArrowRight, Users, ExternalLink, Github,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import 'chessgroundx/assets/chessground.base.css'
import 'chessgroundx/assets/chessground.brown.css'
import 'chessgroundx/assets/chessground.cburnett.css'

// ─── Dot pattern background ─────────────────────────────────────────────────────
const DotPattern = () => (
  <div
    className="pointer-events-none absolute inset-0 z-0 opacity-[0.4]"
    style={{
      backgroundImage: `radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground) / 0.15) 1px, transparent 0)`,
      backgroundSize: '24px 24px',
    }}
  />
)

// ─── Color option button ────────────────────────────────────────────────────────
const ColorOption = ({ value, label, icon, selected, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(value)}
    className={`flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
      selected
        ? 'border-foreground bg-foreground text-background shadow-sm'
        : 'border-border bg-card/50 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground'
    }`}
  >
    {icon}
    {label}
  </button>
)

// ─── Feature highlight card ─────────────────────────────────────────────────────
const FeatureCard = ({ icon: Icon, title, description }) => (
  <Card className="border-border bg-card/50 backdrop-blur-sm">
    <CardContent className="p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-md bg-muted/50 border border-border flex items-center justify-center shrink-0">
        <Icon size={16} className="text-muted-foreground" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
    </CardContent>
  </Card>
)

// ─── Time control definitions ───────────────────────────────────────────────────
const TIME_CONTROLS = [
  { id: 'ultraBullet', label: 'UltraBullet', icon: Zap },
  { id: 'bullet', label: 'Bullet', icon: Zap },
  { id: 'blitz', label: 'Blitz', icon: Timer },
  { id: 'rapid', label: 'Rapid', icon: Gauge },
  { id: 'classical', label: 'Classical', icon: Clock },
  { id: 'correspondence', label: 'Corresp.', icon: Clock },
]

// ─── Game count presets ─────────────────────────────────────────────────────────
const GAME_COUNTS = [
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 200, label: '200' },
  { value: null, label: 'All' },
]

// ─── Popular players ────────────────────────────────────────────────────────────
const POPULAR_PLAYERS = [
  { name: 'DrNykterstein', title: 'GM', sub: 'Magnus Carlsen' },
  { name: 'nihalsarin', title: 'GM', sub: 'Nihal Sarin' },
  { name: 'Msb2', title: 'GM', sub: 'Maia Chiburdanidze' },
  { name: 'DrDrunkenstein', title: 'GM', sub: 'Magnus (bullet)' },
  { name: 'penguingm1', title: 'GM', sub: 'Andrew Tang' },
  { name: 'Zhigalko_Sergei', title: 'GM', sub: 'Sergei Zhigalko' },
]

// ─── Recent searches persistence ────────────────────────────────────────────────
const RECENT_KEY = 'lichess-prep-recent'
const MAX_RECENT = 6

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function saveRecent(entry) {
  try {
    const existing = loadRecent()
    // Remove duplicate if exists
    const filtered = existing.filter(
      e => !(e.user === entry.user && e.color === entry.color)
    )
    const updated = [entry, ...filtered].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated))
    return updated
  } catch { /* ignore */ }
  return [entry]
}

function removeRecent(user, color) {
  try {
    const existing = loadRecent()
    const filtered = existing.filter(
      e => !(e.user === user && e.color === color)
    )
    localStorage.setItem(RECENT_KEY, JSON.stringify(filtered))
    return filtered
  } catch { /* ignore */ }
  return []
}

// ─── Apply color mode from localStorage on mount ────────────────────────────────
function applyStoredColorMode() {
  try {
    const raw = localStorage.getItem('chess-preferences')
    if (raw) {
      const prefs = JSON.parse(raw)
      if (prefs.colorMode === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      return
    }
  } catch { /* ignore */ }
  // Default to dark
  document.documentElement.classList.add('dark')
}

// ─── Home page component ────────────────────────────────────────────────────────
function Home() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [color, setColor] = useState('white')
  const [speeds, setSpeeds] = useState([]) // empty = all speeds
  const [gameCount, setGameCount] = useState(50)
  const [error, setError] = useState('')
  const [recentSearches, setRecentSearches] = useState([])
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Animated board refs
  const boardRef = useRef(null)
  const cgRef = useRef(null)
  const chessRef = useRef(null)
  const timerRef = useRef(null)
  const inputRef = useRef(null)

  // Apply stored color mode and load recent searches
  useEffect(() => {
    applyStoredColorMode()
    setRecentSearches(loadRecent())
  }, [])

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 300)
    return () => clearTimeout(timer)
  }, [])

  // ─── Animated board: play random moves ──────────────────────────────────
  const playRandomMove = useCallback(() => {
    const chess = chessRef.current
    const cg = cgRef.current
    if (!chess || !cg) return

    const moves = chess.moves({ verbose: true })
    if (moves.length === 0 || chess.isGameOver()) {
      chess.reset()
      cg.set({
        fen: chess.fen(),
        lastMove: undefined,
        turnColor: 'white',
        check: false,
      })
      return
    }

    const move = moves[Math.floor(Math.random() * moves.length)]
    chess.move(move)

    cg.set({
      fen: chess.fen(),
      lastMove: [move.from, move.to],
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      check: chess.inCheck(),
    })
  }, [])

  useEffect(() => {
    if (!boardRef.current) return

    const chess = new Chess()
    chessRef.current = chess

    const cg = Chessground(boardRef.current, {
      fen: chess.fen(),
      viewOnly: true,
      coordinates: false,
      animation: { enabled: true, duration: 300 },
      drawable: { enabled: false },
    })
    cgRef.current = cg

    timerRef.current = setInterval(playRandomMove, 1200)

    return () => {
      clearInterval(timerRef.current)
      cg.destroy()
    }
  }, [playRandomMove])

  // ─── Toggle a time control on/off ────────────────────────────────────────
  const toggleSpeed = useCallback((id) => {
    setSpeeds(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
  }, [])

  // ─── Navigate to dashboard ─────────────────────────────────────────────
  const goToDashboard = useCallback((user, clr, spds, count) => {
    const params = new URLSearchParams({ user })
    if (clr !== 'both') params.set('color', clr)
    if (spds && spds.length > 0) params.set('speeds', spds.join(','))
    if (count !== 50) params.set('max', count === null ? 'all' : String(count))
    navigate(`/dashboard?${params}`)
  }, [navigate])

  // ─── Form submission ────────────────────────────────────────────────────
  const handleSubmit = useCallback((e) => {
    e.preventDefault()
    const trimmed = username.trim()
    if (!trimmed) {
      setError('Please enter a Lichess username')
      return
    }
    if (!/^[a-zA-Z0-9_-]{2,20}$/.test(trimmed)) {
      setError('Invalid username (2-20 chars, letters/numbers/dash/underscore)')
      return
    }
    setError('')

    // Save to recent searches
    const entry = { user: trimmed, color, speeds, gameCount, ts: Date.now() }
    setRecentSearches(saveRecent(entry))

    goToDashboard(trimmed, color, speeds, gameCount)
  }, [username, color, speeds, gameCount, goToDashboard])

  // ─── Quick-launch a popular player ──────────────────────────────────────
  const launchPlayer = useCallback((name) => {
    const entry = { user: name, color, speeds, gameCount, ts: Date.now() }
    setRecentSearches(saveRecent(entry))
    goToDashboard(name, color, speeds, gameCount)
  }, [color, speeds, gameCount, goToDashboard])

  // ─── Quick-launch a recent search ──────────────────────────────────────
  const launchRecent = useCallback((entry) => {
    goToDashboard(entry.user, entry.color || 'both', entry.speeds || [], entry.gameCount ?? 50)
  }, [goToDashboard])

  // ─── Remove a recent search ────────────────────────────────────────────
  const deleteRecent = useCallback((user, clr) => {
    setRecentSearches(removeRecent(user, clr))
  }, [])

  // Has any custom settings beyond defaults
  const hasAdvancedSettings = useMemo(() => {
    return speeds.length > 0 || gameCount !== 50
  }, [speeds, gameCount])

  return (
    <div className="relative flex flex-col min-h-screen bg-background">
      <DotPattern />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex h-14 min-h-[52px] items-center justify-between border-b border-border bg-background/80 backdrop-blur-md px-4 md:px-6 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-muted/50 border border-border flex items-center justify-center">
            <Crown size={16} className="text-foreground" strokeWidth={2} />
          </div>
          <span className="text-base font-semibold text-foreground tracking-tight">RepertoireLab</span>
        </div>
        <a
          href="https://github.com/lichess-org/chessground"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Github size={14} strokeWidth={2} />
          <span className="hidden sm:inline">Source</span>
        </a>
      </header>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="relative z-10 flex flex-1 flex-col items-center px-4 py-8 md:py-16">
        <div className="w-full max-w-4xl">

          {/* ── Hero: two-column on lg, stacked on mobile ──────────────── */}
          <div className="flex flex-col lg:flex-row items-center gap-10 lg:gap-16">

            {/* Left column — heading + form */}
            <div className="flex-1 w-full max-w-md lg:max-w-none">
              {/* Heading */}
              <div className="space-y-3 mb-8">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/50 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  Free &middot; Open Source &middot; No sign-up required
                </div>
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground tracking-tight leading-[1.1]">
                  Master your{' '}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-emerald-600 dark:from-emerald-400 dark:to-emerald-500">
                    openings
                  </span>
                </h1>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-md">
                  Analyze your Lichess games and explore your complete opening repertoire with interactive trees, cloud eval, and detailed statistics.
                </p>
              </div>

              {/* ── Search form ────────────────────────────────────────── */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Username input */}
                <div className="space-y-1.5">
                  <label htmlFor="username" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Lichess Username
                  </label>
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" strokeWidth={2} />
                    <input
                      ref={inputRef}
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value)
                        if (error) setError('')
                      }}
                      placeholder="e.g. DrNykterstein"
                      autoComplete="off"
                      spellCheck="false"
                      className={`w-full h-11 rounded-md border bg-card/50 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-foreground/50 focus:ring-1 focus:ring-foreground/20 ${
                        error ? 'border-destructive' : 'border-border'
                      }`}
                    />
                  </div>
                  {error && (
                    <p className="text-xs text-destructive">{error}</p>
                  )}
                </div>

                {/* Color selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Color
                  </label>
                  <div className="flex gap-2">
                    <ColorOption
                      value="white"
                      label="White"
                      icon={<span className="w-4 h-4 rounded-full bg-white border border-border/50 shrink-0" />}
                      selected={color === 'white'}
                      onClick={setColor}
                    />
                    <ColorOption
                      value="black"
                      label="Black"
                      icon={<span className="w-4 h-4 rounded-full bg-neutral-800 border border-border/50 shrink-0" />}
                      selected={color === 'black'}
                      onClick={setColor}
                    />
                    <ColorOption
                      value="both"
                      label="Both"
                      icon={
                        <span className="flex w-4 h-4 rounded-full overflow-hidden border border-border/50 shrink-0">
                          <span className="w-2 h-4 bg-white" />
                          <span className="w-2 h-4 bg-neutral-800" />
                        </span>
                      }
                      selected={color === 'both'}
                      onClick={setColor}
                    />
                  </div>
                </div>

                {/* Advanced settings toggle */}
                <button
                  type="button"
                  onClick={() => setShowAdvanced(prev => !prev)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight
                    size={12}
                    strokeWidth={2}
                    className={`transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''}`}
                  />
                  Advanced options
                  {hasAdvancedSettings && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  )}
                </button>

                {/* Advanced settings (collapsible) */}
                {showAdvanced && (
                  <div className="space-y-4 pl-0 border-l-0">
                    {/* Time control tags */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Time Controls
                      </label>
                      <p className="text-[11px] text-muted-foreground/70">
                        {speeds.length === 0 ? 'All time controls selected' : `${speeds.length} selected`}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {TIME_CONTROLS.map(({ id, label, icon: Icon }) => {
                          const active = speeds.includes(id)
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => toggleSpeed(id)}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                                active
                                  ? 'border-foreground bg-foreground text-background'
                                  : 'border-border bg-card/50 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground'
                              }`}
                            >
                              <Icon size={12} strokeWidth={2} />
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Game count selector */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Number of Games
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {GAME_COUNTS.map(({ value, label }) => {
                          const active = gameCount === value
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() => setGameCount(value)}
                              className={`flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-all duration-150 ${
                                active
                                  ? 'border-foreground bg-foreground text-background'
                                  : 'border-border bg-card/50 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground'
                              }`}
                            >
                              {value === null && <InfinityIcon size={12} strokeWidth={2} />}
                              {label}
                            </button>
                          )
                        })}
                      </div>
                      {gameCount === null && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          Fetching all games may take a while for active players.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Submit button */}
                <Button type="submit" className="w-full h-11 text-sm font-semibold gap-2">
                  Analyze Games
                  <ArrowRight size={16} strokeWidth={2.5} />
                </Button>
              </form>

              {/* ── Popular players ────────────────────────────────────── */}
              <div className="mt-6 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Users size={12} className="text-muted-foreground" strokeWidth={2} />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Try a top player</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {POPULAR_PLAYERS.map(({ name, title, sub }) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => launchPlayer(name)}
                      className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-card/50 px-2.5 py-1.5 text-xs transition-all duration-150 hover:border-muted-foreground/50 hover:bg-muted/50"
                      title={sub}
                    >
                      <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">{title}</span>
                      <span className="font-medium text-foreground">{name}</span>
                      <ArrowRight size={10} className="text-muted-foreground/50 group-hover:text-foreground transition-colors" strokeWidth={2} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right column — animated board */}
            <div className="flex flex-col items-center gap-4 shrink-0">
              <div className="relative">
                {/* Glow effect */}
                <div className="absolute -inset-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-transparent to-emerald-500/5 blur-2xl" />
                <div className="absolute -inset-3 rounded-xl bg-gradient-to-b from-muted/30 to-transparent blur-xl" />
                <div
                  ref={boardRef}
                  className="relative rounded-lg overflow-hidden border border-border shadow-2xl"
                  style={{ width: 280, height: 280 }}
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500/60 animate-pulse" />
                <span>Live random game</span>
              </div>
            </div>
          </div>

          {/* ── Recent searches ─────────────────────────────────────────── */}
          {recentSearches.length > 0 && (
            <div className="mt-12 space-y-3">
              <div className="flex items-center gap-2">
                <History size={14} className="text-muted-foreground" strokeWidth={2} />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((entry) => (
                  <div
                    key={`${entry.user}-${entry.color}`}
                    className="group inline-flex items-center gap-2 rounded-md border border-border bg-card/50 pl-3 pr-1 py-1.5 transition-all duration-150 hover:border-muted-foreground/50"
                  >
                    <button
                      type="button"
                      onClick={() => launchRecent(entry)}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="font-medium text-foreground">{entry.user}</span>
                      {entry.color && entry.color !== 'both' && (
                        <span className="text-[10px] text-muted-foreground">({entry.color})</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteRecent(entry.user, entry.color)
                      }}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground/50 hover:text-foreground transition-colors"
                      title="Remove"
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Feature highlights ──────────────────────────────────────── */}
          <div className="mt-12 lg:mt-16 space-y-4">
            <div className="text-center space-y-1">
              <h2 className="text-lg font-semibold text-foreground tracking-tight">
                Everything you need to study openings
              </h2>
              <p className="text-sm text-muted-foreground">
                All powered by the Lichess API — no engine downloads required.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FeatureCard
                icon={BookOpen}
                title="Interactive Opening Tree"
                description="Navigate your most-played moves as an interactive trie with win/draw/loss statistics at every position."
              />
              <FeatureCard
                icon={Cpu}
                title="Cloud Engine Evaluation"
                description="Instant position analysis from Lichess's 320M+ position cloud eval database. No local engine needed."
              />
              <FeatureCard
                icon={BarChart3}
                title="Game Statistics"
                description="Win rate, average opponent rating, and detailed performance breakdown across your games."
              />
              <FeatureCard
                icon={TrendingUp}
                title="Live Streaming"
                description="Games stream in real-time — watch the opening tree build as each game is fetched from Lichess."
              />
            </div>
          </div>

        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-border bg-background/50 backdrop-blur-sm px-4 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 max-w-4xl mx-auto">
          <p className="text-[11px] text-muted-foreground/60 text-center sm:text-left">
            Built with{' '}
            <a href="https://github.com/lichess-org/chessground" target="_blank" rel="noopener noreferrer" className="text-foreground/60 hover:text-foreground hover:underline">
              chessground
            </a>
            {' '}&middot; Data from{' '}
            <a href="https://lichess.org/api" target="_blank" rel="noopener noreferrer" className="text-foreground/60 hover:text-foreground hover:underline">
              Lichess API
            </a>
          </p>
          <div className="flex items-center gap-3">
            <a
              href="https://lichess.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              lichess.org
              <ExternalLink size={10} strokeWidth={2} />
            </a>
            <span className="text-muted-foreground/30">|</span>
            <span className="text-[10px] text-muted-foreground/40 font-mono">v1.0</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default Home
