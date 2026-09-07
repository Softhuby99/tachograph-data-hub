-- Per-field change history for tachograph_cards.
--
-- Until now a card carried no trace of how it got its values: manual edits
-- overwrote the single override patch, approved JRC proposals wrote straight
-- into the row, and the CSV import logged nothing at all. There was no way to
-- answer "why does this record say Russia?".
--
-- One row per changed field. origin says where the change came from:
--   manual        — someone edited the card in the app
--   jrc_proposal  — an approved proposal from the update monitor
--   csv_import    — a row from a CSV import
--   reset         — manual edits removed, field fell back to the base value
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
