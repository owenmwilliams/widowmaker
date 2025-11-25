# Production Deployment Plan

**Date:** November 24, 2025
**Version:** Major Update - Multi-Location Moves, Route Planning, Waypoints, and Bug Fixes

## Executive Summary

This deployment includes significant new features for move planning with multi-location support, route optimization, waypoint management, and critical bug fixes. Database migrations will be applied to add new tables and columns. **Data loss is acceptable** for this deployment as confirmed.

---

## 1. Code Changes Summary

### Backend (API) Changes

#### New Files to Add:
- `movetrack-api/config/google.js` - Google Maps API configuration
- `movetrack-api/services/geocodingService.js` - Geocoding and address services
- `movetrack-api/services/distanceUtils.js` - Distance calculation utilities
- `movetrack-api/services/qrService.js` - QR code generation service
- `movetrack-api/routes/savedMoves.js` - Move planning API endpoints
- `movetrack-api/routes/waypoints.js` - Waypoint management endpoints
- `movetrack-api/routes/billing.js` - Billing/subscription endpoints
- `movetrack-api/routes/billingWebhook.js` - Stripe webhook handler
- `movetrack-api/routes/moveDay.js` - Move day tracking endpoints

#### Modified Files:
- `movetrack-api/app.js` - Added new route handlers
- `movetrack-api/bin/authService.js` - Enhanced authentication
- `movetrack-api/routes/vision.js` - **CRITICAL FIX**: Multi-item scan quota bug
- `movetrack-api/routes/distance.js` - Multi-location route support
- `movetrack-api/routes/locations.js` - Enhanced location management
- `movetrack-api/routes/items.js` - Item management improvements
- `movetrack-api/routes/containers.js` - Container improvements
- `movetrack-api/routes/collections.js` - Collection management
- `movetrack-api/package.json` - New dependencies

### Frontend (App) Changes

#### New Files to Add:
- `movetrack-app/src/components/RouteMap.vue` - Google Maps route visualization
- `movetrack-app/src/components/WaypointManager.vue` - Waypoint management UI
- `movetrack-app/src/components/QrCodeCard.vue` - QR code display component
- `movetrack-app/src/views/MobileLocations.vue` - Mobile location management
- `movetrack-app/src/views/MobileMoves.vue` - Mobile move planning
- `movetrack-app/src/views/MobileSettingsPage.vue` - Mobile settings
- `movetrack-app/src/views/Pricing.vue` - Pricing page
- `movetrack-app/src/components/mobile/MobileNavDrawer.vue` - Mobile navigation
- `movetrack-app/src/components/desktop/DesktopMoveDay.vue` - Desktop move day view

#### Modified Files:
- `movetrack-app/src/stores/InventoryStore.ts` - **CRITICAL FIX**: Container creation error
- `movetrack-app/src/components/PhotoCapture.vue` - Multi-item scan improvements
- `movetrack-app/src/components/desktop/DesktopMovePlanning.vue` - Major UI updates
- `movetrack-app/src/router/index.ts` - New routes
- `movetrack-app/src/components/Items.vue` - Item management updates
- Multiple UI component refinements

---

## 2. Database Migration Plan

### Migration Files to Apply (in order):

The following migrations need to be run on production. Since we're okay with data loss, we can use the **consolidated init script** OR run migrations sequentially.

#### Option A: Fresh Database (RECOMMENDED - Simplest)
Use `init-movetrack-fixed.sql` which contains the complete schema including all new tables.

#### Option B: Sequential Migrations
Apply in this exact order:

1. **008_add_saved_moves.sql** - Create saved_moves table
2. **014_move_architecture_v2.sql** - Multi-location architecture
   - Creates: `move_locations`, `move_vehicles`, `move_team_members`, `move_waypoints`, `move_sessions`, `move_session_team`
3. **015_add_segment_distances.sql** - Add segment distance tracking to waypoints
4. **Additional migrations** (if needed for other features):
   - QR codes, collection locations, etc.

### New Tables Created:

1. **saved_moves** - Move planning configurations
2. **move_locations** - Multi-location move support (junction table)
3. **move_vehicles** - Truck/vehicle tracking
4. **move_team_members** - Team member management
5. **move_waypoints** - Route waypoints (gas, rest, overnight stops)
6. **move_sessions** - Loading/driving/unloading sessions
7. **move_session_team** - Session team assignments
8. **plan_usage** - Multi-item scan quota tracking (created dynamically)

### Schema Changes to Existing Tables:

- **locations** - Enhanced with access details (stairs, elevator, parking)
- **containers** - Added dimensions fields
- **items** - Enhanced with QR codes and detailed dimensions

---

## 3. Environment Variables

Ensure these are set in production:

```bash
# Required for route planning
GOOGLE_MAPS_API_KEY=your_production_key

# Multi-item scan limits
BASIC_MULTI_SCANS_PER_WEEK=3

# Billing (if using Stripe)
STRIPE_SECRET_KEY=your_stripe_key
STRIPE_WEBHOOK_SECRET=your_webhook_secret
STRIPE_PRICE_ID_PRO_MONTHLY=price_xxx
STRIPE_PRICE_ID_PRO_ANNUAL=price_xxx
```

---

## 4. Critical Bug Fixes Included

### Bug #1: Container Creation Error
**File:** `movetrack-app/src/stores/InventoryStore.ts:1006`
**Issue:** `TypeError: Cannot read properties of undefined (reading 'id')`
**Fix:** Added validation before accessing `value.data[0].id`

### Bug #2: Multi-Item Scan Limit Premature Trigger
**File:** `movetrack-api/routes/vision.js:221-284`
**Issue:** Quota consumed before API call, users lost credits on failed scans
**Fix:** Moved quota consumption to AFTER successful API response

---

## 5. Deployment Steps

### Step 1: Backup Production Database
```bash
# Create backup before deployment
gcloud sql backups create --instance=YOUR_INSTANCE_NAME
```

### Step 2: Deploy Backend (API)

```bash
# From project root
cd movetrack-api

# Install new dependencies
npm install

# Deploy to Cloud Run
gcloud run deploy movetrack-api \\
  --source . \\
  --region us-central1 \\
  --allow-unauthenticated

# Verify deployment
gcloud run services describe movetrack-api --region us-central1
```

### Step 3: Run Database Migrations

**Option A - Fresh Database (Recommended):**
```bash
# Drop and recreate database (DATA LOSS)
gcloud sql databases delete movetrack_db --instance=YOUR_INSTANCE_NAME
gcloud sql databases create movetrack_db --instance=YOUR_INSTANCE_NAME

# Run init script
PGPASSWORD=your_password psql -h YOUR_DB_HOST -U movetrack_user -d movetrack_db < init-movetrack-fixed.sql
```

**Option B - Sequential Migrations:**
```bash
# Connect to production database
PGPASSWORD=your_password psql -h YOUR_DB_HOST -U movetrack_user -d movetrack_db

# Run migrations in order
\\i movetrack-api/migrations/008_add_saved_moves.sql
\\i movetrack-api/migrations/014_move_architecture_v2.sql
\\i movetrack-api/migrations/015_add_segment_distances.sql
```

### Step 4: Deploy Frontend (App)

```bash
# From project root
cd movetrack-app

# Install new dependencies
npm install

# Build for production
npm run build

# Deploy to Firebase Hosting (or your hosting provider)
firebase deploy --only hosting
```

### Step 5: Verify Deployment

1. **Test Multi-Item Scan:**
   - Attempt multi-item photo capture
   - Verify quota tracking works correctly
   - Confirm no premature limit errors

2. **Test Container Creation:**
   - Create a new container
   - Verify no JavaScript errors

3. **Test Move Planning:**
   - Create a new move with multiple locations
   - Add waypoints
   - Calculate route
   - Verify map display

4. **Test Route Map:**
   - Verify Google Maps loads
   - Check that satellite toggle is hidden (Map view only)
   - Confirm waypoint markers display correctly

---

## 6. Rollback Plan

If issues occur:

### Database Rollback:
```bash
# Restore from backup
gcloud sql backups restore BACKUP_ID \\
  --backup-instance=YOUR_INSTANCE_NAME \\
  --restore-instance=YOUR_INSTANCE_NAME
```

### Code Rollback:
```bash
# Rollback to previous Cloud Run revision
gcloud run services update-traffic movetrack-api \\
  --to-revisions=PREVIOUS_REVISION=100 \\
  --region us-central1
```

---

## 7. Post-Deployment Monitoring

Monitor these endpoints for errors:

1. `/api/vision/analyze-multi-item` - Multi-item scanning
2. `/api/saved-moves` - Move planning
3. `/api/waypoints` - Waypoint management
4. `/api/distance/calculate-distance` - Route calculation

Check logs:
```bash
# API logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=movetrack-api" --limit 100 --format json

# Check for errors
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=movetrack-api AND severity>=ERROR" --limit 50
```

---

## 8. Key Feature Summary for Users

After deployment, users will have:

1. **Multi-Location Moves** - Plan moves with multiple pickup/dropoff locations
2. **Route Planning** - Google Maps integration with distance/duration
3. **Waypoint Management** - Add overnight stops, gas stations, rest stops
4. **Smart Packing** - Enhanced container and item management
5. **Mobile-Optimized Views** - Better mobile experience for locations and moves
6. **Fixed Bugs**:
   - Container creation no longer crashes
   - Multi-item scan quota works correctly

---

## 9. Files NOT to Commit

These are development/documentation files:

- `.claude/settings.local.json`
- `# API Route Analysis and Correction Repo.md`
- `# Database Schema Analysis and Correctio.md`
- `HUGGINGFACE_ISSUE.md`
- `seed-apartment-data.sql`
- `movetrack-api/test-*.js` files

---

## 10. Commit Message

```
Route planning and UI refinements for production

Major features:
- Multi-location move planning with route optimization
- Waypoint management (overnight stops, gas, rest)
- Google Maps integration with interactive route visualization
- Mobile-optimized location and move management views

Critical fixes:
- Fixed container creation error (InventoryStore.ts:1006)
- Fixed multi-item scan quota bug (only consume on success)

UI improvements:
- Full-width flex layout for location cards (5-stop limit)
- Removed Map/Satellite toggle, force Map view only
- Increased waypoint card transparency (0.65 opacity)
- Destination name displays in waypoint list with flag icon

Database migrations:
- 008: saved_moves table
- 014: Multi-location architecture (move_locations, move_vehicles, etc.)
- 015: Waypoint segment distances

New dependencies:
- Google Maps JavaScript API
- Enhanced geocoding services
- QR code generation

Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## 11. Success Criteria

Deployment is successful when:

- ✅ All Cloud Run services healthy
- ✅ Database migrations complete without errors
- ✅ Multi-item scanning quota works (3 scans/week for Basic plan)
- ✅ Container creation works without errors
- ✅ Users can create multi-location moves
- ✅ Route maps display correctly
- ✅ Waypoints can be added/removed
- ✅ No critical errors in logs for 24 hours

---

**Prepared by:** Claude Code
**Review Status:** Ready for production deployment
**Risk Level:** Medium (significant schema changes, but data loss acceptable)
