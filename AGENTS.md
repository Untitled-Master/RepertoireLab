# AGENTS.md

## Project Overview

React 19 single-page chess application built on Lichess Chessground (board rendering) and chess.js (game logic). Uses Vite 6 as the build tool, Tailwind CSS 3.4 for styling, and Shadcn UI (new-york style) for reusable components. Uses react-router-dom for client-side routing. Written in JavaScript (JSX) -- no TypeScript.

## Build / Lint / Test Commands

| Command           | Description                                      |
|-------------------|--------------------------------------------------|
| `npm run dev`     | Start Vite dev server (port 5173)                |
| `npm run build`   | Production build to `dist/`                      |
| `npm run lint`    | Run ESLint across the project (`eslint .`)       |
| `npm run preview` | Preview production build locally                 |

**No test framework is configured.** There is no `vitest`, `jest`, or any test runner. No test files exist. If you add tests, use Vitest (already compatible with Vite) and place test files next to source files with the `.test.jsx` extension. A single test can then be run with:

```sh
npx vitest run src/App.test.jsx
```

### Linting

ESLint 9 flat config (`eslint.config.js`) with these plugins:
- `eslint-plugin-react` (recommended + jsx-runtime rules)
- `eslint-plugin-react-hooks` (Rules of Hooks enforcement)
- `eslint-plugin-react-refresh` (Vite HMR component export rules)

The `dist/` directory is ignored. Files matched: `**/*.{js,jsx}`.

## Code Style Guidelines

### Formatting

- **Indentation:** 2 spaces (no tabs).
- **Semicolons:** Omit semicolons in hand-written code. Shadcn/ui generated files may have semicolons -- match the surrounding code.
- **String quotes:** Single quotes in hand-written code (`'react'`, `'chess.js'`). Double quotes appear in shadcn/ui generated files -- match the surrounding code.
- **Trailing commas:** Used in multi-line arrays, objects, and function parameters.
- **Line length:** No enforced limit; keep lines readable. Long JSX attribute lists should break one-per-line.
- **No Prettier configured.** Follow existing conventions by file.

### Imports

Imports are ordered in groups (no blank lines between groups in App.jsx):

1. React hooks/core (`import { useState, useEffect, ... } from 'react'`)
2. Third-party libraries (`chessground`, `chess.js`, `lucide-react`, etc.)
3. Internal components (`@/components/ui/...`)
4. CSS files (`chessground/assets/...`, `./index.css`)

Shadcn/ui components always start with `import * as React from "react"`, then third-party, then `import { cn } from "@/lib/utils"`.

Use the `@/` path alias for imports from `src/` (configured in `vite.config.js` and `jsconfig.json`).

### Naming Conventions

| Element              | Convention         | Example                                |
|----------------------|--------------------|----------------------------------------|
| Components           | PascalCase         | `KpiCard`, `StatusBadge`, `ThemeSwatch`|
| Functions            | camelCase          | `loadPrefs`, `syncBoard`, `playSound`  |
| Variables / state    | camelCase          | `moveHistory`, `boardSize`, `cgRef`    |
| State setters        | `set` + PascalCase | `setOrientation`, `setColorMode`       |
| Module constants     | UPPER_SNAKE_CASE   | `PREFS_KEY`, `BOARD_THEMES`, `PIECE_MAP`|
| CSS classes (custom)  | kebab-case         | `board-theme-blue`, `board-resize-handle`|
| CSS custom properties | `--kebab-case`     | `--background`, `--muted-foreground`   |

### Component Definitions

- **Main/large components:** `function` declaration (`function App() { ... }`).
- **Small presentational components:** `const` + arrow function (`const KpiCard = ({ ... }) => ( ... )`).
- **Shadcn/ui primitives:** `const` + `React.forwardRef` + arrow function, with `.displayName` set.
- **Inline handlers inside components:** `const` + arrow function without `useCallback` (when not used as deps).
- **Event handlers passed as deps or to children:** Wrap in `useCallback` with explicit dependency arrays.

### Exports

- The main `App` component uses `export default App` at bottom of file.
- UI components use grouped named exports: `export { Button, buttonVariants }`.
- Utility functions use inline named exports: `export function cn(...inputs) { ... }`.

### Props

- Destructure props inline in the parameter list, never in the function body.
- Use `...props` spread as the last destructured item for forwarding to DOM elements.
- Provide default values in destructuring: `{ position = "popper", ...props }`.
- Rename props via alias when needed: `{ icon: Icon }` (lowercase prop, PascalCase alias for JSX use).

### React Patterns

- **State management:** `useState` + `useRef` only. No external state libraries.
- **Refs for imperative libraries:** Store chess.js and Chessground instances in `useRef`, not state. Update imperatively via `.set()`.
- **Functional state updates:** Always use the updater form when new state depends on previous: `setState(prev => ...)`.
- **useMemo:** For derived/computed values (`stats`, `movePairs`, `computedBoardSize`).
- **useCallback:** For all handlers used as effect dependencies or passed to children.
- **useEffect:** Always include explicit dependency arrays. Use `// eslint-disable-line react-hooks/exhaustive-deps` only for intentional mount-only effects (imperative library init). Always return cleanup functions for event listeners and timers.

### Error Handling

- **Non-critical paths** (localStorage, audio): Silent `try { ... } catch { /* ignore */ }`. Use parameterless `catch` (no `(e)`). Add a brief comment explaining why.
- **Promise rejections** (fire-and-forget): `.catch(() => {})`.
- **Critical paths** (chess moves): `try/catch` that triggers recovery (e.g., `syncBoard()`) and returns boolean success/failure.
- **Guard clauses:** Early `return` at the top of functions when refs/state are not ready: `if (!cg) return`.

### Styling

- **Tailwind-first:** Use Tailwind utility classes for all styling. Avoid custom CSS unless necessary for SVG backgrounds, board themes, or animations.
- **Class merging:** In reusable components, use `cn()` from `@/lib/utils` (wraps `clsx` + `tailwind-merge`). In App.jsx, template literal concatenation is used directly.
- **Dark mode:** Class strategy (`darkMode: ["class"]`). Toggle `.dark` on `document.documentElement`.
- **CSS variables:** HSL values without the `hsl()` wrapper, consumed via `hsl(var(--variable))` in Tailwind config.
- **Theming:** Board piece themes are dynamically injected via `<style>` elements, not React state.

### JSX Conventions

- Self-close elements without children: `<DotPattern />`.
- Conditional rendering: `&&` for presence/absence, ternary for either/or.
- Array rendering: `.map()` with arrow functions; always provide unique `key` props.
- Wrap multi-line JSX returns in parentheses.
- Section comments use `{/* --- Section name --- */}` format.

## Project Structure

```
src/
  main.jsx              # React root mount (StrictMode)
  App.jsx               # Router shell (BrowserRouter + Routes)
  App.css               # Unused (empty)
  index.css             # Global styles, CSS variables, board themes, eval bar
  pages/
    Home.jsx            # Landing page — animated board, username search, color selector
    Dashboard.jsx       # Full chess board app (~2000 lines) — board, sidebar, engine, notation, opening tree
  lib/
    utils.js            # cn() utility (clsx + tailwind-merge)
    stockfish.js        # Lichess Cloud Eval API client (fetch, parsing, display helpers)
    lichess.js          # Lichess API client — fetchUserGames (NDJSON)
  components/
    ui/
      button.jsx        # Shadcn Button (cva variants)
      card.jsx          # Shadcn Card components
      select.jsx        # Shadcn Select (wraps Radix)
```

## Routing

Uses `react-router-dom` with `BrowserRouter`. Routes defined in `App.jsx`:

| Path         | Component    | Description                                                  |
|--------------|-------------|--------------------------------------------------------------|
| `/`          | `Home`      | Landing page — animated board, username input, color picker  |
| `/dashboard` | `Dashboard` | Chess board app — reads `?user=X&color=Y` query params       |

**SPA fallback:** `vercel.json` rewrites all non-file paths to `/index.html` (status 200).

**Navigation flow:** Home page form submits to `/dashboard?user={username}&color={color}`. Dashboard reads params via `useSearchParams`, fetches user games from Lichess API on mount, and displays a loading/error/success banner below the header.

## Key Architecture Notes

- `App.jsx` is a thin router shell (~16 lines). All chess board logic lives in `Dashboard.jsx`.
- Sub-components (`KpiCard`, `StatusBadge`, `ThemeSwatch`, `PieceSwatch`, `DotPattern`, `EvalBar`) are defined in `Dashboard.jsx`.
- `Home.jsx` has its own `DotPattern` and `ColorOption` components, plus an animated Chessground board that plays random moves.
- Chess.js handles all game logic; Chessground handles all board rendering. They communicate through an imperative sync pattern, not React props.
- User preferences (color mode, board/piece theme, board size, sound volume) are persisted to localStorage.
- Deployment target is Vercel (see `vercel.json`).
- Audio is fire-and-forget (`new Audio(url).play()`), loaded from chess.com CDN. Volume is user-configurable (0-100%) and persisted to localStorage.
- Piece images loaded from Lichess CDN (`lichess1.org/assets/piece/`).

## Engine Analysis

Cloud evaluation is in `src/lib/stockfish.js`. Uses the **Lichess Cloud Eval API** (`GET https://lichess.org/api/cloud-eval`) to fetch cached Stockfish evaluations (~320 million positions). Key points:

- **Toggle:** Engine is off by default. Users enable it via the toolbar "Engine" button or the right sidebar "Cloud Eval" card.
- **API client:** `fetchCloudEval(fen, { multiPv, variant, signal })` fetches evaluation from Lichess. Returns `null` for positions not in database (HTTP 404). Uses `AbortController` for cancellation.
- **Response parsing:** `parseCloudEval(data)` normalizes the API response into `{ depth, knodes, score: { type, value }, pvs: [{ moves, score }] }`.
- **Score convention:** Cloud eval scores (`cp`/`mate`) are always from **white's perspective** — no turn-based flip is needed. This differs from local Stockfish which reports from side-to-move.
- **Display helpers:** `formatScore(score)` formats centipawn/mate scores. `evalToWhitePercent(score)` maps eval to a 0-100 bar percentage using sigmoid scaling. Neither takes a `turn` parameter.
- **Eval bar:** The `EvalBar` component renders a vertical white/black bar next to the board. Height is driven by `evalToWhitePercent`. Bar flips when `orientation` is black.
- **Best move arrow:** Drawn on the board via Chessground's `drawable.autoShapes` with the `paleBlue` brush. Uses the first move of the top PV line. Cleared when engine is off.
- **Multiple PV lines:** Requests `multiPv=3` by default. All PV lines are displayed in the sidebar with their individual scores. UCI moves are converted to SAN via disposable `Chess` clones.
- **Not in database:** When a position has no cloud eval (404), a friendly "Position not in database" message is shown instead of an error.
- **Lifecycle:** On toggle-on, fetches eval for the current position. On position change (`moveHistory`), cancels any in-flight request and fetches anew. On toggle-off, clears all eval state. No depth selector (depth is determined by what Lichess has cached).
- **Navigation integration:** Cloud eval re-fetches when the viewed position changes (keyed on `viewedFen` memo), not just when new moves are made. This means browsing through move history triggers eval lookups for each viewed position.

## Move Navigation

Users can browse through game history to view past positions on the board. Key points:

- **State:** `viewIndex` (`null` = live/latest position, `-1` = start position, `0..n-1` = after half-move N). `gameHistoryRef` stores verbose move objects from chess.js for replay.
- **Position reconstruction:** `replayToIndex(idx)` creates a disposable `Chess` instance and replays moves from `gameHistoryRef` up to the target index, returning the FEN and last-move squares. chess.js does not support jumping to arbitrary positions, so full replay from the start is required.
- **Board read-only:** When `viewIndex !== null` (viewing a past position), the board is set to view-only mode via `showPosition(fen, lastMoveSquares)`. Moves are only allowed at the live position.
- **Navigation controls:** Four buttons below the board (start, back, forward, end) using Chevron icons from lucide-react. A position indicator shows "Move X of Y" or "Start" when at position -1.
- **Keyboard shortcuts:** ArrowLeft/Right for back/forward, Home/End for start/end. The effect has a cleanup function removing the event listener.
- **Clickable notation:** Moves in the notation table are clickable via `goToMove(idx)`. The active move is highlighted based on `viewIndex`. Auto-scroll keeps the active move visible.
- **`viewedFen` memo:** Computes the FEN for the currently viewed position. Used as the dependency for cloud eval fetching and PV line SAN conversion, so both work correctly when browsing history.
- **Move blocking:** `makeMove` returns early when `viewIndex !== null`. Users must navigate to the live position (press End or click last move) before making new moves.
- **Undo integration:** `undoMove` pops the last entry from `gameHistoryRef` and resets `viewIndex` to `null` (live).
- **Reset integration:** `resetBoard` clears `gameHistoryRef`, sets `viewIndex` to `null`, and clears `cloudNotFound`.

## Opening Tree

Built from fetched user games. Displays the user's most played moves as an interactive trie in the left sidebar. Key points:

- **Data structure:** `buildOpeningTree(games, forColor)` builds a trie from game move strings. Each node: `{ san, count, wins, draws, losses, children }`. Root node represents the starting position.
- **Tree navigation:** `getTreeNode(root, moveHistory)` walks the tree following the board's current move history, returning the node at the current position. `getNextMoves(node)` returns children sorted by count (descending).
- **UI:** Left sidebar "Opening Tree" card shows next moves with SAN, game count, and a win/draw/loss percentage bar (green/gray/red). Each move is clickable — plays that move on the board and advances the tree.
- **Board arrows:** When the engine is off, the top 5 next moves from the opening tree are drawn as arrows on the board via Chessground's `drawable.autoShapes`. Arrow color reflects frequency: green (most played), blue (moderately played), paleBlue (less played).
- **Game stats:** When games are loaded, KPI cards show Win Rate (%), Games Analyzed, and Avg Opponent Rating instead of the default move/capture/check counters.
- **Loading state:** Animated spinner in the Opening Tree card, plus an animated progress bar in the top banner while games are being fetched.
- **Empty states:** "No opening data" when no user is searched, "No games reach this position" when the board position is beyond the tree's depth.
- **Integration:** Clicking a move in the tree plays it via chess.js, updates `moveHistory` and `gameHistoryRef`, syncs the board, and plays a sound. Disabled when viewing history (`viewIndex !== null`).
