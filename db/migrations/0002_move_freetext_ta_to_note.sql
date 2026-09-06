-- 1.6: Move free text from type_approval_number to verification_note.
-- Some rows carry prose ("Not identified", "Not published", German comments,
-- bare numbers) in the type_approval_number field instead of a real approval
-- number. A real approval number starts with eNN- or eNN_ (e.g. e1-00019-00).
-- The original value is preserved in verification_note with a [TA-ORIG: ...]
-- marker so it can be rolled back. Idempotent: already-empty fields and
-- already-marked notes are skipped.

-- Step 1: Append original value to verification_note with a rollback marker.
UPDATE public.tachograph_cards
SET verification_note = CONCAT(
  '[TA-ORIG: ', type_approval_number, ']',
  CASE WHEN verification_note != '' THEN CONCAT(E'\n', verification_note) ELSE '' END
)
WHERE type_approval_number != ''
  AND type_approval_number !~* '^e\d{1,2}[-_]'
  AND verification_note NOT LIKE '[TA-ORIG: %'
  AND verification_note NOT LIKE '%' || E'\n' || '[TA-ORIG: %';

-- Step 2: Clear the type_approval_number field for the same rows.
UPDATE public.tachograph_cards
SET type_approval_number = ''
WHERE type_approval_number != ''
  AND type_approval_number !~* '^e\d{1,2}[-_]';

-- Rollback (run manually if needed):
-- UPDATE public.tachograph_cards
-- SET type_approval_number = SUBSTRING(verification_note FROM '\[TA-ORIG: ([^\]]+)\]'),
--     verification_note = BTRIM(REGEXP_REPLACE(verification_note, '\[TA-ORIG: [^\]]+\]' || E'\n?', ''))
-- WHERE verification_note LIKE '[TA-ORIG: %' OR verification_note LIKE '%' || E'\n' || '[TA-ORIG: %';
