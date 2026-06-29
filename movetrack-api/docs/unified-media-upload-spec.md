# Unified Media Upload Spec

> Written: 2026-04-10 | Status: Proposed

## Goal

Consolidate user-uploaded media onto a single ingestion and tracking pathway.

This spec makes three explicit decisions:

1. Extend `image_uploads` rather than replacing it.
2. Point Nexus/Census chat uploads at that same service.
3. Survey the full codebase for other upload logic and classify what should migrate now vs later.

## Problem Statement

The codebase currently uses one storage backend, Google Cloud Storage, but multiple upload lifecycles:

- Inventory item photo uploads go through [`userFiles.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/user/userFiles.js), write to GCS, and create an `image_uploads` row.
- Nexus and Census chat uploads go through [`routes/api/agents/nexus.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/agents/nexus.js) and [`routes/api/agents/census.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/agents/census.js), write to GCS via `gcs.uploadAgentFile(...)`, but do not create an `image_uploads` row.
- Vision video upload writes to GCS via [`routes/api/vision/video.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/vision/video.js), but also does not create an `image_uploads` row.
- Inventory workflow services generate derivative crops and frames directly into GCS via [`mediaInventoryWorkflowService.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/services/inventory/mediaInventoryWorkflowService.js) and [`frameExtractor.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/services/infra/vision/frameExtractor.js) without asset tracking.

Result:

- orphan cleanup only works for some uploads
- account deletion only reliably knows about tracked uploads
- chat attachments are persisted in `nexus_messages.attachments` but are not first-class tracked assets
- linkage is URL-based in some places instead of ID-based
- local-dev behavior differs by route

## Scope

### In Scope

- User-uploaded images and videos intended for product use
- Chat uploads in Nexus and Census
- Inventory item photo uploads
- Video walkthrough uploads
- Derivative images generated from user uploads if they are retained beyond transient processing

### Out of Scope For This Iteration

- Email attachments in [`routes/admin/email.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/admin/email.js)
- Experimental Vision Lab frame uploads in [`routes/experimental/visionLabVideo.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/experimental/visionLabVideo.js)
- Purely in-memory analysis uploads that are not retained in GCS, such as [`routes/api/vision/image.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/vision/image.js)

These should be documented and revisited, but they do not need to block the main consolidation.

## Codebase Survey

### Canonical tracked upload path today

- [`routes/api/user/userFiles.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/user/userFiles.js)
  - `POST /upload/:bucket`
  - uses `multer.memoryStorage()`
  - writes to GCS directly
  - inserts into `image_uploads`
  - returns `url`, `signed_url`, `fileName`, `bucket`, `size`

### Untracked chat upload paths

- [`routes/api/agents/nexus.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/agents/nexus.js)
  - `POST /upload`
  - calls `gcs.uploadAgentFile(...)`
  - no `image_uploads` insert

- [`routes/api/agents/census.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/agents/census.js)
  - `POST /upload`
  - calls `gcs.uploadAgentFile(...)`
  - no `image_uploads` insert

- [`movetrack-app/src/stores/NexusStore.ts`](/Users/owenwilliams/Projects/widowmaker/movetrack-app/src/stores/NexusStore.ts)
  - `uploadPhoto(file)` posts to `/api/agents/nexus/upload`
  - message send persists attachment JSON only

### Inventory photo upload callers

- [`movetrack-app/src/stores/InventoryStore.ts`](/Users/owenwilliams/Projects/widowmaker/movetrack-app/src/stores/InventoryStore.ts)
  - uploads item photos to `/file/upload/movetrack-item-photos/`

- [`movetrack-app/src/components/capture/PhotoCapture.vue`](/Users/owenwilliams/Projects/widowmaker/movetrack-app/src/components/capture/PhotoCapture.vue)
  - `uploadImageToGCS(...)` posts to `/file/upload/movetrack-item-photos`
  - uses upload-first flow for item analysis and creation

### Linking and cleanup logic

- [`routes/api/inventory/items.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/inventory/items.js)
  - calls `markImageLinked(params.picture_url, req.query.item_id)` after image attachment to item

- [`services/infra/imageCleanupService.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/services/infra/imageCleanupService.js)
  - cleanup of orphaned uploads
  - `markImageLinked(imageUrl, itemId)` is URL-based

- [`services/workflow/userDeleteService.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/services/workflow/userDeleteService.js)
  - deletes only assets represented in `image_uploads`

### Other GCS-writing paths found in survey

- [`routes/api/vision/video.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/vision/video.js)
  - uploads user video walkthrough to GCS
  - not tracked in `image_uploads`

- [`services/inventory/mediaInventoryWorkflowService.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/services/inventory/mediaInventoryWorkflowService.js)
  - uploads cropped item images and extracted video frames to GCS
  - not tracked

- [`services/infra/vision/frameExtractor.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/services/infra/vision/frameExtractor.js)
  - uploads video thumbnails to GCS
  - not tracked

### Non-persistent or non-product upload paths

- [`routes/api/vision/image.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/vision/image.js)
  - accepts uploaded file or `imageUrl`
  - used for analysis, not persistent storage

- [`routes/experimental/visionLabVideo.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/experimental/visionLabVideo.js)
  - receives uploaded frames
  - stores data URLs in memory only

- [`routes/admin/email.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/admin/email.js)
  - accepts email attachments
  - passes them to SMTP, not GCS

## Decisions

### 1. Extend `image_uploads`

`image_uploads` becomes the canonical asset registry for persisted user media.

We will not create a second table in this iteration. We will extend the existing table to represent:

- original uploads
- chat attachments
- inventory item photos
- video walkthrough uploads
- retained derived artifacts where needed

### 2. Reuse one ingestion service

Create a single backend service, tentatively:

- `services/infra/mediaAssetService.js`

This service becomes the only approved path for persistent media ingestion.

All persistent upload routes will call it instead of writing to GCS directly.

### 3. Chat uploads become tracked assets

Nexus and Census chat uploads will create `image_uploads` rows immediately.

When the corresponding message is saved, those assets will be linked to the created `nexus_messages` row.

### 4. Link by asset ID, not by URL

The system should stop using `picture_url` string matching as the primary linking mechanism.

Uploads will return an `assetId`, and callers will pass it forward when linking to an item or chat message.

### 5. Signed URLs are read-time only

Durable storage should keep canonical object identity, not signed URLs.

Persist:

- `gcs_bucket`
- `gcs_path`
- canonical public URL if needed for compatibility

Do not persist signed URLs.

## Target Data Model

Extend `image_uploads` with the following columns:

- `source` `TEXT NOT NULL DEFAULT 'inventory_item'`
  - examples: `inventory_item`, `nexus_chat`, `census_chat`, `video_scan`, `derived_crop`, `derived_thumbnail`

- `asset_type` `TEXT NOT NULL DEFAULT 'image'`
  - allowed values: `image`, `video`

- `status` `TEXT NOT NULL DEFAULT 'uploaded'`
  - allowed values: `uploaded`, `linked`, `deleted`

- `linked_to_entity_type` `TEXT NULL`
  - examples: `item`, `nexus_message`, `scan_session`

- `linked_to_entity_id` `TEXT NULL`
  - stored as text to support mixed key types without premature schema coupling

- `upload_session_id` `UUID NULL`
  - for chat sessions or scan sessions where helpful

- `metadata` `JSONB NOT NULL DEFAULT '{}'::jsonb`
  - for original filename, dimensions, duration, derivation info, etc.

Existing columns retained:

- `user_id`
- `image_url`
- `gcs_bucket`
- `gcs_path`
- `file_size`
- `mime_type`
- `uploaded_at`
- `linked_to_item_id`
- `linked_at`
- `is_orphaned`

### Compatibility Rule

`linked_to_item_id` remains for now so existing cleanup scripts and reporting continue to work.

New code should prefer:

- `linked_to_entity_type`
- `linked_to_entity_id`

`linked_to_item_id` becomes a compatibility mirror for item-linked assets only.

## Target Service API

Add `services/infra/mediaAssetService.js` with the following operations:

### `ingestUpload(options)`

Inputs:

- `userId`
- `buffer`
- `mimeType`
- `originalName`
- `source`
- `folderHint`
- `uploadSessionId`
- `metadata`

Behavior:

- validate auth context
- validate size and MIME type
- choose canonical GCS path
- upload to GCS
- insert `image_uploads` row
- return normalized asset payload

Returns:

- `assetId`
- `url`
- `mimeType`
- `bucket`
- `gcsPath`
- `size`
- `source`
- `assetType`

### `linkAsset(options)`

Inputs:

- `assetId`
- `userId`
- `entityType`
- `entityId`
- `linkedToItemId` optional

Behavior:

- assert asset ownership
- mark `status='linked'`
- set `linked_at`
- set `is_orphaned=false`
- set `linked_to_entity_type`
- set `linked_to_entity_id`
- if item-linked, set `linked_to_item_id`

### `deleteAsset(options)`

Inputs:

- `assetId`
- `userId`

Behavior:

- delete object from GCS if present
- mark or remove DB row according to current policy

### `cleanupUnlinkedAssets()`

Behavior:

- cleanup all stale `uploaded` assets older than threshold
- replace orphan cleanup logic currently centered on only item-photo uploads

## Canonical Pathing Rules

Persistent media should follow one pathing policy:

- chat uploads:
  - `users/<userId>/chat/<agent>/<assetId>.<ext>`
- inventory item uploads:
  - `users/<userId>/inventory/items/<assetId>.<ext>`
- video walkthrough uploads:
  - `users/<userId>/room-scans/<scanId>/source.<ext>`
- derived crops:
  - `users/<userId>/derived/crops/<assetId>.jpg`
- derived thumbnails:
  - `users/<userId>/derived/thumbnails/<assetId>.jpg`

This removes route-specific ad hoc path construction.

## Endpoint Changes

### Phase 1: Backend compatibility

Keep existing routes, but route them through `mediaAssetService`.

#### `POST /file/upload/:bucket`

Change behavior:

- stop writing directly to GCS inside route
- call `mediaAssetService.ingestUpload(...)`
- continue returning existing response fields
- add `assetId`

#### `POST /api/agents/nexus/upload`

Change behavior:

- replace `gcs.uploadAgentFile(...)`
- call `mediaAssetService.ingestUpload(...)` with `source='nexus_chat'`
- return `assetId`, `url`, `mimeType`, `gcsPath`

#### `POST /api/agents/census/upload`

Change behavior:

- replace `gcs.uploadAgentFile(...)`
- call `mediaAssetService.ingestUpload(...)` with `source='census_chat'`
- return `assetId`, `url`, `mimeType`, `gcsPath`

#### `POST /api/vision/video/upload`

Change behavior:

- use `mediaAssetService.ingestUpload(...)` for the original uploaded video
- set `source='video_scan'`, `asset_type='video'`

### Phase 2: Linking on write

#### Nexus/Census message persistence

When user message rows are created in:

- [`agents/nexusOrchestratorAgent.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/agents/nexusOrchestratorAgent.js)
- [`agents/censusAgent.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/agents/censusAgent.js)

attachments should include `assetId`.

After `nexus_messages` insert:

- call `mediaAssetService.linkAsset(...)` for each attachment
- `entityType='nexus_message'`
- `entityId=<message id>`

#### Inventory item updates

In [`routes/api/inventory/items.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/inventory/items.js):

- prefer `picture_asset_id` over URL-only linkage
- after item update, link asset via `assetId`
- keep URL fallback temporarily for backward compatibility

## Frontend Contract Changes

### Nexus chat

Change pending attachments in:

- [`movetrack-app/src/components/nexus/NexusChat.vue`](/Users/owenwilliams/Projects/widowmaker/movetrack-app/src/components/nexus/NexusChat.vue)
- [`movetrack-app/src/stores/NexusStore.ts`](/Users/owenwilliams/Projects/widowmaker/movetrack-app/src/stores/NexusStore.ts)

From:

- `{ url, mimeType }`

To:

- `{ assetId, url, mimeType }`

`sendMessage(...)` should pass `assetId` through to backend.

### Inventory item flows

Update:

- [`movetrack-app/src/stores/InventoryStore.ts`](/Users/owenwilliams/Projects/widowmaker/movetrack-app/src/stores/InventoryStore.ts)
- [`movetrack-app/src/components/capture/PhotoCapture.vue`](/Users/owenwilliams/Projects/widowmaker/movetrack-app/src/components/capture/PhotoCapture.vue)

Upload responses should capture `assetId`.

Item create/update flows should pass `picture_asset_id` when available.

## Derived Media Policy

Not all uploads written to GCS are equal.

### Original user uploads

These must always be tracked in `image_uploads`.

### Derived media retained for product use

Examples:

- cropped item images
- extracted thumbnails shown to users
- representative video frames retained in item records

These should also be tracked in `image_uploads`, with:

- `source='derived_crop'` or `source='derived_thumbnail'`
- `metadata.parent_asset_id`

### Temporary processing artifacts

If a file is only transient and never referenced later, it does not need a row in `image_uploads`.

## Local Development Rule

Current local behavior is inconsistent.

New rule:

- all persistent upload endpoints should still create an `image_uploads` row in local dev
- storage mode can be one of:
  - real local GCS credentials
  - local fake URL mode

If fake URL mode is used:

- generate deterministic fake public URLs
- still persist the asset row

This keeps lifecycle behavior consistent across environments.

## Migration Plan

### Step 1. Schema migration

Add columns and indexes to `image_uploads`.

Indexes to add:

- `(user_id, status, uploaded_at)`
- `(linked_to_entity_type, linked_to_entity_id)`
- `(source, uploaded_at)`

Do not remove existing indexes yet.

### Step 2. Build `mediaAssetService`

Responsibilities:

- path generation
- upload validation
- GCS write
- DB insert
- asset linking
- deletion
- cleanup query replacement

### Step 3. Move tracked inventory upload route to service

Refactor [`userFiles.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/user/userFiles.js) to call the new service first, because it already matches the intended lifecycle most closely.

### Step 4. Move Nexus and Census upload routes

Refactor:

- [`routes/api/agents/nexus.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/agents/nexus.js)
- [`routes/api/agents/census.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/agents/census.js)

Return `assetId` immediately.

### Step 5. Add message-level asset linkage

Update the message persistence path in both agents to link uploaded assets after message insert.

### Step 6. Add item-level asset linkage by ID

Update inventory create/update calls to use `picture_asset_id`.

Keep URL-based fallback during migration.

### Step 7. Bring video walkthrough uploads into the same registry

Refactor [`routes/api/vision/video.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/vision/video.js) to ingest the original uploaded video through the same service.

### Step 8. Decide derived-media coverage

Add tracking for derivative crops and thumbnails that are retained or user-visible.

This can happen after original uploads and chat assets are unified.

### Step 9. Replace cleanup and delete logic

Refactor:

- [`services/infra/imageCleanupService.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/services/infra/imageCleanupService.js)
- [`services/workflow/userDeleteService.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/services/workflow/userDeleteService.js)

to operate on the broader asset model rather than inventory-only assumptions.

## Backward Compatibility

During rollout:

- continue returning `url` in upload responses
- accept attachment objects without `assetId` for a limited period
- accept item updates with only `picture_url`
- if only `picture_url` exists, keep legacy URL matching as a fallback

The target state is ID-first, URL-second.

## Risks and Mitigations

### Risk: dual linking models during migration

Mitigation:

- keep `linked_to_item_id`
- add compatibility fallback
- instrument missing `assetId` cases

### Risk: derived media explosion

Mitigation:

- phase derivative tracking after originals
- add `source` and `metadata.parent_asset_id`

### Risk: local-dev confusion

Mitigation:

- unify local row creation behavior now
- keep storage transport configurable

### Risk: old cleanup scripts assume inventory-only semantics

Mitigation:

- update scripts after schema migration
- classify by `source` and `status`, not only `is_orphaned`

## Acceptance Criteria

The consolidation is complete when all of the following are true:

- every persistent user media upload creates an `image_uploads` row
- Nexus and Census chat uploads return `assetId`
- chat attachments are linked to `nexus_messages` by asset ID
- item photos are linked to items by asset ID
- original video walkthrough uploads are tracked in `image_uploads`
- cleanup operates on the unified asset registry
- account deletion removes all persisted user media, not only inventory photo uploads

## Immediate Implementation Order

1. Add migration extending `image_uploads`.
2. Implement `mediaAssetService`.
3. Refactor `userFiles.js` to use it.
4. Refactor `nexus.js` and `census.js` upload routes to use it.
5. Add `assetId` support in frontend upload responses and message payloads.
6. Link chat uploads to `nexus_messages`.
7. Link inventory uploads to items by `picture_asset_id`.
8. Refactor video walkthrough upload to use the same service.
9. Expand cleanup and account deletion to unified asset semantics.

## Follow-Up Survey Targets

These paths should be revisited after the main migration:

- [`services/inventory/mediaInventoryWorkflowService.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/services/inventory/mediaInventoryWorkflowService.js)
- [`services/infra/vision/frameExtractor.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/services/infra/vision/frameExtractor.js)
- [`routes/api/vision/image.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/api/vision/image.js)
- [`routes/experimental/visionLabVideo.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/experimental/visionLabVideo.js)
- [`routes/admin/email.js`](/Users/owenwilliams/Projects/widowmaker/movetrack-api/routes/admin/email.js)

Those are real upload or file-handling paths, but not all belong in the first unified asset rollout.
