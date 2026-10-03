-- v2.55: Platform Timeline — which certificate families form one security
-- platform line (agreed 02.10.2026). A certificate belongs to a platform (chip
-- + tachograph applet), not to a card manufacturer: ANSSI-CC-2022/38 is the
-- Thales G2V2 platform that Thales, CETIS, PWPW, INCM, Austria Card … build on.
--
-- families: certificate family keys as derived by src/lib/cert-family.ts
--           (e.g. ANSSI-CC-2022/38, NSCIB-CC-22-0635023, BSI-DSZ-CC-0889).
--           Order inside a line comes from the certificate dates, not from here.
-- patterns: case-insensitive text fragments of the platform / chip / OS fields
--           that let a card WITHOUT a certificate be shown as "derived" in
--           this line (only from such texts, never from the manufacturer).
-- Edited by the admin under Tools → Platform lines.
CREATE TABLE IF NOT EXISTS public.platform_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  vendor      text        NOT NULL DEFAULT '',
  families    text[]      NOT NULL DEFAULT '{}',
  patterns    text[]      NOT NULL DEFAULT '{}',
  note        text        NOT NULL DEFAULT '',
  sort        integer     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Starting point from the live data (02.10.2026). Families not listed here
-- (older G1 certificates, CC-22-0635025, …) show up as "not assigned" until
-- the admin assigns them.
INSERT INTO public.platform_lines (name, vendor, families, patterns, note, sort) VALUES
  ('Thales tachograph platform', 'Thales (formerly Gemalto)',
   ARRAY['ANSSI-CC-2018/11', 'ANSSI-CC-2022/38'],
   ARRAY['MultiApp', 'IFX_CCI_000039H', 'G2V2 on Infineon', 'Thales Digital Tachograph', 'Thales G2V2', 'Thales G1'],
   'G1 v1.5 / G2 on MultiApp V4 (2018/11) → G2V2 on Infineon IFX_CCI_000039H (2022/38, M01, R01)', 10),
  ('IDEMIA IDeal Drive / TachoDrive', 'IDEMIA (IN Smart Identity France)',
   ARRAY['NSCIB-CC-19-200716', 'NSCIB-CC-20-200716', 'ANSSI-CC-2022/36', 'ANSSI-CC-2023/21'],
   ARRAY['TachoDrive', 'Cosmo X', 'IDeal Drive', 'ID-One Cosmo'],
   'IDeal Drive DT V3.0 (NSCIB 200716) → TachoDrive v4 on ID-One Cosmo X (2022/36, 2023/21)', 20),
  ('STMicroelectronics / Incard J-Tacho', 'STMicroelectronics / Incard',
   ARRAY['NSCIB-CC-19-222356', 'NSCIB-CC-21-222356', 'NSCIB-CC-22-0635023', 'NSCIB-CC-0635023'],
   ARRAY['J-TACHO', 'ST31'],
   'J-Tacho v1.3.1 (222356) → J-TACHOG2V2 on ST31P450 (0635023)', 30)
ON CONFLICT (name) DO NOTHING;
