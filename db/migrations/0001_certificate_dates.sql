-- Adds certificate issue/expiry date fields to tachograph_cards.
ALTER TABLE public.tachograph_cards
  ADD COLUMN IF NOT EXISTS certificate_issued_date TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS certificate_expiry_date TEXT NOT NULL DEFAULT '';
