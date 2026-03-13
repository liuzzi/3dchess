# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server (game only)
npm run party      # PartyKit dev server (multiplayer lobby, port 1999)
npm run build      # tsc && vite build — TypeScript check + production build
npm run preview    # Preview production build locally
```

There are no automated tests. Validation is `npm run build` passing plus browser smoke-testing.

To develop multiplayer features, run both `npm run dev` and `npm run party` concurrently. The Vite config proxies `/lobby-ws` to localhost:1999 automatically.

## Architecture

**chess<sup>3d</sup>** (chess3d.co) is a browser-based 3D chess game (8×8×8 board) with AI opponents and real-time multiplayer. It's a Vite MPA (multi-page app) — each route is a separate `index.html` compiled from `vite.config.ts` rollupOptions input.

### Core Game Flow

`main.ts` is the composition root. It wires together all modules and owns the lifecycle. The flow:

1. `menuController.ts` — mode selection UI → emits game start event
2. `game.ts` — state machine (turns, move execution, win detection)
3. `board.ts` — data layer; uses **apply/unapply** move simulation (no cloning) for performance
4. `movement.ts` — 3D move generation; standard chess rules extended to 3D space
5. `boardView.ts` / `pieceView.ts` — Three.js rendering layer
6. `interaction.ts` — pointer input, raycasting to board positions
7. `bot.ts` + `botWorker.ts` — AI via minimax in a Web Worker with transposition tables
8. `network.ts` + `onlineBridge.ts` + `lobbyClient.ts` — P2P (PeerJS) + PartyKit lobby

### 3D Coordinate System

Pieces live at `(x, y, z)` where x = column, y = row, z = layer. Three.js maps this as `(x, z, y)`. Movement rules in `movement.ts` extend standard chess in all 3D directions (rooks: axis-aligned + 2D diagonals; bishops: xy-plane + 3D space diagonals; etc.).

### Multiplayer Architecture

- **PartyKit** (`party.ts`, `partykit.json`) — serverless lobby server; handles room creation, matchmaking, invites
- **PeerJS** (`network.ts`) — P2P connection after PartyKit handshake; all game moves go P2P
- **lobbyClient.ts** — WebSocket client connecting to PartyKit; wired into game via `onlineBridge.ts`

### Content/SEO Pages

Static HTML pages (`/chess-rules/`, `/chess-openings/`, `/chess-puzzles/`, `/how-to-play-chess/`, `/about/`) share `public/style.css` and use `src/content-page.ts` (mobile nav toggle only). Adding a new page requires:
1. Create `<page-name>/index.html` following SEO_RULES.md
2. Add entry to `vite.config.ts` rollupOptions input
3. Add URL to `public/sitemap.xml`

### Shared Styles

`public/style.css` covers both game UI and content pages. Key design system:
- Dark radial gradient + animated dot-matrix background
- Glassmorphism: `rgba(14,14,38,0.6)` with `backdrop-filter: blur(18px)`
- Typography: `#e0e0ff` headings, `rgba(235,239,255,0.85)` body text
- Animations: `titleGradient` (color cycling), `titleFloat` (3D perspective rotation)

## SEO Rules

See `SEO_RULES.md` for full governance. Key constraints:
- Page titles: `Primary Keyword | chess<sup>3d</sup>`
- Meta descriptions: 120–155 characters
- All pages need canonical URL, Open Graph tags, and JSON-LD structured data
- Internal links must use trailing slashes (e.g., `/chess-rules/`)
- Content pages must include a CTA linking to `/play-chess-online/` and the "Learn Chess" internal link silo
