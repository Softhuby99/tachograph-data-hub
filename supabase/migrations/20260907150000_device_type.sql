-- Device type as its own column (hosted backend).
-- Mirrors db/migrations/0004_device_type.sql used by the Docker image.
ALTER TABLE public.tachograph_cards
  ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'Card';

UPDATE public.tachograph_cards
   SET device_type = 'Card'
 WHERE device_type IS NULL OR btrim(device_type) = '';

CREATE INDEX IF NOT EXISTS idx_tachograph_device_type
  ON public.tachograph_cards (device_type);
