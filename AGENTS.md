# AGENTS.md

## Project Overview

React 19 single-page chess application built on Lichess Chessground (board rendering) and chess.js (game logic). Uses Vite 6, Tailwind CSS 3.4, Shadcn UI (new-york style), and react-router-dom for routing. Written in **JavaScript (JSX) — no TypeScript**. Deployed on Vercel.

## Build / Lint / Test Commands

| Command           | Description                                |
|-------------------|--------------------------------------------|
| `npm run dev`     | Start Vite dev server (port 5173)          |
| `npm run build`   | Production build to `dist/`                |
| `npm run lint`    | Run ESLint across the project (`eslint .`) |
| `npm run preview` | Preview production build locally           |

**No test framework is configured.** If you add tests, use Vitest and place test files next to source files with `.test.jsx` extension. Run a single test with:

```sh
npx vitest run src/path/to/file.test.jsx
```

**Lint baseline:** 51 errors (all `react/prop-types` and `no-undef` in config files). Never exceed this count. ESLint 9 flat config (`eslint.config.js`) uses `eslint-plugin-react`, `eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh`. Files matched: `**/*.{js,jsx}`, `dist/` ignored.

## Project Structure

```
src/
  main.jsx              # React root mount (StrictMode)
  App.jsx               # Router shell (~16 lines): / → Home, /dashboard → Dashboard
  index.css             # Global styles, CSS variables, board themes, eval bar
  pages/
    Home.jsx            # Landing page — animated board, username search, recent searches, popular players
    Dashboard.jsx       # Full chess app (~2600 lines) — board, sidebars, engine, notation, opening tree
  lib/
    utils.js            # cn() utility (clsx + tailwind-merge)
    stockfish.js        # Lichess Cloud Eval API client (fetch, parse, display helpers)
    lichess.js          # Lichess API client — fetchUserGames (NDJSON streaming)
  components/ui/
    button.jsx          # Shadcn Button (cva variants)
    card.jsx            # Shadcn Card components
    select.jsx          # Shadcn Select (wraps Radix)
```

## Code Style Guidelines

### Formatting

- **Indentation:** 2 spaces (no tabs).
- **Semicolons:** Omit in hand-written code. Shadcn/ui files may have them — match surrounding code.
- **Quotes:** Single quotes in hand-written code. Double quotes in Shadcn/ui files — match surrounding code.
- **Trailing commas:** Used in multi-line arrays, objects, and function parameters.
- **Line length:** No enforced limit; keep readable. Long JSX attribute lists break one-per-line.
- **No Prettier configured.** Follow existing conventions by file.

### Imports

Ordered in groups (no blank lines between groups):

1. React hooks/core (`import { useState, useEffect } from 'react'`)
2. Third-party libraries (`chessground`, `chess.js`, `lucide-react`)
3. Internal libs (`@/lib/stockfish`, `@/lib/lichess`)
4. Internal components (`@/components/ui/button`)
5. CSS files (`chessground/assets/...`, `./index.css`)

Shadcn/ui files start with `import * as React from "react"`, then third-party, then `import { cn } from "@/lib/utils"`.

Always use the **`@/` path alias** for imports from `src/` (configured in `vite.config.js` and `jsconfig.json`).

### Naming Conventions

| Element               | Convention         | Example                                 |
|-----------------------|--------------------|-----------------------------------------|
| Components            | PascalCase         | `KpiCard`, `StatusBadge`, `ThemeSwatch` |
| Functions             | camelCase          | `loadPrefs`, `syncBoard`, `playSound`   |
| Variables / state     | camelCase          | `moveHistory`, `boardSize`, `cgRef`     |
| State setters         | `set` + PascalCase | `setOrientation`, `setColorMode`        |
| Module constants      | UPPER_SNAKE_CASE   | `PREFS_KEY`, `BOARD_THEMES`, `PIECE_MAP`|
| CSS classes (custom)  | kebab-case         | `board-theme-blue`, `board-resize-handle`|
| CSS custom properties | `--kebab-case`     | `--background`, `--muted-foreground`    |

### Component Definitions

- **Main/large components:** `function` declaration (`function Dashboard() { ... }`).
- **Small presentational:** `const` + arrow function (`const KpiCard = ({ ... }) => ( ... )`).
- **Shadcn/ui primitives:** `const` + `React.forwardRef` + arrow, with `.displayName` set.
- **Handlers used as deps/passed to children:** Wrap in `useCallback` with explicit deps.
- **Inline handlers:** `const` + arrow, no `useCallback`.

### Exports

- Page components: `export default Dashboard` at bottom of file.
- UI components: grouped named exports at bottom: `export { Button, buttonVariants }`.
- Utility/lib functions: inline named exports: `export function cn(...) { ... }`.

### Props

- Always destructure in the parameter list, never in the function body.
- `...props` spread as the last item for forwarding to DOM elements.
- Default values in destructuring: `{ position = "popper", ...props }`.
- Rename via alias: `{ icon: Icon }` (lowercase prop → PascalCase for JSX).

### React Patterns

- **State:** `useState` + `useRef` only. No external state libraries.
- **Refs for imperative libs:** chess.js and Chessground in `useRef`, updated via `.set()`.
- **Functional updates:** `setState(prev => ...)` when new state depends on previous.
- **useMemo:** For derived/computed values.
- **useCallback:** For handlers used as effect deps or passed to children.
- **useEffect:** Always include explicit dep arrays. `// eslint-disable-line react-hooks/exhaustive-deps` only for intentional mount-only effects. Always return cleanup functions for listeners/timers.

### Error Handling

- **Non-critical** (localStorage, audio): `try { ... } catch { /* ignore */ }`. Parameterless `catch`, brief comment.
- **Fire-and-forget promises:** `.catch(() => {})`.
- **Critical** (chess moves): `try/catch` with recovery (e.g., `syncBoard()`) and boolean return.
- **Guard clauses:** Early `return` when refs/state not ready: `if (!cg) return`.

### Styling

- **Tailwind-first.** Avoid custom CSS unless needed for SVG backgrounds, board themes, or animations.
- **Class merging:** Use `cn()` from `@/lib/utils` in reusable components. Template literals OK in page components.
- **Dark mode:** Class strategy (`darkMode: ["class"]`). Toggle `.dark` on `document.documentElement`.
- **CSS variables:** HSL values without `hsl()` wrapper, consumed via `hsl(var(--variable))` in Tailwind config.

### JSX Conventions

- Self-close elements without children: `<DotPattern />`.
- Conditional rendering: `&&` for presence/absence, ternary for either/or.
- Array rendering: `.map()` with unique `key` props.
- Section comments: `{/* --- Section name --- */}` or `{/* ── Section name ── */}`.

## Routing & Navigation

| Path         | Component   | Description                                              |
|--------------|-------------|----------------------------------------------------------|
| `/`          | `Home`      | Landing page — username input, color picker, recent/popular searches |
| `/dashboard` | `Dashboard` | Chess app — reads `?user=X&color=Y&speeds=Z&max=N` query params     |

SPA fallback in `vercel.json`. Home navigates to Dashboard via query params. Dashboard fetches games on mount via `useSearchParams`.

## Architecture Notes

- **Imperative sync:** Chess.js and Chessground communicate through refs, not React props. Board state flows: chess.js → `cg.set()`.
- **Opening tree:** Trie built from user games via `buildOpeningTree()`. Nodes: `{ san, count, wins, draws, losses, children }`. Top moves drawn as board arrows.
- **Cloud eval:** Lichess Cloud Eval API (`stockfish.js`). Scores always from **white's perspective**. Requests `multiPv=3`. Cancels in-flight requests on position change via `AbortController`.
- **Move navigation:** `viewIndex` (`null` = live, `-1` = start, `0..n-1` = after half-move N). Board is read-only when viewing history.
- **NDJSON streaming:** `lichess.js` streams games via `ReadableStream` with `onGame` callback. Dashboard batches updates via `requestAnimationFrame`.
- **Preferences:** Persisted to `localStorage` key `'chess-preferences'` via `loadPrefs()`/`savePrefs()`.
- **Recent searches:** Stored in `localStorage` key `'lichess-prep-recent'`, max 6 entries.
- **Sub-components** (`KpiCard`, `EvalBar`, `StatusBadge`, etc.) are co-located in their page files, not extracted to separate modules.
