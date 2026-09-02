# Tachograph Cards Info Tool — Local Docker Deployment

Single-container deployment of the **full web version**: TanStack Start (Nitro
node-server) + PostgreSQL, with native HTTPS. No Lovable/Supabase backend, no
nginx, no login (by default). Runs entirely in one Docker container.

```
┌────────────────────── single container (port 443) ──────────────────────┐
│  supervisord                                                            │
│   ├─ PostgreSQL  (data in /var/lib/postgresql/data  — persistent volume) │
│   └─ node .output/server/index.mjs  (Nitro HTTPS, /app)                 │
└─────────────────────────────────────────────────────────────────────────┘
        ▲                                  ▲
   browser HTTPS              outbound TCP 443 → JRC / TED update checks
   (port 443:443)
```

---

## 1. What you need

- Docker Engine + Compose plugin (or `docker run`) on the host (Debian/Proxmox host, VLAN 2/DMZ is fine)
- Port 443 free on the host
- Outbound internet (TCP 443) to `dtc.jrc.ec.europa.eu` / `ted.europa.eu` for update checks
- Optional: a real TLS certificate for production (test mode generates a self-signed one)

## 2. Environment (`.env`)

Copy `.env.example` to `.env` and adjust:

```bash
PORT=443
AUTH_MODE=none                 # no login; set "oidc" later for Authentik (step 2)
DB_HOST=127.0.0.1             # any non-empty value enables local PostgreSQL
DB_PORT=5432
DB_NAME=tdh
DB_USER=tdh
DB_PASSWORD=changeme
NITRO_SSL_CERT=/certs/fullchain.pem
NITRO_SSL_KEY=/certs/privkey.pem
DOMAIN=tdh.example.com         # CN for the self-signed cert in test mode
```

> `DB_HOST` non-empty = local PostgreSQL mode. Leave `DB_HOST` unset to fall
> back to the Lovable/Supabase backend (used by the preview).

## 3. TLS certificates

**Test mode (self-signed):** leave `/certs` empty. The entrypoint generates a
self-signed cert for `DOMAIN` automatically. Browser warnings are expected.

**Live mode (real cert via OPNsense ACME / Let's Encrypt):**
1. OPNsense ACME client issues a certificate for your domain (Cloudflare DNS-01 or HTTP-01).
2. Automate copying the issued `fullchain.pem` and `privkey.pem` to the host directory `./certs/`.
3. Mount it read-only into the container at `/certs`:
   ```
   -v ./certs:/certs:ro
   ```
4. Set `DOMAIN` to your real hostname.

## 4. Run the prebuilt image (from GitHub Container Registry)

```bash
mkdir -p ./certs ./pgdata
docker run -d --name tacho \
  --restart unless-stopped \
  -p 443:443 \
  -v "$PWD/pgdata:/var/lib/postgresql/data" \
  -v "$PWD/certs:/certs:ro" \
  --env-file .env \
  ghcr.io/<owner>/tachograph-cards-web:latest
```

Replace `<owner>` with your GitHub owner/org name. The image is built by the
GitHub Actions workflow `.github/workflows/build-web.yml` (see section 6).

First boot initialises PostgreSQL, applies `db/init.sql` (schema + seed data),
and starts the Nitro server with HTTPS on port 443.

## 5. Build the image locally (without GitHub)

```bash
docker build -f Dockerfile.web -t tacho-web .
docker run -d --name tacho -p 443:443 \
  -v "$PWD/pgdata:/var/lib/postgresql/data" \
  -v "$PWD/certs:/certs:ro" \
  --env-file .env tacho-web
```

## 6. Build via GitHub Actions → GHCR

The workflow `.github/workflows/build-web.yml` builds and pushes the image to
GHCR on every push to `main` and on manual dispatch (`Actions` tab →
"Build Web Docker image" → "Run workflow"). It tags `latest` and the short
commit SHA. Required permission: `packages: write` (default for `GITHUB_TOKEN`).

Pull a specific build:

```bash
docker pull ghcr.io/<owner>/tachograph-cards-web:latest
docker pull ghcr.io/<owner>/tachograph-cards-web:<short-sha>
```

## 7. Verify

```bash
curl -k https://localhost/            # app loads (self-signed: -k)
docker exec tacho psql -U tdh -d tdh -c "SELECT count(*) FROM tachograph_cards;"
```

In the UI: filters (Country / Generation / Manufacturer), detail view with flag,
Market Analytics, Approval Timeline, World Map, and **Update Monitor** →
"Check for updates" (fetches JRC/TED sources; proposals land in the database).

## 8. Updating the app

```bash
docker pull ghcr.io/<owner>/tachograph-cards-web:latest
docker stop tacho && docker rm tacho
docker run -d --name tacho ... ghcr.io/<owner>/tachograph-cards-web:latest
```

The PostgreSQL volume (`./pgdata`) persists across rebuilds, so manual edits,
update proposals and check-run history are retained.

## 9. Backups

```bash
docker exec tacho pg_dump -U tdh tdh > backup_$(date +%Y%m%d).sql
# restore:
docker exec -i tacho psql -U tdh -d tdh < backup_YYYYMMDD.sql
```

## 10. Login (planned, step 2)

`AUTH_MODE=none` disables all auth — editing and update checks are available to
everyone. For a later login layer (Authentik/OIDC), set `AUTH_MODE=oidc` and
provide `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`. No code changes
to the server functions are required; `optionalAuth` already switches between
the local identity and Supabase auth. Alternatively, place the container behind
an Authentik reverse proxy and let it handle auth at the edge.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Browser TLS warning | Expected in test mode (self-signed). Add exception or use a real cert in `./certs`. |
| Update check shows 0 proposals | Confirm outbound TCP 443 to `dtc.jrc.ec.europa.eu`; check `docker logs tacho`. |
| `DB_HOST` set but no data | First boot runs `db/init.sql`; verify with the `psql count` above. |
| Flags missing | Container/client needs egress to `flagcdn.com`; emoji fallback otherwise. |
| Want HTTP only / behind proxy | Set `PORT=3000`, unset `NITRO_SSL_CERT`/`NITRO_SSL_KEY`, and reverse-proxy in front. |
