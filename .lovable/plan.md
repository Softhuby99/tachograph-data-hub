# Plan: Full Web Version as a single Docker container — fully local, no Lovable backend

## Goal
Run the complete web app (SSR, JRC/TED update monitoring, shared data edits)
in **one Docker container** that bundles the Node.js app **and** PostgreSQL,
serving **HTTPS** directly. No nginx, no second container, no Lovable Cloud.

Login: **none for now** — anyone who can reach the container in your DMZ may
read and edit. Access control is handled by your OPNsense firewall. Authentik
(OIDC) can be added later as a separate step; nothing in this design blocks it.

Single command on the homelab:
```text
docker run -p 443:443 \
  -v tdh_pgdata:/var/lib/postgresql/data \
  -v ./certs:/certs:ro \
  ghcr.io/<org>/tdh-web:latest
```

## Result: no external dependency
The only outbound traffic left is HTTPS to the JRC/TED sites during an update
check. Auth, data, and edits are all inside the container.

## Key design decision: dual-backend data layer
Server functions run in two runtimes:
- Lovable preview/published (Cloudflare Worker) → uses Supabase, as today, so
  the preview you work in keeps running unchanged.
- Local Docker (Node.js, `NITRO_PRESET=node-server`) → uses local PostgreSQL.

`src/lib/db.server.ts` picks the backend at call time inside each handler:
`DB_HOST` set → `pg` Pool against local PostgreSQL; otherwise → the existing
Supabase path. Same for auth: when `AUTH_MODE=none` (the Docker default) the
server functions skip the auth middleware and act as a trusted local user.

## Homelab / Betrieb (VLAN 2 / DMZ, OPNsense)
- **Zertifikate**: OPNsense-ACME-Automation legt die Cloudflare-Certs als
  `/certs/fullchain.pem` + `/certs/privkey.pem` in den Container (Volume).
  Ohne gemountete Certs läuft Testmodus mit automatisch erzeugtem Self-Signed.
- **Egress**: ausgehend HTTPS (443) aus der DMZ erlauben — nur für die
  JRC-/TED-Abrufe des Update-Monitorings.
- **Port**: HTTPS auf dem Docker-Host in VLAN 2 (z. B. `-p 443:443`).
- **Persistenz**: Volume für die PostgreSQL-Daten (`tdh_pgdata`).
- **Zugriffsschutz**: vorerst nur Firewall/VLAN — kein App-Login.

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

### 3. Optional-auth middleware
New `src/lib/auth.server.ts` wrapper used by the server functions instead of
`requireSupabaseAuth` directly: when `AUTH_MODE=none` it passes through with a
fixed local user id; otherwise it delegates to `requireSupabaseAuth` (so the
Lovable preview keeps its login). Later, an `AUTH_MODE=oidc` branch can verify
an Authentik ID token here — one place to extend.

### 4. Refactor server code
- `src/lib/jrc.server.ts` — replace every `supabaseAdmin.from(...)` chain with
  `db.server.ts` helpers (~15 call sites).
- `src/lib/cards.functions.ts` — `saveCardOverride`/`resetCardOverride` use
  `db.server.ts` and the optional-auth wrapper.
- `src/lib/jrc.functions.ts` — swap to the optional-auth wrapper.
- `src/routes/api/public/jrc-check.ts` — `cron_config` token read via
  `db.server.ts`.
- New `getCardsFn` / `getOverridesFn` server functions; `src/routes/index.tsx`
  `useCards`/`useOverrides` call them instead of the browser Supabase client
  (which can't reach local PostgreSQL).
- Header: hide the Sign in / Sign out button when auth is disabled.

### 5. Extend `db/init.sql`
Append `tachograph_card_overrides` + `cron_config` tables (schema copied from
the existing migrations, no RLS needed locally). Optional pg_cron schedule for
the nightly update check pointing at localhost.

### 6. Single Docker image (`Dockerfile.web`) — with HTTPS
Multi-stage:
1. Build: `bun install` → `NITRO_PRESET=node-server bun run build` →
   `.output/server/index.mjs`.
2. Runtime: Node base image with PostgreSQL + openssl. A `supervisord` config
   starts `postgres` and the Node app. The entrypoint inits the DB from
   `db/init.sql` on first boot; uses `/certs/{fullchain,privkey}.pem` when
   mounted, else generates a self-signed cert; exports
   `NITRO_SSL_CERT`/`NITRO_SSL_KEY`; sets `DB_HOST=localhost` and
   `AUTH_MODE=none`; then starts supervisord. Port 443 exposed.

### 7. `.env.example`
Add `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` and `AUTH_MODE` with the
in-container defaults documented.

### 8. GitHub Actions (`.github/workflows/build-web.yml`)
On push to `main` and on manual dispatch: build `Dockerfile.web`, tag and push
to `ghcr.io/<org>/tdh-web:latest` (and `:sha`) using `GITHUB_TOKEN` with
`packages: write`. No secrets needed anymore — the image no longer bakes
Supabase keys. The homelab only pulls.

### 9. `DEPLOYMENT.md`
New section "Web-Version (Vollversion) als Ein-Container (HTTPS, Homelab/DMZ)":
- **Via GitHub (empfohlen)**: Workflow baut & pusht → Homelab `docker pull` +
  `docker run` (Kommando oben).
- **Lokal bauen**: `docker build -f Dockerfile.web -t tdh-web .` → `docker run`.
- Testmodus (Self-Signed) vs. Live (OPNsense-ACME-Certs mounten).
- OPN-Firewall: egress 443 für JRC/TED.
- Reset/Backup des Daten-Volumes, lokaler Cron-Endpunkt.
- Hinweis: kein Login — Zugriffsschutz über VLAN/Firewall.

## Testing limits (honest)
- The Lovable sandbox forces the Cloudflare Nitro preset, so a `node-server`
  build **cannot** be run/tested here. I verify with `tsgo` typecheck; the real
  build + Docker run happens on your server / in GitHub Actions.
- The Lovable preview keeps working (`DB_HOST` unset → Supabase path unchanged,
  login still active there).

## Later (separate step, not in this plan)
- Authentik/OIDC login via the `AUTH_MODE=oidc` branch in `auth.server.ts`.
