# Image Storage & Privacy Compliance

> Written: 2025-11-29 | Status: **Current** | GDPR/CCPA image handling

## Overview

Describes how image uploads are handled in Nexus Moves, including GDPR/CCPA compliance for user data deletion.

## Architecture

### Upload-First Flow

1. **User captures photo** — Image uploaded to GCS immediately
2. **Upload tracked in database** — Recorded in `image_uploads` table with `is_orphaned=true`
3. **AI analyzes from URL** — Vision API fetches from GCS
4. **User saves item** — `image_uploads` updated with `linked_to_item_id`, `is_orphaned=false`

### Database Schema

```sql
CREATE TABLE image_uploads (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    image_url TEXT NOT NULL,
    gcs_bucket TEXT NOT NULL,
    gcs_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(50),
    uploaded_at TIMESTAMP,
    linked_to_item_id INTEGER,
    linked_at TIMESTAMP,
    is_orphaned BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Indexes

- `idx_image_uploads_user_id` — Fast user lookup for account deletion
- `idx_image_uploads_orphaned` — Orphaned image cleanup queries
- `idx_image_uploads_item_id` — Find images by item
- `idx_image_uploads_url` — Update link status when item created

## Privacy Compliance (GDPR/CCPA)

### Data Retention Policy

1. **Orphaned Images**: Deleted after 48 hours (configurable)
2. **Linked Images**: Retained until user deletes item or account
3. **Account Deletion**: ALL images deleted immediately (GDPR "Right to be Forgotten")

### User Data Deletion

Account deletion is handled by `services/workflow/userDeleteService.js`. For manual cleanup:

```bash
node scripts/deleteUserImages.js <user_id>
node scripts/deleteUserImages.js <user_id> --dry-run
```

## Orphaned Image Cleanup

### Automated Cleanup (Recommended)

```bash
# crontab
0 2 * * * cd /path/to/movetrack-api && node scripts/cleanupOrphanedImages.js >> /var/log/cleanup.log 2>&1
```

### Manual Cleanup

```bash
node scripts/cleanupOrphanedImages.js --dry-run
node scripts/cleanupOrphanedImages.js
MAX_AGE_HOURS=24 node scripts/cleanupOrphanedImages.js
```

### Cleanup Criteria

Images are deleted if ALL of these are true:
- `is_orphaned = true` (not linked to any item)
- `uploaded_at < (NOW - 48 hours)` (configurable via `MAX_AGE_HOURS`)

## Cost Analysis

Google Cloud Storage (us-central1):
- Standard storage: $0.020/GB/month
- Network egress: $0.12/GB (first 1GB free)

For 1000 images/month at 2MB avg with 10% abandonment: storage cost is negligible (<$0.01/month).

## Monitoring

```sql
-- Count orphaned images
SELECT COUNT(*) as orphaned_count, SUM(file_size) as total_bytes
FROM image_uploads WHERE is_orphaned = true;

-- Overdue orphaned images (>48h)
SELECT COUNT(*) as overdue_count FROM image_uploads
WHERE is_orphaned = true AND uploaded_at < NOW() - INTERVAL '48 hours';
```

## Migration

```bash
psql -h $MT_DATALAYER_HOSTNAME -U $MT_DATALAYER_USERNAME -d $MT_DATALAYER_DATABASE \
  -f migrations/023_add_image_uploads_tracking.sql
```

Deploy updated routes (`routes/api/user/userFiles.js`, `routes/api/inventory/items.js`), then set up the cleanup cron.
