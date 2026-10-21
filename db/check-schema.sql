-- v2.61: verify migrated tables/columns even if migration markers exist.
\set ON_ERROR_STOP on
SELECT id, card_id, field, old_value, new_value, origin, source_label, source_url, proposal_id,
  changed_by, created_at FROM public.card_field_history LIMIT 0;
SELECT id, source_type, type_approval_number, raw_type_approval, manufacturer, card_name,
  certificate, jrc_date, eov, generation, device_type, updated_at FROM public.jrc_current_listing
  LIMIT 0;
SELECT id, created_at, last_seen_at, repeat_count, level, category, code, status, message, trigger,
  actor, app_version, duration_ms, http_status, source_type, request_id, run_id, boot_id,
  check_run_id, proposal_id, card_id, details, client_ip, user_agent, dedup_key, ack_at, ack_note
  FROM public.app_events LIMIT 0;
SELECT key, value, updated_at FROM public.app_settings LIMIT 0;
SELECT name, holder, acquired_at, expires_at FROM public.run_locks LIMIT 0;
SELECT id, name, vendor, families, patterns, note, sort, updated_at FROM public.platform_lines LIMIT 0;
SELECT certificate_issued_date, certificate_expiry_date, device_type FROM public.tachograph_cards LIMIT 0;
SELECT reviewed_at, reviewed_by FROM public.jrc_update_proposals LIMIT 0;
SELECT run_id, triggered_by, duration_ms FROM public.jrc_check_runs LIMIT 0;

-- The optional legacy cron configuration is required only AFTER migration 0010.
SELECT id, token, endpoint, enabled, created_at, updated_at FROM public.cron_config LIMIT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cron_config WHERE id = true AND length(token) > 0) THEN
    RAISE EXCEPTION 'Incomplete bootstrap: cron_config singleton/token missing; restore or repair the database';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.cron_config'::regclass
      AND tgname = 'update_cron_config_updated_at' AND NOT tgisinternal AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Required cron_config updated_at trigger missing or disabled';
  END IF;
END $$;
