-- Multi-photo scans: a job may carry up to 5 image URLs analyzed together
-- (same room, different angles). media_url stays the first/primary URL so
-- existing readers keep working; media_urls is set only for batches.
ALTER TABLE scan_jobs ADD COLUMN IF NOT EXISTS media_urls JSONB;
