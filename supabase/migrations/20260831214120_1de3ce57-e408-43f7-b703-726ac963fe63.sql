CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE public.cron_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  endpoint text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.cron_config TO service_role;

ALTER TABLE public.cron_config ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_cron_config_updated_at
  BEFORE UPDATE ON public.cron_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.cron_config (id, endpoint)
VALUES (true, 'https://project--4772aa26-e8ec-42d4-8d0f-ec89a6c7398e-dev.lovable.app/api/public/jrc-check');

SELECT cron.schedule(
  'jrc-daily-update-check',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT endpoint FROM public.cron_config WHERE id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT token FROM public.cron_config WHERE id)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  WHERE (SELECT enabled FROM public.cron_config WHERE id);
  $$
);
