-- Migration: Add image uploads tracking table for GDPR compliance and orphaned image cleanup
-- Purpose: Track all uploaded images to enable proper cleanup on account deletion and identify orphaned images

-- Create image_uploads tracking table
CREATE TABLE IF NOT EXISTS image_uploads (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    image_url TEXT NOT NULL,
    gcs_bucket TEXT NOT NULL,
    gcs_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(50),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    linked_to_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
    linked_at TIMESTAMP,
    is_orphaned BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast user lookup (critical for account deletion)
CREATE INDEX idx_image_uploads_user_id ON image_uploads(user_id);

-- Index for orphaned image cleanup queries
CREATE INDEX idx_image_uploads_orphaned ON image_uploads(is_orphaned, uploaded_at);

-- Index for finding images by item
CREATE INDEX idx_image_uploads_item_id ON image_uploads(linked_to_item_id);

-- Index for URL lookup (to update link status when item is created)
CREATE INDEX idx_image_uploads_url ON image_uploads(image_url);

-- Comments for documentation
COMMENT ON TABLE image_uploads IS 'Tracks all uploaded images for GDPR compliance and orphaned image cleanup';
COMMENT ON COLUMN image_uploads.user_id IS 'User who uploaded the image (for account deletion)';
COMMENT ON COLUMN image_uploads.image_url IS 'Public GCS URL of the image';
COMMENT ON COLUMN image_uploads.gcs_bucket IS 'GCS bucket name for direct deletion';
COMMENT ON COLUMN image_uploads.gcs_path IS 'Full GCS path (folder/filename) for deletion';
COMMENT ON COLUMN image_uploads.linked_to_item_id IS 'Item ID if image was saved to inventory (NULL if orphaned)';
COMMENT ON COLUMN image_uploads.is_orphaned IS 'True if image not linked to any item (eligible for cleanup)';
COMMENT ON COLUMN image_uploads.uploaded_at IS 'When image was uploaded (for age-based cleanup)';
COMMENT ON COLUMN image_uploads.linked_at IS 'When image was linked to an item (NULL if never linked)';
