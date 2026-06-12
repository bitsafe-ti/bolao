# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server on 127.0.0.1
npm run build     # Production build to /dist
npm run preview   # Serve the built /dist locally
npm test          # Node.js built-in test runner (test/domain.test.js)
```

## Architecture

Single-file React app (`src/main.jsx`) with no routing — all views are rendered conditionally based on app state. The entire UI lives in one large component tree with local `useState`.

**Persistence layers (two independent stores):**
- `localStorage` key `bolao-copa-2026:v1` — local-first, always written
- Supabase REST API (`src/sharedState.js`) — optional cloud sync, polled every 30 s; merge conflict favors remote when pulling, local when publishing

**State shape:** Predictions are a nested map `{ [participantId]: { [matchId]: { home, away, savedAt } } }`. Once a prediction has `savedAt`, it is locked — the UI disables editing and the merge logic will not overwrite it.

**Core modules:**
- `src/domain.js` — All scoring (3 pts exact result / 1 pt correct winner / 0), ranking, group-stage match generation, and user normalization. Tests cover this file exclusively.
- `src/sharedState.js` — Supabase read/write with timestamp-based merge. Contains hardcoded default URL/key/table/pool-id values used when env vars are absent.
- `src/resultsSync.js` — Fetches official results from `openfootball/worldcup.json` on GitHub; auto-runs on login and every 5 min. Also updates match metadata (dates, grounds, goalscorers).

## Environment Variables

No `.env.example` exists. The following `VITE_` vars are read at runtime with sensible defaults already embedded in `sharedState.js`:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon JWT |
| `VITE_SUPABASE_TABLE` | Table name (default: `bolao_public_state`) |
| `VITE_POOL_ID` | Distinguishes multiple pools in the same table (default: `copa-2026`) |
| `VITE_SUPER_ADMIN_EMAILS` | Comma-separated emails granted admin role (checked case-insensitively) |

## Deployment

Base path is `/bolao/` (configured in `vite.config.js`). The app is deployed to GitHub Pages at `https://bolao-copa2026.github.io/bolao/`. Pushing to `main` triggers CI deploy.

The Supabase schema is in `supabase-schema.sql` — a single `bolao_public_state` table with `pool_id` as partition key.

## Design System

Colors, spacing, and typography are documented in `design.md`. Primary: `#3B82F6`, Secondary: `#8B5CF6`. Fonts: Roboto (body), Poppins (display), Inconsolata (mono). Uses an 8pt baseline grid and 150–250 ms transitions.

## Key Conventions

- Entity IDs are prefixed: `user-`, `participant-`, `match-`, `group-`
- Dates stored as ISO 8601 strings; displayed in São Paulo timezone (`America/Sao_Paulo`)
- Country flag images come from `flagcdn.com` using ISO 3166-1 alpha-2 codes stored in `src/teams.js`
- Admin capabilities (manage participants, add/edit matches, reset data, force result sync) are gated on `role === 'admin'`, which is assigned in `domain.js:normalizeUsers()` based on the env var above
