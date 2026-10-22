-- site-people extract: cap retries per site and say why a site failed.
-- attempts: extract claims (and failed fetches) per site; after 3 failures
--   gave_up_at is set and the site is never re-picked.
-- failure_kind: fetch_failed | truncated | bad_json | llm_unavailable | other (null = ok).
-- page_chars / chunks / chunk_capped: page size, Gemini calls used, hit the 12-chunk cap.
-- Additive only. Do not apply until Josh approves.
ALTER TABLE topup.site_extractions
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gave_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_kind text,
  ADD COLUMN IF NOT EXISTS page_chars integer,
  ADD COLUMN IF NOT EXISTS chunks integer,
  ADD COLUMN IF NOT EXISTS chunk_capped boolean NOT NULL DEFAULT false;

ALTER TABLE topup.site_extractions DROP CONSTRAINT IF EXISTS site_extractions_failure_kind_chk;
ALTER TABLE topup.site_extractions ADD CONSTRAINT site_extractions_failure_kind_chk
  CHECK (failure_kind IS NULL OR failure_kind IN ('fetch_failed', 'truncated', 'bad_json', 'llm_unavailable', 'other'));

-- Backfill: rows that already failed start at 1 attempt (at most 2 more tries) with a best-guess kind.
UPDATE topup.site_extractions
   SET attempts = 1,
       failure_kind = CASE
         WHEN error ILIKE '%MAX_TOKENS%' THEN 'truncated'
         WHEN error ILIKE '%json%' THEN 'bad_json'
         WHEN error ILIKE '%gemini 402%' OR error ILIKE '%gemini 403%' THEN 'llm_unavailable'
         ELSE 'other' END
 WHERE error IS NOT NULL AND error NOT IN ('in_progress', 'released') AND attempts = 0;

CREATE INDEX IF NOT EXISTS site_extractions_gave_up_idx
  ON topup.site_extractions (domain) WHERE gave_up_at IS NOT NULL;

-- Quick look: is it a big staff page or a failing fetch?
CREATE OR REPLACE VIEW topup.site_extraction_failures AS
SELECT coalesce(e.failure_kind, CASE WHEN e.chunk_capped THEN 'ok_chunk_capped' ELSE 'ok' END) AS kind,
       count(*)::int                                   AS sites,
       count(*) FILTER (WHERE e.gave_up_at IS NOT NULL)::int AS gave_up,
       count(*) FILTER (WHERE e.chunk_capped)::int     AS chunk_capped,
       round(avg(e.page_chars))::int                   AS avg_page_chars,
       max(e.page_chars)                               AS max_page_chars,
       round(avg(e.chunks), 1)                         AS avg_chunks,
       sum(e.people)::int                              AS people_kept
  FROM topup.site_extractions e
 WHERE e.error IS DISTINCT FROM 'in_progress'
 GROUP BY 1;
