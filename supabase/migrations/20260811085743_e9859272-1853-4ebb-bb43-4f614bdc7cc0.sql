CREATE TABLE public.jrc_update_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'changed',
  card_id uuid REFERENCES public.tachograph_cards(id) ON DELETE CASCADE,
  country text NOT NULL DEFAULT '',
  generation text NOT NULL DEFAULT '',
  jrc_manufacturer text NOT NULL DEFAULT '',
  jrc_card_name text NOT NULL DEFAULT '',
  jrc_certificate text NOT NULL DEFAULT '',
  jrc_date text NOT NULL DEFAULT '',
  jrc_eov text NOT NULL DEFAULT '',
  jrc_type_approval text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.jrc_update_proposals TO anon, authenticated;
GRANT ALL ON public.jrc_update_proposals TO service_role;
ALTER TABLE public.jrc_update_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to JRC proposals"
  ON public.jrc_update_proposals FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.jrc_check_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url text NOT NULL DEFAULT '',
  rows_parsed integer NOT NULL DEFAULT 0,
  proposals_created integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.jrc_check_runs TO anon, authenticated;
GRANT ALL ON public.jrc_check_runs TO service_role;
ALTER TABLE public.jrc_check_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to JRC check runs"
  ON public.jrc_check_runs FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_jrc_update_proposals_updated_at
BEFORE UPDATE ON public.jrc_update_proposals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();