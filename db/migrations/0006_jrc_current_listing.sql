-- Persisted mirror of "what is currently listed on the JRC pages", refreshed
-- wholesale by the JRC update-check cron (see runUpdateCheckForSource in
-- jrc.server.ts) each time it runs the card_status / other_certificates
-- sources. Until now that check fetched + parsed the pages, diffed them
-- against tachograph_cards to build proposals, and threw the parsed rows
-- away — nothing recorded the full current listing anywhere queryable.
--
-- Market Analytics (Current Status / History) needs exactly that: "is this
-- type approval still listed on JRC right now", without re-fetching the JRC
-- pages on every page view. This table is the answer, replaced in full for a
-- source_type on every cron run (DELETE + INSERT in one transaction), so a
-- reader only ever sees a complete, consistent snapshot.
--
-- type_approval_number is stored normalised (lowercase, non-alphanumeric
-- stripped) for matching; raw_type_approval keeps the original JRC spelling
-- for display. device_type follows the app's Card / Vehicle Unit / Motion
-- Sensor convention where it applies, and keeps the JRC "other certificates"
-- component label as-is otherwise (DSRC, M1N1, Paper, ...).
CREATE TABLE IF NOT EXISTS public.jrc_current_listing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  type_approval_number text NOT NULL,
  raw_type_approval text NOT NULL DEFAULT '',
  manufacturer text NOT NULL DEFAULT '',
  card_name text NOT NULL DEFAULT '',
  certificate text NOT NULL DEFAULT '',
  jrc_date text NOT NULL DEFAULT '',
  eov text NOT NULL DEFAULT '',
  generation text NOT NULL DEFAULT '',
  device_type text NOT NULL DEFAULT 'Card',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jrc_current_listing_ta_idx
  ON public.jrc_current_listing (type_approval_number);

CREATE INDEX IF NOT EXISTS jrc_current_listing_source_idx
  ON public.jrc_current_listing (source_type);
