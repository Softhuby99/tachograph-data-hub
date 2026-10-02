-- v2.52: operations log ("Betriebsprotokoll") shown under Tools → Log.
--
-- One row per noteworthy event: failed update sources, implausible parses,
-- limits that deferred work, failed app actions, admin token checks, proxy
-- problems, server errors, start-up and migrations. Successful update runs get
-- ONE summary row per run; per-source results stay in jrc_check_runs, which an
-- event references via check_run_id instead of copying it.
--
-- Recurring identical problems are folded into one open row (dedup_key,
-- repeat_count, last_seen_at) until it is acknowledged. Auth events are never
-- folded. Rows are never deleted by hand; retention (365 days for ERROR/WARN,
-- 90 days for INFO, IP/user agent cleared after 90 days) runs with the daily
-- scheduler (v2.53). Readable only through admin-checked server functions.
CREATE TABLE IF NOT EXISTS public.app_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  repeat_count  integer     NOT NULL DEFAULT 1,
  level         text        NOT NULL CHECK (level IN ('ERROR', 'WARN', 'INFO')),
  category      text        NOT NULL,
  code          text        NOT NULL,
  status        text        NOT NULL DEFAULT '',
  message       text        NOT NULL DEFAULT '',
  trigger       text        NOT NULL DEFAULT 'system',
  actor         text        NOT NULL DEFAULT '',
  app_version   text        NOT NULL DEFAULT '',
  duration_ms   integer,
  http_status   integer,
  source_type   text        NOT NULL DEFAULT '',
  request_id    text        NOT NULL DEFAULT '',
  run_id        uuid,
  boot_id       uuid,
  check_run_id  uuid,
  proposal_id   uuid,
  card_id       uuid,
  details       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  client_ip     text        NOT NULL DEFAULT '',
  user_agent    text        NOT NULL DEFAULT '',
  dedup_key     text,
  ack_at        timestamptz,
  ack_note      text        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS app_events_last_seen_idx ON public.app_events (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS app_events_level_idx ON public.app_events (level, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS app_events_category_idx ON public.app_events (category, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS app_events_run_idx ON public.app_events (run_id);
CREATE INDEX IF NOT EXISTS app_events_auth_ip_idx ON public.app_events (client_ip, created_at)
  WHERE category = 'auth';
-- At most one open (unacknowledged) row per dedup key.
CREATE UNIQUE INDEX IF NOT EXISTS app_events_open_dedup_idx ON public.app_events (dedup_key)
  WHERE dedup_key IS NOT NULL AND ack_at IS NULL;

-- Update runs: which run a per-source row belongs to and who started it
-- (manual / cron / scheduler), so Tools can show "last successful automatic
-- check per source".
ALTER TABLE public.jrc_check_runs ADD COLUMN IF NOT EXISTS run_id uuid;
ALTER TABLE public.jrc_check_runs ADD COLUMN IF NOT EXISTS triggered_by text NOT NULL DEFAULT 'manual';
ALTER TABLE public.jrc_check_runs ADD COLUMN IF NOT EXISTS duration_ms integer;
CREATE INDEX IF NOT EXISTS jrc_check_runs_created_idx ON public.jrc_check_runs (created_at DESC);
