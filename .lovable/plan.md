# Plan: Full Web Version as a single Docker container (Node + PostgreSQL)

## Goal
Run the complete web app (SSR, server functions, JRC/TED update monitoring,
login, shared DB edits) locally in **one Docker container** that bundles the
Node.js app **and** PostgreSQL, serving **HTTPS** directly. A single
`docker run -p 443:443 tdh-web` starts everything. No nginx, no second
container, no separate DB setup.

HTTPS: the Node server handles TLS itself (`NITRO_SSL_CERT`/`NITRO_SSL_KEY`).
The container entrypoint uses a mounted real certificate from
`/certs/{fullchain,privkey}.pem` when present, else generates a self-signed one
(browser warning expected, like the existing `test2` mode). In your homelab the
OPNsense ACME client (Cloudflare certs) drops the real cert into that folder;
test mode runs with the auto-generated self-signed cert.

Data lives in PostgreSQL inside the container; login stays on the existing
Lovable Cloud auth (remote Supabase) so no service-role key is needed.

## Homelab / Betrieb (VLAN 2 / DMZ, OPNsense)
- **Zertifikate**: OPNsense ACME-Automation legt die Cloudflare-Certs als
  `/certs/fullchain.pem` + `/certs/privkey.pem` in den Container (Volume). Ohne
  gemountete Certs läuft Testmodus mit Self-Signed. Kein Code-Änderung nötig.
- **Egress (wichtig)**: ausgehend HTTPS (443) aus der DMZ erlauben — für (a)
  Lovable-Cloud-Auth-Verifikation und (b) JRC-/TED-Abrufe des Update-Monitorings.
- **Port**: HTTPS auf dem Docker-Host in VLAN 2 (z. B. `-p 443:443`).
- **Persistenz**: Volume für die PostgreSQL-Daten (`tdh_pgdata`).
- **Domain**: ACME-Domain muss auf die Docker-Host-IP in der DMZ zeigen
  (Split-DNS intern oder extern).

## Key design decision: dual-backend data layer
Server functions run in two runtimes:
- Lovable preview/published (Cloudflare Worker) → uses Supabase (as today).
- Local Docker (Node.js, `NITRO_PRESET=node-server`) → uses local PostgreSQL.

`src/lib/db.server.ts` picks the backend at call time inside each handler:
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
- `pg` (node-postgres) + `@types/pg` — server-side only, inside handlers.

### 2. `src/lib/db.server.ts` (new)
Typed data-access module. Branches on `DB_HOST`: local → `pg.Pool`; else →
`supabaseAdmin`. Exposes the operations the app needs:
- `getCards()`, `getOverrides()`, `saveOverride()`, `resetOverride()`.
- The query/mutate helpers `jrc.server.ts` uses on `tachograph_cards`,
  `jrc_source_snapshots`, `jrc_update_proposals`, `jrc_check_runs`,
  `cron_config` (returning the same shapes the Supabase calls did).

### 3. Refactor server code to use `db.server.ts`
- `src/lib/jrc.server.ts` — replace every `supabaseAdmin.from(...)` chain with
  `db.server.ts` helpers (~15 call sites).
- `src/lib/cards.functions.ts` — `saveCardOverride`/`resetCardOverride` use
  `db.server.ts` instead of `context.supabase` (still `requireSupabaseAuth`).
- `src/routes/api/public/jrc-check.ts` — `cron_config` token read via
  `db.server.ts`.
- New `getCardsFn` / `getOverridesFn` server functions; `src/routes/index.tsx`
  `useCards`/`useOverrides` call them instead of the browser Supabase client
  (which can't reach local PostgreSQL).

### 4. Extend `db/init.sql`
Append `tachograph_card_overrides` + `cron_config` tables (copy schema from the
existing Supabase migrations, no RLS needed locally — the app is trusted inside
the container). Keep an optional pg_cron schedule pointing at localhost.

### 5. Single Docker image (`Dockerfile.web`) — with HTTPS
Multi-stage:
1. Build stage: `bun install` → `NITRO_PRESET=node-server bun run build`
   → produces `.output/server/index.mjs`.
2. Runtime stage: Node base image with PostgreSQL + openssl installed. A small
   `supervisord` config starts `postgres` and the Node app. An entrypoint
   script: inits the DB from `db/init.sql` on first boot; uses a real cert
   from a mounted `/certs/{fullchain,privkey}.pem` when present, else generates
   a self-signed one; exports `NITRO_SSL_CERT`/`NITRO_SSL_KEY` so the Node
   server serves HTTPS; then starts supervisord. App connects to
   `localhost:5432`. HTTPS port 443 exposed. Data persisted via a Docker
   volume on the PG data dir; certs via a mounted `/certs` volume.

### 6. `.env.example`
Add `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` (defaults point at the
in-container localhost DB) + the existing `SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY`
and `VITE_SUPABASE_*` vars the node build needs (VITE_* baked at build time,
SUPABASE_* at runtime for auth).

### 7. GitHub Actions: build + push image (`.github/workflows/build-web.yml`)
On push to `main` and on manual dispatch: build `Dockerfile.web` with
`NITRO_PRESET=node-server` and the `VITE_SUPABASE_*` values (from GitHub repo
secrets), tag and push to `ghcr.io/<org>/tdh-web:latest` (and `:sha`). Uses
`GITHUB_TOKEN` with `packages: write`. No build runs on the homelab — it only
pulls the finished image.

### 8. `DEPLOYMENT.md`
New section "Web-Version (Vollversion) als Ein-Container (HTTPS, Homelab/DMZ)"
with two paths:
- **Via GitHub (empfohlen)**: Repo-Secrets `VITE_SUPABASE_*` anlegen → Workflow
  baut & pusht nach `ghcr.io/<org>/tdh-web` → Homelab: `docker pull` +
  `docker run -p 443:443 -v tdh_pgdata:/var/lib/postgresql/data -v ./certs:/certs:ro
  -e SUPABASE_URL=... -e SUPABASE_PUBLISHABLE_KEY=... ghcr.io/<org>/tdh-web`.
- **Lokal bauen**: `.env` anpassen → `docker build -f Dockerfile.web -t tdh-web .`
  → `docker run -p 443:443 -v tdh_pgdata:/var/lib/postgresql/data tdh-web`.
Beide: Browser auf `https://<host>` (Self-Signed im Test, OPNsense-ACME-Certs im
Live) → Sign-in via Lovable Cloud → egress 443 in der OPN-Firewall für Auth +
JRC/TED freigeben → Hinweise zum lokalen Cron-Endpunkt und zum Reset des
Daten-Volumes.

## Testing limits (honest)
- The Lovable sandbox forces the Cloudflare Nitro preset, so a `node-server`
  build **cannot** be run/tested here. I verify with `tsgo` typecheck and by
  reading generated shapes; the real build + Docker run happens on your server.
- The Lovable preview keeps working (`DB_HOST` unset → Supabase path unchanged).

## Out of scope
- Replacing Supabase Auth with a fully local auth system (kept remote on
  purpose — simplest working login without a service-role key).
- nginx / multi-container production hardening (not needed for a local tool;
  add later behind an external TLS proxy if required).
