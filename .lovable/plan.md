# Plan: Full Web Version under Docker (nginx) with local PostgreSQL

## Goal
Run the complete web app (SSR, server functions, JRC/TED update monitoring,
login, shared DB edits) locally under Docker: Node.js app + nginx reverse
proxy + local PostgreSQL. Data lives in local PostgreSQL; login stays on the
existing Lovable Cloud auth (remote Supabase) so no service-role key is needed.

## Key design decision: dual-backend data layer
Server functions run in **two** runtimes:
- Lovable preview/published → Cloudflare Worker → uses Supabase (as today).
- Local Docker → Node.js (`NITRO_PRESET=node-server`) → uses local PostgreSQL.

`src/lib/db.server.ts` picks the backend at call time:
- If `DB_HOST` is set → use a `pg` Pool against local PostgreSQL.
- Otherwise → use the existing `supabaseAdmin` (unchanged Lovable behavior).

This keeps the Lovable preview fully working and adds local-PG support with no
behavior change on Lovable. No service-role key is needed locally because all
privileged reads/writes go to local PostgreSQL.

Auth: `requireSupabaseAuth` stays as-is (verifies JWT against remote Lovable
Cloud Supabase, returns `userId`). Server functions stay auth-protected; after
auth they hit local PostgreSQL. Overrides store the Supabase `userId`.

## Changes

### 1. New dependency
- `pg` (node-postgres) + `@types/pg` — only used server-side inside handlers.

### 2. `src/lib/db.server.ts` (new)
A typed data-access module exposing the operations the app needs:
`getCards()`, `getOverrides()`, `saveOverride(cardId, patch, userId)`,
`resetOverride(cardId)`, plus the query/mutate helpers `jrc.server.ts` uses
(selects/inserts/updates on `tachograph_cards`, `jrc_source_snapshots`,
`jrc_update_proposals`, `jrc_check_runs`, `cron_config`).
Internally branches on `DB_HOST`: local → `pg.Pool`; else → `supabaseAdmin`.

### 3. Refactor server code to use `db.server.ts`
- `src/lib/jrc.server.ts` — replace every `supabaseAdmin.from(...)` chain with
  `db.server.ts` helpers returning the same shapes. (~15 call sites.)
- `src/lib/cards.functions.ts` — `saveCardOverride`/`resetCardOverride` use
  `db.server.ts` helpers instead of `context.supabase` (still
  `requireSupabaseAuth` for `userId` + gate).
- `src/routes/api/public/jrc-check.ts` — `cron_config` token read via
  `db.server.ts`.
- New `getCardsFn` / `getOverridesFn` server functions; `src/routes/index.tsx`
  `useCards`/`useOverrides` call them instead of the browser Supabase client
  (which can't reach local PostgreSQL).

### 4. Extend `db/init.sql`
Append `tachograph_card_overrides` + `cron_config` tables (copy schema from the
existing Supabase migrations, no RLS needed locally — the app is trusted
behind nginx). Keep pg_cron schedule optional, pointing at the local endpoint.

### 5. Docker stack (new files)
- `Dockerfile.web` — multi-stage: `bun install` → `NITRO_PRESET=node-server
  bun run build` → runtime image runs `node .output/server/index.mjs` on
  port 3000.
- `docker-compose.web.yml` — services: `db` (postgres:16 + `db/init.sql`
  mounted), `web` (built from `Dockerfile.web`, env `DB_*` + `SUPABASE_*`),
  `nginx` (reverse proxy → `web:3000`).
- `nginx/web/tdh-web.conf` — `proxy_pass http://web:3000;` with gzip, caching
  headers, SPA fallback.

### 6. `.env.example`
Add `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` + the existing
`SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_*` vars needed by the
node build (VITE_* baked at build time, SUPABASE_* at runtime).

### 7. `DEPLOYMENT.md`
New section "Web-Version (Vollversion) mit lokalem PostgreSQL" with
step-by-step: clone → `.env` → `docker compose -f docker-compose.web.yml up
-d --build` → verify ports → notes on auth (sign in via Lovable Cloud) and on
the local cron endpoint.

## Testing limits (honest)
- The Lovable sandbox forces the Cloudflare Nitro preset, so I **cannot**
  run or test a `node-server` build here. I will verify with typecheck
  (`tsgo`) and by reading the generated shapes; the real build + Docker run
  happens on your server.
- The Lovable preview keeps working (DB_HOST unset → Supabase path unchanged).

## Out of scope
- Replacing Supabase Auth with a fully local auth system (kept remote on
  purpose — simplest working login without a service-role key).
- Re-hosting on a non-Node runtime.
