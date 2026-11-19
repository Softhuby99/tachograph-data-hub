export type TachoCard = {
  id: string;
  country: string;
  country_flag: string;
  device_type: string;
  generation: string;
  application: string;
  current_manufacturer: string;
  current_manufacturer_normalized: string;
  chip_platform_vendor: string;
  security_certificate: string;
  chip_certificate: string;
  certificate_issued_date: string;
  certificate_expiry_date: string;
  type_approval_number: string;
  certified_security_platform: string;
  certificate_holder: string;
  date_status: string;
  issued_by_authority: string;
  jrc_interoperability_status: string;
  functional_certificate_lab: string;
  security_certificate_lab: string;
  tachograph_application_os: string;
  distinction_from_manufacturer: string;
  jrc_certificate_source: string;
  primary_source: string;
  latest_tender: string;
  winner_contractor: string;
  procurement_status: string;
  procurement_scope: string;
  tender_source: string;
  verification_note: string;
  data_reference_date: string;
  // Virtual field — not a DB column; stored only in manual overrides.
  card_quantities?: string;
};

export type Overrides = Record<string, Partial<TachoCard>>;
