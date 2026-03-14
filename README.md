# RepertoireLab

A chess opening repertoire analyzer that fetches and visualizes your Lichess games with interactive opening trees, cloud engine evaluations, and detailed statistics.

## Features

- **Interactive Opening Tree** - Navigate your most-played moves as an interactive trie with win/draw/loss statistics at every position
- **Cloud Engine Evaluation** - Instant position analysis from Lichess's 320M+ position cloud eval database
- **Game Statistics** - Win rate, average opponent rating, and performance breakdown across your games
- **Live Streaming** - Games stream in real-time as they're fetched from Lichess
- **Customizable Board** - Multiple board themes, piece sets, and dark/light mode
- **Sound Effects** - Chess move sounds for an immersive experience

## Tech Stack

- **React 19** - UI framework
- **Vite 6** - Build tool
- **Tailwind CSS 3.4** - Styling
- **Shadcn UI** - Component library
- **ChessgroundX** - Board rendering
- **Chess.js** - Game logic
- **Lichess API** - Game data source

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/Untitled-Master/RepertoireLab.git
cd RepertoireLab

# Install dependencies
npm install
```

### Development

```bash
# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Production Build

```bash
# Create production build
npm run build

# Preview production build
npm run preview
```

## Usage

1. Enter a Lichess username on the home page
2. Select your preferred color (white, black, or both)
3. Optionally configure time controls and number of games
4. Click "Analyze Games" to view your opening repertoire

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` | Go back one move |
| `→` | Go forward one move |
| `Home` | Go to start |
| `End` | Go to end |

### Opening Tree

- Click on moves in the sidebar to navigate through your games
- The tree shows win/draw/loss percentages for each position
- Green arrows on the board show your most-played moves

### Cloud Evaluation

- Toggle the engine button to fetch position evaluations
- Shows the top 3 best moves with evaluation scores
- Blue arrow indicates the computer's best move

## Project Structure

```
src/
├── main.jsx              # React root mount
├── App.jsx               # Router and ErrorBoundary
├── index.css             # Global styles and CSS variables
├── pages/
│   ├── Home.jsx          # Landing page with username search
│   └── Dashboard.jsx     # Main chess analysis interface
├── lib/
│   ├── utils.js          # Utility functions (cn, etc.)
│   ├── stockfish.js      # Lichess Cloud Eval API client
│   └── lichess.js        # Lichess API client
└── components/ui/        # Shadcn UI components
```

## API Integration

RepertoireLab uses the following Lichess API endpoints:

- `GET /games/user/{username}` - Stream user games (NDJSON)
- `GET /cloud-eval` - Fetch position evaluations

No authentication required - all data is fetched directly from Lichess's public API.

## License

MIT License - see LICENSE for details.

## Acknowledgments

- [Lichess](https://lichess.org/) - Open source chess server
- [Chessground](https://github.com/lichess-org/chessground) - Chess UI library
- [Shadcn UI](https://ui.shadcn.com/) - Beautiful, accessible components
