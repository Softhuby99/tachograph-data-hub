CREATE TABLE IF NOT EXISTS public.jrc_source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  entry_key text NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, entry_key)
);

GRANT SELECT ON public.jrc_source_snapshots TO anon, authenticated;
GRANT ALL ON public.jrc_source_snapshots TO service_role;

ALTER TABLE public.jrc_source_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read source snapshots"
  ON public.jrc_source_snapshots FOR SELECT USING (true);