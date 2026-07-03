-- ═══════════════════════════════════════════════════════════════════════════
-- Golden-set extraction queries
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in Cloud SQL Studio (or psql) against the production DB. Golden-set
-- tester accounts are identified by the +goldenset email tag from
-- docs/beta/tester-guide.md.
--
-- Workflow:
--   1. Q1 — sanity-check who signed up.
--   2. Q2 — export as CSV: one row per scan, model output prefilled, empty
--      golden_items/notes columns for the human label. Label it in Sheets.
--   3. Q3 (optional) — finer-grained: one row per detected item, verdict col.
--   4. Q4 — emit a golden-set.json skeleton for scripts/eval-scan-recall.js.
--      ground_truth is PREFILLED WITH THE MODEL'S OWN OUTPUT as a typing
--      convenience only: you MUST edit each list while watching the clip.
--      The eval scores the model against this file — rubber-stamping the
--      prefill scores 100% by construction and measures nothing.
--   5. Q5 — gsutil commands to download the clips locally (GCS objects are
--      private; the eval runs cleanest against local paths).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Q1: golden-set tester accounts ──────────────────────────────────────────
SELECT user_id, email, first_name, created_at
FROM users
WHERE email ILIKE '%+goldenset%'
ORDER BY created_at;


-- ── Q2: labeling worksheet — one row per completed scan ─────────────────────
-- Export as CSV. Fill `golden_items` with the true movable items you see in
-- the media (semicolon-separated, quantity as "x N"), and anything odd in
-- `notes`. `media` holds every URL in a photo batch.
SELECT
  u.email                                            AS tester,
  sj.id                                              AS scan_job_id,
  sj.media_kind,
  COALESCE(sj.room_hint, sj.result->>'room')         AS room,
  sj.created_at,
  sj.finished_at,
  COALESCE(sj.media_urls::text, sj.media_url)        AS media,
  jsonb_array_length(COALESCE(sj.result->'items', '[]'::jsonb)) AS model_item_count,
  (SELECT string_agg(
            (it->>'name') ||
            CASE WHEN COALESCE(NULLIF(it->>'quantity','')::numeric, 1) > 1
                 THEN ' x' || (it->>'quantity') ELSE '' END,
            '; ' ORDER BY ord)
     FROM jsonb_array_elements(COALESCE(sj.result->'items','[]'::jsonb))
          WITH ORDINALITY AS t(it, ord))             AS model_items,
  ''                                                 AS golden_items,  -- ← human label
  ''                                                 AS notes          -- ← missed/invented/dup/misnamed
FROM scan_jobs sj
JOIN users u ON u.user_id = sj.user_id
WHERE u.email ILIKE '%+goldenset%'
  AND sj.status = 'completed'
ORDER BY u.email, sj.created_at;


-- ── Q3 (optional): per-item verdict sheet ────────────────────────────────────
-- One row per detected item. verdict ∈ correct | wrong_name | wrong_count |
-- duplicate | not_present | fixture. Add rows at the bottom of the sheet for
-- items the scan MISSED entirely.
SELECT
  u.email                                    AS tester,
  sj.id                                      AS scan_job_id,
  COALESCE(sj.room_hint, sj.result->>'room') AS room,
  ord                                        AS item_no,
  it->>'name'                                AS model_item,
  COALESCE(it->>'quantity', '1')             AS model_qty,
  ''                                         AS verdict,       -- ← human label
  ''                                         AS correct_name   -- ← if wrong_name
FROM scan_jobs sj
JOIN users u ON u.user_id = sj.user_id,
LATERAL jsonb_array_elements(COALESCE(sj.result->'items','[]'::jsonb))
        WITH ORDINALITY AS t(it, ord)
WHERE u.email ILIKE '%+goldenset%'
  AND sj.status = 'completed'
ORDER BY u.email, sj.created_at, ord;


-- ── Q4: golden-set.json skeleton (videos only — the eval harness scores the
--        video path). Paste the output into scripts/eval/golden-set.json and
--        EDIT EVERY ground_truth against the actual clip before running. ────
SELECT jsonb_pretty(jsonb_build_object(
  'matching', jsonb_build_object('threshold', 0.5),
  'videos',   jsonb_agg(entry ORDER BY created_at)
)) AS golden_set_json
FROM (
  SELECT sj.created_at,
         jsonb_build_object(
           'id', lower(regexp_replace(COALESCE(sj.room_hint, sj.result->>'room', 'scan'),
                                      '[^a-zA-Z0-9]+', '-', 'g'))
                 || '-' || to_char(sj.created_at, 'YYYY-MM-DD')
                 || '-' || left(sj.id::text, 8),
           'url', sj.media_url,
           'mime_type', sj.mime_type,
           'room_hint', COALESCE(sj.room_hint, sj.result->>'room'),
           'ground_truth', COALESCE(
             (SELECT jsonb_agg(it->>'name' ORDER BY ord)
                FROM jsonb_array_elements(sj.result->'items')
                     WITH ORDINALITY AS t(it, ord)),
             '[]'::jsonb)   -- ← STARTING POINT ONLY: correct by watching the clip
         ) AS entry
  FROM scan_jobs sj
  JOIN users u ON u.user_id = sj.user_id
  WHERE u.email ILIKE '%+goldenset%'
    AND sj.status = 'completed'
    AND sj.media_kind = 'video'
) s;


-- ── Q5: download commands for the clips (objects are private in GCS) ────────
-- Run the emitted lines from movetrack-api/, then reference each video by
-- local `path` (instead of `url`) in golden-set.json.
SELECT 'gsutil cp gs://'
       || regexp_replace(sj.media_url, '^https://storage\.googleapis\.com/', '')
       || ' ./scripts/eval/videos/' AS download_cmd
FROM scan_jobs sj
JOIN users u ON u.user_id = sj.user_id
WHERE u.email ILIKE '%+goldenset%'
  AND sj.status = 'completed'
  AND sj.media_kind = 'video'
ORDER BY sj.created_at;
