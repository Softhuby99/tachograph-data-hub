
CREATE TABLE public.tachograph_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country text NOT NULL,
  country_flag text NOT NULL DEFAULT '',
  generation text NOT NULL DEFAULT '',
  application text NOT NULL DEFAULT '',
  current_manufacturer text NOT NULL DEFAULT '',
  current_manufacturer_normalized text NOT NULL DEFAULT '',
  chip_platform_vendor text NOT NULL DEFAULT '',
  security_certificate text NOT NULL DEFAULT '',
  chip_certificate text NOT NULL DEFAULT '',
  type_approval_number text NOT NULL DEFAULT '',
  certified_security_platform text NOT NULL DEFAULT '',
  certificate_holder text NOT NULL DEFAULT '',
  date_status text NOT NULL DEFAULT '',
  issued_by_authority text NOT NULL DEFAULT '',
  jrc_interoperability_status text NOT NULL DEFAULT '',
  functional_certificate_lab text NOT NULL DEFAULT '',
  security_certificate_lab text NOT NULL DEFAULT '',
  tachograph_application_os text NOT NULL DEFAULT '',
  distinction_from_manufacturer text NOT NULL DEFAULT '',
  jrc_certificate_source text NOT NULL DEFAULT '',
  primary_source text NOT NULL DEFAULT '',
  latest_tender text NOT NULL DEFAULT '',
  winner_contractor text NOT NULL DEFAULT '',
  procurement_status text NOT NULL DEFAULT '',
  procurement_scope text NOT NULL DEFAULT '',
  tender_source text NOT NULL DEFAULT '',
  verification_note text NOT NULL DEFAULT '',
  data_reference_date date NOT NULL DEFAULT '2026-07-15',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tachograph_country ON public.tachograph_cards (country);
CREATE INDEX idx_tachograph_generation ON public.tachograph_cards (generation);
CREATE INDEX idx_tachograph_mfr_norm ON public.tachograph_cards (current_manufacturer_normalized);

GRANT SELECT ON public.tachograph_cards TO anon, authenticated;
GRANT ALL ON public.tachograph_cards TO service_role;

ALTER TABLE public.tachograph_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access to tachograph cards"
  ON public.tachograph_cards
  FOR SELECT
  TO anon, authenticated
  USING (true);
