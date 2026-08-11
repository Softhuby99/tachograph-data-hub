ALTER TABLE public.jrc_update_proposals
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'card_status',
  ADD COLUMN IF NOT EXISTS source_label text NOT NULL DEFAULT 'Card status',
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS jrc_update_proposals_source_type_idx
  ON public.jrc_update_proposals (source_type);

ALTER TABLE public.jrc_check_runs
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'card_status';