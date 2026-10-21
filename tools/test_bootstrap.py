#!/usr/bin/env python3
"""Integration tests using a disposable PostgreSQL cluster (see DEPLOYMENT.md).
Only creates/drops randomly named tdh_bootstrap_test_* databases; no app DB used.
Requires psql/createdb/dropdb on PATH and PGHOST pointing at the test server.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        if not os.environ.get('PGHOST'):
            self.skipTest('Set PGHOST to a disposable PostgreSQL test server')
        self.name = 'tdh_bootstrap_test_' + uuid.uuid4().hex
        subprocess.run(['createdb', self.name], check=True, capture_output=True)
        self.addCleanup(lambda: subprocess.run(['dropdb', '--if-exists', self.name],
                                              check=True, capture_output=True))
        self.temp = tempfile.TemporaryDirectory(prefix='tdh-bootstrap-')
        self.addCleanup(self.temp.cleanup)
        self.dbdir = Path(self.temp.name) / 'db'
        shutil.copytree(ROOT / 'db', self.dbdir)

    def sql(self, text):
        return subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', self.name,
                               '-c', text], check=True, capture_output=True, text=True).stdout.strip()

    def bootstrap(self, success=True):
        result = subprocess.run(['bash', str(ROOT / 'docker/bootstrap-db.sh')],
                                env={**os.environ, 'DB_NAME': self.name,
                                     'TDH_DB_DIR': str(self.dbdir)},
                                capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result

    def legacy(self):
        self.bootstrap()
        self.sql('DROP TABLE public.bootstrap_state')
        self.sql("DELETE FROM public.schema_migrations WHERE filename='0010_legacy_cron_config.sql'")

    def data_digest(self):
        # Include actual data plus manual edits/history/settings; exclude lifecycle log.
        tables = ['tachograph_cards', 'tachograph_card_overrides', 'card_field_history',
                  'jrc_update_proposals', 'jrc_source_snapshots', 'cron_config',
                  'platform_lines', 'app_settings']
        return [self.sql(f"SELECT md5(COALESCE(string_agg(row_to_json(t)::text, '' "
                              f"ORDER BY row_to_json(t)::text), '')) FROM public.{t} t")
                for t in tables]

    def test_fresh_database(self):
        self.bootstrap()
        self.assertEqual(self.sql('SELECT origin FROM public.bootstrap_state'), 'snapshot')
        self.assertEqual(self.sql('SELECT count(*) FROM public.schema_migrations'), '10')
        self.assertEqual(self.sql('SELECT length(token) FROM public.cron_config'), '64')
        self.assertGreater(int(self.sql('SELECT count(*) FROM public.tachograph_cards')), 0)
        self.assertGreater(int(self.sql('SELECT count(*) FROM public.jrc_source_snapshots')), 0)
        self.assertEqual(self.sql("SELECT count(*) FROM pg_extension WHERE extname='pgcrypto'"), '1')

    def test_restart_preserves_existing_data_and_marker(self):
        self.bootstrap()
        self.sql("UPDATE public.tachograph_cards SET verification_note='TEST user edit'")
        before = self.data_digest()
        marker = self.sql('SELECT completed_at FROM public.bootstrap_state')
        self.bootstrap()
        self.assertEqual(self.data_digest(), before)
        self.assertEqual(self.sql('SELECT completed_at FROM public.bootstrap_state'), marker)

    def test_snapshot_error_rolls_back_then_retry_succeeds(self):
        init = self.dbdir / 'init.sql'
        original = init.read_text()
        init.write_text(original.replace('CREATE TABLE public.bootstrap_state',
                                        'SELECT 1/0;\nCREATE TABLE public.bootstrap_state'))
        self.bootstrap(False)
        self.assertEqual(self.sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"), '0')
        self.assertEqual(self.sql("SELECT count(*) FROM pg_extension WHERE extname='pgcrypto'"), '0')
        init.write_text(original)
        self.bootstrap()

    def test_missing_seed_rolls_back(self):
        (self.dbdir / 'seed_cards.sql').unlink()
        self.bootstrap(False)
        self.assertEqual(self.sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"), '0')

    def test_legacy_upgrade_preserves_business_data(self):
        self.legacy()
        self.sql("UPDATE public.tachograph_cards SET verification_note='Legacy edit'")
        self.sql("INSERT INTO public.tachograph_card_overrides(card_id,patch) "
                 "SELECT id, '{\"country\":\"Manual country\"}' FROM public.tachograph_cards LIMIT 1")
        self.sql("INSERT INTO public.card_field_history(card_id,field,old_value,new_value) "
                 "SELECT id, 'verification_note', '', 'Legacy edit' FROM public.tachograph_cards LIMIT 1")
        self.sql("INSERT INTO public.jrc_update_proposals(fingerprint,country,status) "
                 "VALUES ('legacy-test', 'Germany', 'pending')")
        self.sql("UPDATE public.app_settings SET value='{\"enabled\":false,\"time\":\"04:00\"}' "
                 "WHERE key='scheduler'")
        self.sql("UPDATE public.platform_lines SET note='User platform edit'")
        self.sql("UPDATE public.cron_config SET endpoint='https://example.invalid/cron', enabled=true")
        before = self.data_digest()
        self.bootstrap()
        self.assertEqual(self.data_digest(), before)
        self.assertEqual(self.sql('SELECT origin FROM public.bootstrap_state'), 'legacy_validated')

    def test_legacy_with_pending_migrations(self):
        self.legacy()
        self.sql('DROP TABLE public.app_events, public.app_settings, public.run_locks, '
                 'public.platform_lines, public.jrc_current_listing')
        self.sql("DELETE FROM public.schema_migrations WHERE filename >= '0006'")
        cards = self.sql("SELECT md5(string_agg(row_to_json(t)::text, '' ORDER BY id)) "
                         "FROM public.tachograph_cards t")
        self.bootstrap()
        self.assertEqual(self.sql('SELECT count(*) FROM public.schema_migrations'), '10')
        self.assertEqual(self.sql("SELECT md5(string_agg(row_to_json(t)::text, '' ORDER BY id)) "
                                  "FROM public.tachograph_cards t"), cards)
        self.assertEqual(self.sql('SELECT origin FROM public.bootstrap_state'), 'legacy_validated')

    def test_legacy_without_cron_config_is_upgraded(self):
        self.legacy()
        self.sql('DROP TABLE public.cron_config')
        self.sql('DROP EXTENSION pgcrypto')
        before = self.sql("SELECT md5(string_agg(row_to_json(t)::text, '' ORDER BY id)) "
                          "FROM public.tachograph_cards t")
        self.bootstrap()
        self.assertEqual(self.sql('SELECT length(token) FROM public.cron_config'), '64')
        self.assertEqual(self.sql('SELECT enabled FROM public.cron_config'), 'f')
        self.assertEqual(self.sql("SELECT md5(string_agg(row_to_json(t)::text, '' ORDER BY id)) "
                                  "FROM public.tachograph_cards t"), before)

    def test_cron_repair_failure_rolls_back_and_retries(self):
        self.legacy()
        self.sql('DROP TABLE public.cron_config')
        self.sql('DROP EXTENSION pgcrypto')
        f = self.dbdir / 'migrations/0010_legacy_cron_config.sql'
        original = f.read_text()
        f.write_text(original + '\nSELECT 1/0;\n')
        self.bootstrap(False)
        self.assertEqual(self.sql("SELECT to_regclass('public.cron_config') IS NULL"), 't')
        self.assertEqual(self.sql("SELECT count(*) FROM pg_extension WHERE extname='pgcrypto'"), '0')
        self.assertEqual(self.sql("SELECT count(*) FROM public.schema_migrations "
                                  "WHERE filename='0010_legacy_cron_config.sql'"), '0')
        f.write_text(original)
        self.bootstrap()
        token = self.sql('SELECT token FROM public.cron_config')
        self.bootstrap()
        self.assertEqual(self.sql('SELECT token FROM public.cron_config'), token)

    def test_missing_cron_after_recorded_migration_is_not_silently_recreated(self):
        self.bootstrap()
        self.sql('DROP TABLE public.cron_config')
        self.bootstrap(False)

    def test_partial_legacy_schema_is_rejected_without_seed_replay(self):
        self.legacy()
        self.sql('DROP TABLE public.jrc_check_runs')
        before = self.sql('SELECT count(*) FROM public.tachograph_cards')
        self.bootstrap(False)
        self.assertEqual(self.sql('SELECT count(*) FROM public.tachograph_cards'), before)
        self.assertEqual(self.sql("SELECT to_regclass('public.bootstrap_state') IS NULL"), 't')

    def test_partial_schema_without_cards_is_rejected(self):
        self.sql('CREATE TABLE public.orphan(value text)')
        self.bootstrap(False)
        self.assertEqual(self.sql("SELECT to_regclass('public.tachograph_cards') IS NULL"), 't')

    def test_missing_column_is_rejected_even_with_marker(self):
        self.bootstrap()
        self.sql('ALTER TABLE public.tachograph_cards DROP COLUMN primary_source')
        self.bootstrap(False)

    def test_empty_unmarked_legacy_is_rejected(self):
        self.legacy()
        self.sql('DELETE FROM public.jrc_source_snapshots')
        self.bootstrap(False)
        self.assertEqual(self.sql('SELECT count(*) FROM public.jrc_source_snapshots'), '0')

    def test_migration_error_rolls_back_and_can_retry(self):
        self.bootstrap()
        f = self.dbdir / 'migrations/9999_test.sql'
        f.write_text('CREATE TABLE public.test_migration(id integer); SELECT 1/0;')
        self.bootstrap(False)
        self.assertEqual(self.sql("SELECT to_regclass('public.test_migration') IS NULL"), 't')
        self.assertEqual(self.sql("SELECT count(*) FROM public.schema_migrations WHERE filename='9999_test.sql'"), '0')
        f.write_text('CREATE TABLE public.test_migration(id integer);')
        self.bootstrap()
        self.assertEqual(self.sql("SELECT to_regclass('public.test_migration') IS NOT NULL"), 't')
        self.assertEqual(self.sql("SELECT count(*) FROM public.schema_migrations WHERE filename='9999_test.sql'"), '1')

    def test_marker_insert_failure_rolls_back_migration_too(self):
        self.bootstrap()
        self.sql("CREATE FUNCTION public.reject_marker() RETURNS trigger LANGUAGE plpgsql AS $$ "
                 "BEGIN RAISE EXCEPTION 'injected marker failure'; END $$; "
                 "CREATE TRIGGER reject_marker BEFORE INSERT ON public.schema_migrations "
                 "FOR EACH ROW EXECUTE FUNCTION public.reject_marker()")
        (self.dbdir / 'migrations/9999_test.sql').write_text('CREATE TABLE public.test_migration(id integer);')
        self.bootstrap(False)
        self.assertEqual(self.sql("SELECT to_regclass('public.test_migration') IS NULL"), 't')

    def test_missing_migrated_table_is_rejected_despite_migration_marker(self):
        self.bootstrap()
        self.sql('DROP TABLE public.run_locks')
        self.bootstrap(False)


if __name__ == '__main__':
    unittest.main(verbosity=2)
