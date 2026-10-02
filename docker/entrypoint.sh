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
  su postgres -c "$PG_BIN/initdb -D \"$PG_DATA\" --auth-local=trust --auth-host=scram-sha-256"
fi

# --- 1b. Client authentication (v2.49) — rewritten on every start so existing
# data directories (created with --auth=trust) are corrected as well.
#  * Unix socket: trust, but the socket is created with permissions 0770
#    (group postgres), so only root and postgres can reach it — i.e. the
#    entrypoint and `docker exec tacho psql -U postgres …`. The web server runs
#    as tdhweb and cannot use it.
#  * TCP (127.0.0.1 / ::1): password (scram-sha-256) for everyone, including
#    the web app. Only the read-only audit role tdh_ro keeps trust: it has no
#    password and can only read.
if [ ! -f "$PG_DATA/pg_hba.conf.pre-v249" ] && [ -f "$PG_DATA/pg_hba.conf" ]; then
  cp -p "$PG_DATA/pg_hba.conf" "$PG_DATA/pg_hba.conf.pre-v249"
fi
cat > "$PG_DATA/pg_hba.conf" <<'HBA'
# Managed by docker/entrypoint.sh (v2.49) — rewritten on every container start.
# TYPE  DATABASE  USER     ADDRESS        METHOD
local   all       all                     trust
host    all       tdh_ro   127.0.0.1/32   trust
host    all       tdh_ro   ::1/128        trust
host    all       all      127.0.0.1/32   scram-sha-256
host    all       all      ::1/128        scram-sha-256
HBA
chown postgres:postgres "$PG_DATA/pg_hba.conf"
chmod 600 "$PG_DATA/pg_hba.conf"

# --- 2. Start PostgreSQL temporarily to create the app DB/user + seed ---
su postgres -c "$PG_BIN/pg_ctl -D \"$PG_DATA\" -o '-c unix_socket_permissions=0770' -l /tmp/pg.log start -w"

DB_NAME="${DB_NAME:-tdh}"
DB_USER="${DB_USER:-tdh}"
# No default password — the deployment must set DB_PASSWORD explicitly.
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set (e.g. in /opt/TDH/.env)}"

# Role name and password reach psql as variables (runuser, no shell string),
# so quotes in DB_PASSWORD can neither break the start nor inject SQL.
if ! runuser -u postgres -- psql -tA -v u="$DB_USER" <<'SQL' | grep -q 1
SELECT 1 FROM pg_roles WHERE rolname = :'u';
SQL
then
  echo "[entrypoint] Creating role $DB_USER…"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v u="$DB_USER" <<'SQL'
CREATE ROLE :"u" LOGIN;
SQL
fi
# v2.49: the app role is never a superuser (it used to be created with
# SUPERUSER). It owns the app tables, which is all it needs. The password is
# (re)applied on every start so it is stored as scram-sha-256 and always
# matches DB_PASSWORD from the deployment env.
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v u="$DB_USER" -v pw="$DB_PASSWORD" >/dev/null <<'SQL'
SET password_encryption = 'scram-sha-256';
ALTER ROLE :"u" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'pw';
SQL

if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1; then
  echo "[entrypoint] Creating database $DB_NAME…"
  su postgres -c "createdb -O \"$DB_USER\" \"$DB_NAME\""
fi

# The bundled SQL is a complete initial snapshot, not a recurring migration.
# Only load it into a new/empty database so container replacements do not try
# to insert the same fixed UUIDs into a persistent volume again.
HAS_SCHEMA="$(su postgres -c "psql -d \"$DB_NAME\" -tAc \"SELECT to_regclass('public.tachograph_cards') IS NOT NULL\"")"
if [ "$HAS_SCHEMA" != "t" ] && [ -f /app/db/init.sql ]; then
  echo "[entrypoint] Applying initial database snapshot…"
  su postgres -c "psql -v ON_ERROR_STOP=1 -d \"$DB_NAME\" -f /app/db/init.sql"
else
  echo "[entrypoint] Existing database detected; skipping initial snapshot."
fi

# --- 2b. Apply incremental schema migrations (idempotent, tracked) ---
su postgres -c "psql -v ON_ERROR_STOP=1 -d \"$DB_NAME\" -c \"CREATE TABLE IF NOT EXISTS public.schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());\""

if [ -d /app/db/migrations ]; then
  for f in $(ls /app/db/migrations/*.sql 2>/dev/null | sort); do
    name="$(basename "$f")"
    applied="$(su postgres -c "psql -d \"$DB_NAME\" -tAc \"SELECT 1 FROM public.schema_migrations WHERE filename='$name'\"")"
    if [ "$applied" = "1" ]; then
      echo "[entrypoint] Migration $name already applied."
      continue
    fi
    echo "[entrypoint] Applying migration $name…"
    su postgres -c "psql -v ON_ERROR_STOP=1 -d \"$DB_NAME\" -f \"$f\""
    su postgres -c "psql -v ON_ERROR_STOP=1 -d \"$DB_NAME\" -c \"INSERT INTO public.schema_migrations (filename) VALUES ('$name') ON CONFLICT DO NOTHING;\""
  done
fi

# Ensure ownership of everything in the app schema stays with the app user.
su postgres -c "psql -d \"$DB_NAME\" -tAc \"SELECT 'ALTER TABLE public.'||tablename||' OWNER TO \\\"$DB_USER\\\";' FROM pg_tables WHERE schemaname='public'\"" \
  | su postgres -c "psql -v ON_ERROR_STOP=1 -d \"$DB_NAME\"" >/dev/null || true

su postgres -c "$PG_BIN/pg_ctl -D \"$PG_DATA\" stop -w -m fast" || true

# --- 3. Self-signed cert fallback for test mode ---
# Skip entirely when native TLS is disabled (NITRO_SSL_CERT empty) — e.g. when
# the app runs plain HTTP behind a reverse proxy. Also skip when the certs
# volume is read-only and already non-empty, since we couldn't write anyway.
if [ -n "${NITRO_SSL_CERT:-}" ] && { [ ! -f /certs/fullchain.pem ] || [ ! -f /certs/privkey.pem ]; }; then
  DOMAIN_CN="${DOMAIN:-tdh.local}"
  if [ -w /certs ]; then
    echo "[entrypoint] No certs found — generating self-signed cert for CN=$DOMAIN_CN (test mode)."
    mkdir -p /certs
    openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
      -keyout /certs/privkey.pem -out /certs/fullchain.pem \
      -subj "/CN=$DOMAIN_CN" 2>/dev/null
  else
    echo "[entrypoint] Certs missing and /certs not writable — Nitro will start without TLS."
  fi
fi

# --- 4. TLS material for the unprivileged web server (v2.49) ---
# /certs is mounted read-only and the key is usually root-only. Copy cert and
# key to a tmpfs-like location owned by tdhweb and point Nitro there.
if [ -n "${NITRO_SSL_CERT:-}" ] && [ -f "${NITRO_SSL_CERT}" ] && [ -f "${NITRO_SSL_KEY:-}" ]; then
  install -d -m 0750 -o tdhweb -g tdhweb /run/tdh-certs
  install -m 0644 -o tdhweb -g tdhweb "$NITRO_SSL_CERT" /run/tdh-certs/fullchain.pem
  install -m 0600 -o tdhweb -g tdhweb "$NITRO_SSL_KEY" /run/tdh-certs/privkey.pem
  export NITRO_SSL_CERT=/run/tdh-certs/fullchain.pem
  export NITRO_SSL_KEY=/run/tdh-certs/privkey.pem
fi

echo "[entrypoint] Starting supervisord (PostgreSQL + Nitro as tdhweb)…"
exec "$@"
