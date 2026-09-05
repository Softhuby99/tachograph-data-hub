ALTER TABLE public.tachograph_cards
  ADD COLUMN IF NOT EXISTS certificate_issued_date text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS certificate_expiry_date text NOT NULL DEFAULT '';