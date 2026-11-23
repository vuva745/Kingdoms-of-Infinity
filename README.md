# Kingdoms of Infinity — Three.js / TypeScript prototype

A separate mobile-first 3D browser game, ported from the gameplay concept in the earlier Godot prototype. Not a line-by-line engine conversion.

## Gameplay
Collect all 12 crystals, then reach the portal at the north end of the world.

## Run and test
1. Install Node.js 20+
2. Run `npm install`
3. Run `npm test`
4. Run `npm run build`
5. Run `npm run dev` and open the local URL in a browser.
6. For Android browser testing, serve over a reachable local-network address and use the phone on the same Wi-Fi.

## Controls
Touch directional pad or keyboard arrows/WASD. Action: on-screen button or Space.

## Status
Prototype. Browser gameplay and Android device compatibility require manual verification. PWR integration and GitHub publishing have not been performed.

## Backend (Express API + leaderboard)

The repo now ships a small Node/Express backend in `server/` that persists a leaderboard and serves the built game.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the API (port 3000, auto-reload) **and** the Vite dev server (port 5173). Vite proxies `/api/*` to the API. |
| `npm run dev:client` / `npm run dev:server` | Run either half on its own. |
| `npm run build` | Type-checks and bundles the game into `dist/`. |
| `npm start` | Production mode: serves `dist/` and the API from one process on `PORT` (default 3000). |
| `npm test` | Runs game-logic, validation and HTTP API tests (`node --test`). |

### API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness check: `{ ok, game, uptimeMs, entries }` |
| GET | `/api/config` | Game constants (`scoreLabel`, `maxScore`, `winScore`) |
| GET | `/api/scores?limit=10` | Leaderboard, best first (score desc, then fastest time). `limit` 1–100. |
| POST | `/api/scores` | Submit `{ name, score, won, durationMs }`. Returns the saved entry with its `rank`. 400 on invalid input, 429 when rate-limited (30/min per IP). |
| GET | `/api/stats` | `{ runs, wins, best }` |

Score for this game = crystals collected (0–12). Names are trimmed to 20 characters; scores above `maxScore` or wins below `winScore` are rejected.

### Storage and configuration

Scores are stored as JSON in `server/data/scores.json` (git-ignored, written atomically, top 1000 kept). Environment variables:

- `PORT` – HTTP port (default `3000`)
- `DATA_FILE` – alternative path for the scores file
- `CORS_ORIGIN` – set this if the game is hosted on a different origin than the API
- `TRUST_PROXY=1` – honour `X-Forwarded-For` behind a reverse proxy (affects rate limiting)
- `VITE_API_BASE` – build-time base URL for the API when it is not same-origin (defaults to same origin)

The end-of-run screen in the game lets the player enter a name, save the score and see the top 5.
