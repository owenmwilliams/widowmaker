-- Migration: Unified media asset registry
-- Purpose: Extend image_uploads into the canonical registry for ALL persisted
--          user media (inventory photos, chat attachments, video walkthroughs,
--          retained derivatives). Introduces asset_uuid as the public identifier
--          and adds items.picture_asset_id for ID-based linkage.
-- See: movetrack-api/docs/unified-media-upload-spec.md

BEGIN;

-- uuid-ossp is already enabled by migration 015, but guard anyway.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── image_uploads: add asset_uuid (the public asset identifier) ────────────
ALTER TABLE image_uploads
  ADD COLUMN IF NOT EXISTS asset_uuid UUID;

-- Backfill any existing rows so the NOT NULL + UNIQUE constraints can be added.
UPDATE image_uploads
  SET asset_uuid = uuid_generate_v4()
  WHERE asset_uuid IS NULL;

ALTER TABLE image_uploads
  ALTER COLUMN asset_uuid SET NOT NULL,
  ALTER COLUMN asset_uuid SET DEFAULT uuid_generate_v4();

-- Unique constraint (idempotent via conditional DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'image_uploads_asset_uuid_key'
  ) THEN
    ALTER TABLE image_uploads
      ADD CONSTRAINT image_uploads_asset_uuid_key UNIQUE (asset_uuid);
  END IF;
END $$;

-- ── image_uploads: new classification + linkage columns ───────────────────
ALTER TABLE image_uploads
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'inventory_item',
  ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS linked_to_entity_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS linked_to_entity_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS upload_session_id UUID NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill status from the legacy is_orphaned flag so existing rows land in
-- the correct state for the new cleanup pipeline.
UPDATE image_uploads
  SET status = CASE
    WHEN linked_to_item_id IS NOT NULL OR is_orphaned = false THEN 'linked'
    ELSE 'uploaded'
  END
  WHERE status = 'uploaded' AND linked_to_item_id IS NOT NULL;

-- Backfill linked_to_entity_{type,id} for previously-linked item photos so the
-- new entity-based queries return them without a compatibility shim.
UPDATE image_uploads
  SET linked_to_entity_type = 'item',
      linked_to_entity_id = linked_to_item_id::text
  WHERE linked_to_item_id IS NOT NULL
    AND linked_to_entity_type IS NULL;

-- ── New indexes for the unified query patterns ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_image_uploads_user_status_uploaded_at
  ON image_uploads(user_id, status, uploaded_at);

CREATE INDEX IF NOT EXISTS idx_image_uploads_entity
  ON image_uploads(linked_to_entity_type, linked_to_entity_id);

CREATE INDEX IF NOT EXISTS idx_image_uploads_source_uploaded_at
  ON image_uploads(source, uploaded_at);

-- ── items: add picture_asset_id for ID-based linkage ──────────────────────
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS picture_asset_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_picture_asset_id_fkey'
  ) THEN
    ALTER TABLE items
      ADD CONSTRAINT items_picture_asset_id_fkey
        FOREIGN KEY (picture_asset_id)
        REFERENCES image_uploads(asset_uuid)
        ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_items_picture_asset_id
  ON items(picture_asset_id);

-- ── Documentation ─────────────────────────────────────────────────────────
COMMENT ON COLUMN image_uploads.asset_uuid IS
  'Public asset identifier returned to callers. Stable across environments and safe to link by.';
COMMENT ON COLUMN image_uploads.source IS
  'Origin of the upload: inventory_item, nexus_chat, census_chat, video_scan, derived_crop, derived_thumbnail.';
COMMENT ON COLUMN image_uploads.asset_type IS
  'image or video.';
COMMENT ON COLUMN image_uploads.status IS
  'Lifecycle state: uploaded, linked, or deleted.';
COMMENT ON COLUMN image_uploads.linked_to_entity_type IS
  'Entity class this asset is attached to (item, nexus_message, scan_session). Preferred over linked_to_item_id for new code.';
COMMENT ON COLUMN image_uploads.linked_to_entity_id IS
  'Entity identifier as text. TEXT to allow mixed key types without premature schema coupling.';
COMMENT ON COLUMN image_uploads.upload_session_id IS
  'Session identifier for grouping uploads (e.g. a chat session or video scan).';
COMMENT ON COLUMN image_uploads.metadata IS
  'Free-form metadata: original filename, dimensions, duration, parent_asset_id for derivatives, etc.';
COMMENT ON COLUMN items.picture_asset_id IS
  'Preferred asset reference for the item picture. FK to image_uploads.asset_uuid. picture_url is retained as fallback during migration.';

COMMIT;

-- Verification
SELECT 'Migration 027 (unified media assets) completed successfully!' AS status;
