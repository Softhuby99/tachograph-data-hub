-- Per-field change history for tachograph_cards (hosted backend).
-- Mirrors db/migrations/0003_card_field_history.sql used by the Docker image.
CREATE TABLE IF NOT EXISTS public.card_field_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.tachograph_cards(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text NOT NULL DEFAULT '',
  new_value text NOT NULL DEFAULT '',
  origin text NOT NULL DEFAULT 'manual',
  source_label text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  proposal_id uuid,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS card_field_history_card_idx
  ON public.card_field_history (card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS card_field_history_field_idx
  ON public.card_field_history (field);

-- The history is as public as the data it documents: readable by anyone,
-- writable only through the service role used by the server functions.
ALTER TABLE public.card_field_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "card_field_history read" ON public.card_field_history;
CREATE POLICY "card_field_history read"
  ON public.card_field_history FOR SELECT
  USING (true);
