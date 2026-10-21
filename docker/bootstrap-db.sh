#!/usr/bin/env bash
# Run as the PostgreSQL administrator, after the app database has been created.
set -euo pipefail
DB_NAME="${DB_NAME:?DB_NAME must be set}"
TDH_DB_DIR="${TDH_DB_DIR:-/app/db}"
psql_db() { psql -X -v ON_ERROR_STOP=1 -d "$DB_NAME" "$@"; }

# Never replay fixed seed UUIDs into an existing/partially initialised schema.
HAS_CARDS="$(psql_db -tAc "SELECT to_regclass('public.tachograph_cards') IS NOT NULL")"
if [ "$HAS_CARDS" != "t" ]; then
  TABLES="$(psql_db -tAc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p')")"
  if [ "$TABLES" != "0" ]; then
    echo "[bootstrap] FATAL: partial or unrelated public schema without tachograph_cards; restore/repair the database. No snapshot replayed." >&2
    exit 1
  fi
  echo "[bootstrap] Applying atomic initial snapshot…"
  psql_db -f "$TDH_DB_DIR/init.sql"
else
  echo "[bootstrap] Existing database; seeds will not be replayed."
fi

# A legacy install has no completion marker. Check core snapshot columns,
# essential triggers BEFORE applying migrations. Optional legacy cron metadata
# is added by migration 0010 and checked afterwards.
psql_db -q -o /dev/null -f "$TDH_DB_DIR/check-bootstrap.sql"

psql_db -c "CREATE TABLE IF NOT EXISTS public.schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());"

# v2.52: migration results go to the operations log (app_events) once that
# table exists. Values reach psql as variables, never via shell strings.
log_migration_event() { # level code message migrations
  psql_db -q -v lvl="$1" -v code="$2" -v msg="$3" -v names="$4" \
    >/dev/null 2>&1 <<'SQL' || true
SELECT to_regclass('public.app_events') IS NOT NULL AS has_events \gset
\if :has_events
INSERT INTO public.app_events (level, category, code, status, message, details)
VALUES (:'lvl', 'system', :'code', CASE WHEN :'lvl' = 'ERROR' THEN 'failed' ELSE 'success' END,
        :'msg', jsonb_build_object('migrations', :'names'));
\endif
SQL
}

APPLIED_NOW=""
shopt -s nullglob
for f in "$TDH_DB_DIR"/migrations/*.sql; do
  name="$(basename "$f")"
  # Filenames are bundled with the image, but still use psql variables in SQL.
  applied="$(psql_db -tA -v filename="$name" <<'SQL'
SELECT 1 FROM public.schema_migrations WHERE filename = :'filename';
SQL
)"
  if [ "$applied" = "1" ]; then
    echo "[bootstrap] Migration $name already applied."
    continue
  fi
  echo "[bootstrap] Applying migration $name…"
  if ! psql_db --single-transaction -v filename="$name" -f "$f" -f - <<'SQL'
INSERT INTO public.schema_migrations (filename) VALUES (:'filename');
SQL
  then
    echo "[bootstrap] FATAL: migration $name failed; changes and migration marker rolled back." >&2
    log_migration_event ERROR system.migration.failed "Schema migration $name failed — container start aborted" "$name"
    exit 1
  fi
  APPLIED_NOW="${APPLIED_NOW:+$APPLIED_NOW, }$name"
done

# Also check migrated objects when filenames were already marked as applied.
psql_db -q -o /dev/null -f "$TDH_DB_DIR/check-schema.sql"

# Adopt a complete legacy database only AFTER all checks/migrations succeeded.
psql_db --single-transaction -f - <<'SQL'
CREATE TABLE IF NOT EXISTS public.bootstrap_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  origin text NOT NULL CHECK (origin IN ('snapshot', 'legacy_validated')),
  completed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.bootstrap_state (id, origin) VALUES (true, 'legacy_validated')
ON CONFLICT (id) DO NOTHING;
SQL
if [ -n "$APPLIED_NOW" ]; then
  log_migration_event INFO system.migration.applied "Schema migrations applied: $APPLIED_NOW" "$APPLIED_NOW"
fi
