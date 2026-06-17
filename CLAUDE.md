# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                  # Vite dev server on 127.0.0.1
npm run build                # Production build to /dist (GitHub Pages, base /bolao/)
npm run build:cloudflare     # Production build for Cloudflare (base /, VITE_POOL_ID=copa-2026)
npm run pages:dev            # Build + local Cloudflare Pages with D1 binding (.wrangler/state)
npm run deploy:cloudflare    # Build + deploy to Cloudflare Pages via wrangler
npm run preview              # Serve the built /dist locally
npm test                     # Node.js built-in test runner (test/domain.test.js)
node --test --test-name-pattern "scores" # Run a single test by name pattern
```

## Architecture

Single-file React app (`src/main.jsx`) with no routing — all views are rendered conditionally based on app state. The entire UI lives in one large component tree with local `useState`.

**Persistence layers:**
- `localStorage` — session key (`bolao-copa-2026:session`) and cache key (`bolao-copa-2026:cache`) for fast initial render and offline resilience. Both keys are scoped with `:poolId` when `VITE_POOL_ID` differs from `copa-2026`.
- Cloudflare Pages Functions + D1 (`src/sharedState.js`, `functions/api/pool-state/[poolId].js`) — canonical cloud state, polled every 30 s; merge conflict favors remote when pulling, local when publishing.

**State shape:** Predictions are a nested map `{ [participantId]: { [matchId]: { home, away, savedAt } } }`. Once a prediction has `savedAt`, it is locked — the UI disables editing and the merge logic will not overwrite it.

**Core modules:**
- `src/domain.js` — Scoring (3 pts exact / 1 pt correct winner / 0), ranking, group-stage match generation, user normalization, and prediction-purge helpers. Tests cover this file (and `resultsSync.js`/`sharedState.js`) exclusively.
- `src/sharedState.js` — Cloudflare API read/write with timestamp-based merge (`mergePublicPoolState`), email deduplication across merged states, and deleted-ID tombstone propagation.
- `src/resultsSync.js` — Fetches official results from `openfootball/worldcup.json` on GitHub; auto-runs on login and every 5 min; also patches match metadata (dates, grounds, goalscorers).
- `src/passwords.js` — Browser-native PBKDF2-SHA-256 (150 k iterations) for password hashing. `verifyPassword` falls back to plain-text comparison to migrate legacy accounts on first sign-in.
- `src/teams.js` — Team registry with ISO 3166-1 alpha-2 codes; `getFlagUrl` returns flagcdn.com URLs.
- `src/venues.js` — Venue lookup by ground name string (city, stadium, country).

**API layer (`functions/api/pool-state/[poolId].js`):**
- `GET` — returns current D1 state (or empty shell).
- `PUT`/`PATCH` — idempotent upsert; throws 409 (`LockedResultError`) if any match that already has a score in DB would have that score changed. Schema is created lazily with `ensureSchema`.

**Prediction-round gating:**
- `releasedPredictionRound` in state controls which round participants may submit. It advances automatically via `getActiveRound` (first round not fully scored) and can be bumped manually by admins.
- On load, three purge passes run: `purgeExpiredPredictions` (removes post-kickoff predictions), `purgeFutureRoundPredictions` (removes predictions beyond the released round), `purgeClearedOpeningPredictions` (removes predictions for specific early matches hardcoded in `clearedOpeningPredictionMatchIds`).

## Environment Variables

No `.env.example` exists. The following `VITE_` vars are read at runtime with sensible defaults already embedded:

| Variable | Purpose |
|---|---|
| `VITE_POOL_ID` | Distinguishes multiple pools in the same D1 table (default: `copa-2026`) |
| `VITE_API_BASE_URL` | Optional API origin when the frontend is not served by the same Cloudflare Pages project |
| `VITE_SUPER_ADMIN_EMAILS` | Comma-separated emails granted admin role (checked case-insensitively) |

A hardcoded fallback `DEFAULT_SUPER_ADMIN_EMAIL` is defined in `src/main.jsx:40` for dev convenience.

## Deployment

Base path defaults to `/bolao/` for the legacy GitHub Pages build. Cloudflare builds use `VITE_BASE_PATH=/` through `npm run build:cloudflare`.

The Cloudflare D1 schema is in `migrations/0001_pool_state.sql`; setup steps are in `docs/cloudflare-d1.md`. The D1 binding name is `DB` (wrangler name `bolao-copa2026`).

## Design System

Colors, spacing, and typography are documented in `design.md`. Primary: `#3B82F6`, Secondary: `#8B5CF6`. Fonts: Roboto (body), Poppins (display), Inconsolata (mono). Uses an 8pt baseline grid and 150–250 ms transitions.

## Key Conventions

- Entity IDs are prefixed: `user-`, `participant-`, `match-`, `group-`
- Dates stored as ISO 8601 strings without timezone (local São Paulo time); displayed in `America/Sao_Paulo` timezone
- Country flag images come from `flagcdn.com` using ISO 3166-1 alpha-2 codes stored in `src/teams.js`
- Admin capabilities (manage participants, add/edit matches, reset data, force result sync) are gated on `role === 'admin'`, assigned in `domain.js:normalizeUsers()` based on the env var above
- Match IDs for group stage follow `group-{letter}-{index}` (e.g. `group-a-1`); matches beyond group stage are added manually by admins
- Audit log is capped at 300 entries (trimmed in `mergeAuditLogs`); entries require an `id` field to deduplicate across merges
