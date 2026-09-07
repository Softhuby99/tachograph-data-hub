-- Device type as its own column.
--
-- The JRC and Common Criteria sources also publish approvals for vehicle units
-- and motion sensors, not just cards. Those were arriving as proposals with
-- nowhere to go, because the table only knew "generation".
--
-- Device type and generation are separate dimensions: a vehicle unit has a
-- generation too (G1, G2, G2V2). Folding "Vehicle Unit" into the generation
-- column would have made that unrecordable and would have mixed device types
-- into every market-share figure.
--
-- Everything currently stored is a card, so that is the default and the
-- backfill.
ALTER TABLE public.tachograph_cards
  ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'Card';

UPDATE public.tachograph_cards
   SET device_type = 'Card'
 WHERE device_type IS NULL OR btrim(device_type) = '';

CREATE INDEX IF NOT EXISTS idx_tachograph_device_type
  ON public.tachograph_cards (device_type);
