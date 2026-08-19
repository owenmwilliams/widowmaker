-- 043_add_capture_source.sql
--
-- Embeddable "Get a quote" widget (F1, issue #98). The widget on a moving
-- company's own website opens /c/{token}?src=widget; the capture page passes
-- that through to POST /api/capture/:companyToken/start, which stores it here
-- so Owen can see which sessions the widget (vs. a pasted link or an email)
-- actually produced.
--
--   company_capture_sessions.source — nullable marker for how the customer
--     arrived: 'widget' | 'link' | 'email'. NULL for sessions started before
--     this column existed or with no/unknown attribution (the route nulls
--     junk values rather than rejecting the start).
--
-- Keep in sync with db/init-movetrack.sql (scripts/check-schema-drift.js).

ALTER TABLE company_capture_sessions ADD COLUMN IF NOT EXISTS source VARCHAR(20);
