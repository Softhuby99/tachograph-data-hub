-- v2.61: fail closed on an incomplete legacy snapshot. No seed replay.
\set ON_ERROR_STOP on
SELECT id, country, country_flag, generation, application, current_manufacturer,
  current_manufacturer_normalized, chip_platform_vendor, security_certificate, chip_certificate,
  type_approval_number, certified_security_platform, certificate_holder, date_status,
  issued_by_authority, jrc_interoperability_status, functional_certificate_lab,
  security_certificate_lab, tachograph_application_os, distinction_from_manufacturer,
  jrc_certificate_source, primary_source, latest_tender, winner_contractor, procurement_status,
  procurement_scope, tender_source, verification_note, data_reference_date, created_at, updated_at
  FROM public.tachograph_cards LIMIT 0;
SELECT id, fingerprint, kind, card_id, country, generation, jrc_manufacturer, jrc_card_name,
  jrc_certificate, jrc_date, jrc_eov, jrc_type_approval, source_url, changes, status, created_at,
  updated_at, source_type, source_label, title, payload FROM public.jrc_update_proposals LIMIT 0;
SELECT id, source_url, rows_parsed, proposals_created, status, message, created_at, source_type FROM
  public.jrc_check_runs LIMIT 0;
SELECT id, source_type, entry_key, fingerprint, created_at, updated_at FROM
  public.jrc_source_snapshots LIMIT 0;
SELECT id, card_id, patch, edited_by, created_at, updated_at FROM public.tachograph_card_overrides LIMIT 0;
SELECT id, card_id, field, old_value, new_value, origin, source_label, source_url, proposal_id,
  changed_by, created_at FROM public.card_field_history LIMIT 0;
SELECT id, token, endpoint, enabled, created_at, updated_at FROM public.cron_config LIMIT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cron_config WHERE id = true AND length(token) > 0) THEN
    RAISE EXCEPTION 'Incomplete bootstrap: cron_config singleton/token missing; restore or repair the database';
  END IF;
  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'Incomplete bootstrap: update_updated_at_column function missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('tachograph_card_overrides', 'update_tachograph_card_overrides_updated_at'),
      ('cron_config', 'update_cron_config_updated_at'),
      ('jrc_update_proposals', 'update_jrc_update_proposals_updated_at')
    ) AS expected(tbl, trigger_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || expected.tbl)
      AND t.tgname = expected.trigger_name AND NOT t.tgisinternal AND t.tgenabled <> 'D'
    )
  ) THEN
    RAISE EXCEPTION 'Incomplete bootstrap: required updated_at trigger missing';
  END IF;
END $$;

-- Without a marker there is no proof that the old seed import finished.
-- Empty legacy seed tables are ambiguous, so require manual review, not reseeding.
SELECT to_regclass('public.bootstrap_state') IS NOT NULL AS has_marker_table \gset
\if :has_marker_table
SELECT EXISTS (SELECT 1 FROM public.bootstrap_state WHERE id = true) AS completed \gset
\else
\set completed false
\endif
\if :completed
\else
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tachograph_cards)
     OR NOT EXISTS (SELECT 1 FROM public.jrc_source_snapshots) THEN
    RAISE EXCEPTION 'Unmarked legacy database has empty seed tables; restore or verify its contents manually. No seeds were replayed';
  END IF;
END $$;
\endif
