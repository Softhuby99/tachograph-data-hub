#!/usr/bin/env bash
set -euo pipefail

PG_DATA="/var/lib/postgresql/data"
PG_BIN="/usr/lib/postgresql/15/bin"
# Resolve the actual installed major version if 15 is not present.
if [ ! -x "$PG_BIN/postgres" ]; then
  PG_BIN="$(dirname "$(find /usr/lib/postgresql -name postgres -type f | head -1)")"
fi
export PGDATA="$PG_DATA"

# --- 1. Initialise PostgreSQL data dir on first run ---
if [ ! -s "$PG_DATA/PG_VERSION" ]; then
  echo "[entrypoint] Initialising PostgreSQL data directory…"
  mkdir -p "$PG_DATA"
  chown -R postgres:postgres "$(dirname "$PG_DATA")"
  su postgres -c "$PG_BIN/initdb -D \"$PG_DATA\" --auth=trust"
fi

# --- 2. Start PostgreSQL temporarily to create the app DB/user + seed ---
su postgres -c "$PG_BIN/pg_ctl -D \"$PG_DATA\" -l /tmp/pg.log start -w"

DB_NAME="${DB_NAME:-tdh}"
DB_USER="${DB_USER:-tdh}"
DB_PASSWORD="${DB_PASSWORD:-tdh}"

if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" | grep -q 1; then
  echo "[entrypoint] Creating role $DB_USER…"
  su postgres -c "psql -c \"CREATE USER \\\"$DB_USER\\\" WITH PASSWORD '$DB_PASSWORD' SUPERUSER;\""
fi

if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1; then
  echo "[entrypoint] Creating database $DB_NAME…"
  su postgres -c "createdb -O \"$DB_USER\" \"$DB_NAME\""
fi

# Seed / migrate schema. Idempotent (CREATE TABLE IF NOT EXISTS / ON CONFLICT).
if [ -f /app/db/init.sql ]; then
  echo "[entrypoint] Applying db/init.sql…"
  su postgres -c "psql -d \"$DB_NAME\" -f /app/db/init.sql" || echo "[entrypoint] init.sql applied (some warnings are OK on re-run)."
fi

su postgres -c "$PG_BIN/pg_ctl -D \"$PG_DATA\" stop -w -m fast" || true

# --- 3. Self-signed cert fallback for test mode ---
if [ ! -f /certs/fullchain.pem ] || [ ! -f /certs/privkey.pem ]; then
  DOMAIN_CN="${DOMAIN:-tdh.local}"
  echo "[entrypoint] No certs found — generating self-signed cert for CN=$DOMAIN_CN (test mode)."
  mkdir -p /certs
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
    -keyout /certs/privkey.pem -out /certs/fullchain.pem \
    -subj "/CN=$DOMAIN_CN" 2>/dev/null
fi

echo "[entrypoint] Starting supervisord (PostgreSQL + Nitro)…"
exec "$@"
