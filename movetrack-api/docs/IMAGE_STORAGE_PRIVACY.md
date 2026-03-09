# Image Storage & Privacy Compliance

## Overview

This document describes how image uploads are handled in Nexus Moves, including GDPR/CCPA compliance for user data deletion.

---

## Architecture

### **Upload-First Flow**

1. **User captures photo** → Image uploaded to GCS immediately
2. **Upload tracked in database** → Recorded in `image_uploads` table with `is_orphaned=true`
3. **AI analyzes from URL** → Vision API fetches from GCS
4. **User saves item** → `image_uploads` updated with `linked_to_item_id`, `is_orphaned=false`

### **Database Schema**

```sql
CREATE TABLE image_uploads (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,              -- For GDPR: find all user's images
    image_url TEXT NOT NULL,             -- Public GCS URL
    gcs_bucket TEXT NOT NULL,            -- For direct deletion
    gcs_path TEXT NOT NULL,              -- Full path: folder/filename
    file_size INTEGER,
    mime_type VARCHAR(50),
    uploaded_at TIMESTAMP,
    linked_to_item_id INTEGER,           -- NULL if orphaned
    linked_at TIMESTAMP,                 -- When linked to item
    is_orphaned BOOLEAN DEFAULT true,    -- For cleanup queries
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### **Indexes**

- `idx_image_uploads_user_id` - Fast user lookup for account deletion
- `idx_image_uploads_orphaned` - Orphaned image cleanup queries
- `idx_image_uploads_item_id` - Find images by item
- `idx_image_uploads_url` - Update link status when item created

---

## Privacy Compliance (GDPR/CCPA)

### **Data Retention Policy**

1. **Orphaned Images**: Deleted after **48 hours** (configurable)
2. **Linked Images**: Retained until user deletes item or account
3. **Account Deletion**: ALL images deleted immediately (GDPR "Right to be Forgotten")

### **User Data Deletion Process**

When a user deletes their account:

```bash
# 1. Delete all user images (both orphaned and linked)
node bin/deleteUserImages.js <user_id>

# 2. Preview before deletion (dry run)
node bin/deleteUserImages.js <user_id> --dry-run
```

This script:
- ✅ Deletes all images from Google Cloud Storage
- ✅ Removes all tracking records from database
- ✅ Works for both orphaned and linked images
- ✅ Provides detailed audit log
- ✅ GDPR/CCPA compliant

### **Integration with Account Deletion**

Add this to your account deletion handler:

```javascript
// routes/users.js or similar
router.delete('/account', async (req, res) => {
  const userId = req.user.user_id;

  try {
    // 1. Delete all user images
    const { Storage } = require('@google-cloud/storage');
    const storage = new Storage();

    const userImages = await knex('image_uploads')
      .where('user_id', userId);

    for (const img of userImages) {
      const bucket = storage.bucket(img.gcs_bucket);
      const file = bucket.file(img.gcs_path);
      await file.delete().catch(() => {}); // Ignore if already deleted
    }

    await knex('image_uploads').where('user_id', userId).delete();

    // 2. Delete user items, collections, etc.
    await knex('items').where('user_id', userId).delete();
    await knex('collections').where('user_id', userId).delete();
    // ... other tables ...

    // 3. Delete user account
    await knex('users').where('id', userId).delete();

    res.json({ success: true, message: 'Account and all data deleted' });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});
```

---

## Orphaned Image Cleanup

### **Automated Cleanup (Recommended)**

Set up a cron job to run daily:

```bash
# crontab -e
0 2 * * * cd /path/to/movetrack-api && node bin/cleanupOrphanedImages.js >> /var/log/cleanup.log 2>&1
```

Or use Cloud Scheduler (GCP):

```yaml
# cloudbuild.yaml or similar
- name: 'gcr.io/cloud-builders/gcloud'
  args:
    - 'scheduler'
    - 'jobs'
    - 'create'
    - 'http'
    - 'cleanup-orphaned-images'
    - '--schedule=0 2 * * *'
    - '--uri=https://your-api.run.app/admin/cleanup-images'
    - '--http-method=POST'
```

### **Manual Cleanup**

```bash
# Preview what will be deleted (recommended first)
node bin/cleanupOrphanedImages.js --dry-run

# Perform cleanup (deletes orphaned images older than 48 hours)
node bin/cleanupOrphanedImages.js

# Custom age threshold (e.g., 24 hours)
MAX_AGE_HOURS=24 node bin/cleanupOrphanedImages.js
```

### **Cleanup Criteria**

Images are deleted if **ALL** of these are true:
- `is_orphaned = true` (not linked to any item)
- `uploaded_at < (NOW - 48 hours)` (configurable via `MAX_AGE_HOURS`)

This gives users time to:
- Complete the item creation flow
- Retry AI analysis if it fails
- Change their mind about saving the item

---

## Cost Analysis

### **Storage Costs**

**Google Cloud Storage Pricing** (us-central1):
- Standard storage: **$0.020/GB/month**
- Network egress (to AI): **$0.12/GB** (first 1GB free)

**Example Scenario:**
- 1000 images/month
- Average size: 2MB per image
- 10% abandonment rate (100 orphaned images)

**Monthly costs:**
- Storage: `100 images × 2MB × $0.020/GB = $0.004/month` ≈ **$0.00**
- Network egress: `1000 × 2MB × $0.12/GB = $0.24/month`

**Verdict:** Orphaned images cost is **negligible** (<$0.01/month for most apps)

### **When to Worry About Cleanup**

Implement aggressive cleanup if:
- You have **>10,000 abandonment rate per month**
- You're storing **high-resolution images** (>5MB each)
- Your abandonment rate is **>50%**

Otherwise, weekly/monthly cleanup is sufficient.

---

## Monitoring & Alerts

### **Database Queries for Monitoring**

```sql
-- Count orphaned images
SELECT COUNT(*) as orphaned_count,
       SUM(file_size) as total_bytes
FROM image_uploads
WHERE is_orphaned = true;

-- Count orphaned images older than 48 hours
SELECT COUNT(*) as overdue_count
FROM image_uploads
WHERE is_orphaned = true
  AND uploaded_at < NOW() - INTERVAL '48 hours';

-- Top users by image count
SELECT user_id,
       COUNT(*) as total_images,
       SUM(CASE WHEN is_orphaned THEN 1 ELSE 0 END) as orphaned,
       SUM(file_size) as total_bytes
FROM image_uploads
GROUP BY user_id
ORDER BY total_images DESC
LIMIT 10;

-- Images linked to deleted items (broken references)
SELECT iu.*
FROM image_uploads iu
LEFT JOIN items i ON iu.linked_to_item_id = i.id
WHERE iu.is_orphaned = false
  AND i.id IS NULL;
```

### **Recommended Alerts**

Set up alerts for:
1. **Orphaned images > 1000** - May indicate users abandoning items
2. **Storage > 10GB** - Approaching quota limits
3. **Cleanup script failures** - Track via cron job logs

---

## FAQ

### **Q: What if a user deletes their account?**
A: Run `deleteUserImages.js <user_id>` as part of account deletion. This removes ALL images (orphaned and linked) and is GDPR compliant.

### **Q: What if AI analysis fails after upload?**
A: Image remains in GCS with `is_orphaned=true`. User can retry analysis without re-uploading. Cleanup script removes it after 48 hours.

### **Q: What if a user uploads but never saves the item?**
A: Image becomes orphaned and is automatically deleted after 48 hours by the cleanup script.

### **Q: Can we reduce the 48-hour window?**
A: Yes, but don't go below 24 hours. Users may need time to complete multi-step flows or retry failed operations.

### **Q: What about images uploaded before this system?**
A: Old images won't be tracked in `image_uploads` table. They'll remain in GCS until manually cleaned. Consider a one-time migration script.

### **Q: Is this GDPR compliant?**
A: Yes! The `image_uploads` table tracks `user_id`, enabling complete deletion of user data via `deleteUserImages.js`.

---

## Migration Guide

### **Step 1: Run Migration**

```bash
psql -h $MT_DATALAYER_HOSTNAME \
     -U $MT_DATALAYER_USERNAME \
     -d $MT_DATALAYER_DATABASE \
     -f migrations/023_add_image_uploads_tracking.sql
```

### **Step 2: Deploy Backend Code**

Deploy updated:
- `routes/files.js` (tracks uploads)
- `routes/items.js` (marks images as linked)

### **Step 3: Deploy Frontend Code**

Deploy updated:
- `PhotoCapture.vue` (upload-first flow)
- `InventoryStore.ts` (accepts URLs)

### **Step 4: Set Up Cleanup Cron**

```bash
crontab -e
# Add: 0 2 * * * cd /path/to/movetrack-api && node bin/cleanupOrphanedImages.js
```

### **Step 5: Test Account Deletion**

```bash
# Test with a test user
node bin/deleteUserImages.js <test_user_id> --dry-run
node bin/deleteUserImages.js <test_user_id>
```

---

## Summary

✅ **Upload-first flow implemented** - Faster UX, better error handling
✅ **Image tracking database** - Know who uploaded what
✅ **Orphaned image cleanup** - Automatic deletion after 48 hours
✅ **GDPR compliance** - Complete user data deletion
✅ **Backward compatible** - Old blob upload flow still works
✅ **Cost optimized** - Orphaned images cost ~$0.01/month

**Recommended Next Steps:**
1. Run migration: `023_add_image_uploads_tracking.sql`
2. Set up cleanup cron job
3. Integrate `deleteUserImages.js` into account deletion flow
4. Monitor orphaned image count weekly
