-- v2.63: some working local installations use CRON_SECRET and never had the
-- optional DB-backed cron configuration. Add it without replaying any seeds
-- or changing an existing token/endpoint/enabled value.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE TABLE IF NOT EXISTS public.cron_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  endpoint text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.cron_config (id, endpoint, enabled)
VALUES (true, '', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.cron_config'::regclass
      AND tgname = 'update_cron_config_updated_at' AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER update_cron_config_updated_at
      BEFORE UPDATE ON public.cron_config
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
