-- v2.53: daily update scheduler, log retention and data quality.
--
-- app_settings: small key/value store for settings the admin changes in the
-- UI (scheduler on/off + time) and for state the server must remember across
-- restarts (when the last automatic run started/finished, the last data
-- quality summary). One JSON value per key.
CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text PRIMARY KEY,
  value       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- run_locks: a lease that keeps two update runs from working on the same
-- sources at once (scheduler vs. cron endpoint vs. a manual check). A lease
-- expires on its own, so a crashed process never blocks updates for good.
CREATE TABLE IF NOT EXISTS public.run_locks (
  name         text PRIMARY KEY,
  holder       text        NOT NULL,
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

-- Default schedule as agreed: daily 03:15 Europe/Berlin, switched on.
INSERT INTO public.app_settings (key, value)
VALUES ('scheduler', '{"enabled": true, "time": "03:15"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Retention (365 days ERROR/WARN, 90 days INFO, IP/UA cleared after 90 days)
-- filters on these columns.
CREATE INDEX IF NOT EXISTS app_events_created_idx ON public.app_events (created_at);
