-- site-people extract: cap retries per site.
-- attempts counts extract claims that reached Gemini; after 3 failed attempts
-- gave_up_at is set and the site is never re-picked (and no longer counts as remaining).
-- Additive only. Do not apply until Josh approves.
ALTER TABLE topup.site_extractions
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gave_up_at timestamptz;

-- Rows that already failed before this change start at 1 attempt so they get
-- at most 2 more tries instead of looping.
UPDATE topup.site_extractions
   SET attempts = 1
 WHERE error IS NOT NULL AND error NOT IN ('in_progress', 'released') AND attempts = 0;

CREATE INDEX IF NOT EXISTS site_extractions_gave_up_idx
  ON topup.site_extractions (domain) WHERE gave_up_at IS NOT NULL;
