-- Going through the handled list was guesswork: nothing recorded whether an
-- entry had already been looked at, so every pass started from the beginning.
--
-- reviewed_at is an explicit "I have read this one" marker, separate from the
-- status: a dismissed proposal can be unreviewed (nobody checked the decision)
-- and an approved one can be reviewed. reviewed_by keeps who set it, when the
-- deployment has real users.
ALTER TABLE public.jrc_update_proposals
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid;

-- updated_at is what the list shows as "last change". The generic trigger
-- refreshed it on every UPDATE, so ticking the review marker would have looked
-- like the proposal itself had changed. Fire it only for the columns that
-- carry a real decision.
DROP TRIGGER IF EXISTS update_jrc_update_proposals_updated_at ON public.jrc_update_proposals;
CREATE TRIGGER update_jrc_update_proposals_updated_at
BEFORE UPDATE ON public.jrc_update_proposals
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.country IS DISTINCT FROM NEW.country
  OR OLD.payload IS DISTINCT FROM NEW.payload
  OR OLD.changes IS DISTINCT FROM NEW.changes
)
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS jrc_update_proposals_reviewed_at_idx
  ON public.jrc_update_proposals (reviewed_at);
