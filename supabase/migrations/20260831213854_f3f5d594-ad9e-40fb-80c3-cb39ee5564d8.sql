CREATE TABLE public.tachograph_card_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL UNIQUE REFERENCES public.tachograph_cards(id) ON DELETE CASCADE,
  patch jsonb NOT NULL DEFAULT '{}'::jsonb,
  edited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tachograph_card_overrides TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tachograph_card_overrides TO authenticated;
GRANT ALL ON public.tachograph_card_overrides TO service_role;

ALTER TABLE public.tachograph_card_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access to card overrides"
  ON public.tachograph_card_overrides FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Authenticated users can create card overrides"
  ON public.tachograph_card_overrides FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update card overrides"
  ON public.tachograph_card_overrides FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete card overrides"
  ON public.tachograph_card_overrides FOR DELETE
  TO authenticated
  USING (true);

CREATE TRIGGER update_tachograph_card_overrides_updated_at
  BEFORE UPDATE ON public.tachograph_card_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
