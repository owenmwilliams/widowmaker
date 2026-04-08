# Service Map — Refactor History

> Written: 2025-04-01 | Status: **Current** | Tracks all moves during `refactor/api-folder-structure`

## Phase 1: Agent Extraction

Agents moved from `bin/` to `agents/`, business logic extracted to service layer.

### Moves

| From | To | Reason |
|------|----|--------|
| `bin/censusAgentService.js` | `agents/censusAgent.js` | Agent layer |
| `bin/nexusService.js` | `agents/nexusOrchestratorAgent.js` | Agent layer |
| `bin/vectorService.js` | `agents/vectorAgent.js` | Agent layer |

### New Files (extracted from agents)

| File | Extracted From | Contents |
|------|---------------|----------|
| `services/infra/knex.js` | censusAgent + vectorAgent inline pools | Shared Knex singleton |
| `services/inventory/inventoryMutationService.js` | censusAgent tool handlers | addItem, updateItem, deleteItem, addRoom, updateRoom, updateLocation |
| `services/inventory/duplicateDetectionService.js` | censusAgent tool handlers | findDuplicates, levenshtein |
| `services/inventory/mediaInventoryWorkflowService.js` | censusAgent tool handlers | analyzePhotoForInventory, analyzeVideoForInventory |
| `services/move/trucksService.js` | vectorAgent inline logic | TRUCK_SIZES, recommendTruckSize |
| `services/move/moveCostService.js` | vectorAgent inline logic | estimateMoveCost |
| `services/move/laborEstimationService.js` | vectorAgent inline logic | estimateLabor |
| `services/move/specialHandlingService.js` | vectorAgent inline logic | flagSpecialItems |
| `services/move/routeService.js` | vectorAgent inline logic | calculateRoute |
| `services/move/moveSummaryService.js` | vectorAgent inline logic | getMoveSummary, estimateMissingItems, getRoomBreakdown |
| `services/workflow/onboardingService.js` | censusAgent tool handlers | setUserProfile, setLocation, markOnboardingComplete |
| `services/workflow/agentDelegationService.js` | nexusOrchestratorAgent | buildToolHandlers |

### Directory Renames

| Old Name | New Name | Rationale |
|----------|----------|-----------|
| `services/census/` | `services/inventory/` | Domain clarity — items, rooms, inference, readiness |
| `services/vector/` | `services/move/` | Domain clarity — truck, labor, cost, route |
| `services/orchestrator/` | `services/workflow/` | Domain clarity — user + session + progression |
| `services/shared/` | `services/primitives/` | Reusable calculations (later dissolved — see Phase 2) |

## Phase 2: Primitives Dissolution + censusService Decomposition

Dissolved `services/primitives/` — moved all files to domain folders. Decomposed `censusService.js` into targeted services.

### Moves (primitives to domain folders)

| From | To | Reason |
|------|----|--------|
| `services/primitives/dateService.js` | `services/infra/dateUtils.js` | Cross-cutting utility |
| `services/primitives/distanceService.js` | `services/move/distanceService.js` | Distance/route logic |
| `services/primitives/enrichMessages.js` | merged into `services/infra/agentSessionService.js` | Shared by all 3 agent routes, already imported agentSessionService |
| `services/primitives/itemEstimationService.js` | `services/inventory/itemEstimationService.js` | Item estimation |
| `services/primitives/itemParsingUtils.js` | `services/inventory/itemParsingUtils.js` | Item parsing |
| `services/primitives/qrService.js` | `services/inventory/qrService.js` | QR tokens for items/containers |
| `services/primitives/images/bbox.js` + `images/crop.js` | combined into `services/infra/vision/imageUtils.js` | crop.js required bbox.js internally; merged and eliminated internal require |

### New Files (extracted from censusService.js)

| File | Contents | Destination Rationale |
|------|----------|-----------------------|
| `services/inventory/inventoryReferenceData.js` | `REFERENCE_ROOMS`, `TYPICAL_ITEMS` constants | Data constants for gap analysis |
| `services/inventory/inventoryMaturityService.js` | `getMissingContext`, `getTypicalItems`, `inventoryReadinessAssessment` | Inventory completeness scoring |
| `services/move/moveMaturityService.js` | *(placeholder)* | Future move readiness assessment |
| `services/workflow/userMaturityService.js` | *(placeholder)* | Future user profile completeness |

### Merged into existing files (from censusService.js)

| Function(s) | Merged Into | Reason |
|-------------|-------------|--------|
| `getInventoryTextSummary` | `services/inventory/inventorySummaryQueryService.js` | AI text summary sits with other summary queries |
| `getConversationStarters`, `getQuickStartChips` | `services/infra/agentSessionService.js` | Session-level context used by agent routes |

### Deleted

| File | Reason |
|------|--------|
| `services/inventory/censusService.js` | Fully decomposed into inventoryReferenceData, inventoryMaturityService, inventorySummaryQueryService, agentSessionService |
| `services/primitives/` (entire folder) | All files moved to domain folders |
| `services/infra/gcp.js` | 0 imports — unused Cloud SQL helper |
| `services/infra/twelveLabsService.js` | 0 imports — superseded by Gemini video |
| `services/images/transform.js` | 0 imports — unused transforms |

## Phase 3: inventoryQueryService Split

Split the monolithic `inventoryQueryService.js` (705 lines) into three focused services.

| From | To | Functions |
|------|----|-----------|
| `inventoryQueryService.js` | `inventoryItemQueryService.js` | `searchItems`, `getItemPhoto`, `getItemsByContainer`, `getSingleItem`, `getAllItems`, `getLooseItems` |
| `inventoryQueryService.js` | `inventoryStructureQueryService.js` | `getAllLocations`, `getSingleLocation`, 4 collection queries, 4 container queries |
| `inventoryQueryService.js` | `inventorySummaryQueryService.js` | `getInventoryTotals`, `getInventorySnapshot`, `getInventoryTextSummary` |

### Deleted

| File | Reason |
|------|--------|
| `services/inventory/inventoryQueryService.js` | Split into 3 targeted query services |

## Phase 4: Tool Reassignment

| Change | Reason |
|--------|--------|
| `estimate_missing_items` removed from vectorAgent | Fills in inventory data (weights/dimensions) — belongs with inventory agent |
| `estimate_missing_items` added to censusAgent | Census owns inventory completeness and readiness |

## Current File Tree (services/)

```
services/
  analytics/
    reportingService.js
  infra/
    agentSessionService.js          Sessions, enrichMessages, conversation starters, quick-start chips
    auth.js                         Google OAuth helper
    authService.js                  Session auth, middleware, plan resolution
    dateUtils.js                    UTC week-start
    db.js                           pg-promise connection
    gcsService.js                   GCS uploads + signed URLs
    geminiHistoryBuilder.js         DB rows → Gemini contents format
    geocodingService.js             Google Places API
    imageCleanupService.js          Orphaned image cleanup
    jwtMiddleware.js                JWT verification
    knex.js                         Knex singleton
    metricsService.js               Interaction metrics logging
    vision/
      augmentationService.js        Image augmentation
      frameExtractor.js             ffmpeg frame extraction
      geminiVideoScanService.js     Gemini video analysis
      imageService.js               Image analysis orchestration
      imageUtils.js                 Bbox math, pixel crop
      videoService.js               Video analysis orchestration
      visionService.js              Multi-provider vision wrapper
  inventory/
    duplicateDetectionService.js    Levenshtein duplicate detection
    inventoryItemQueryService.js    Item search, photo lookup, item reads
    inventoryMaturityService.js     Gap analysis, readiness scoring
    inventoryMutationService.js     Item/room/location/container writes
    inventoryReferenceData.js       REFERENCE_ROOMS, TYPICAL_ITEMS
    inventoryStructureQueryService.js  Location/collection/container hierarchy reads
    inventorySummaryQueryService.js Totals, snapshot, AI text summary
    itemEstimationService.js        AI weight/dimension estimation
    itemParsingUtils.js             Dimension parsing, tag normalization
    mediaInventoryWorkflowService.js  Photo/video → item detection workflow
    qrService.js                    QR token generation
  move/
    distanceService.js              Haversine, road factor, Google Directions, city-pair fallback
    laborEstimationService.js       Load/unload time, crew sizing
    moveCoordinationService.js      Move-day sessions, box assignments, tasks
    moveCostService.js              DIY + professional cost estimation
    moveMaturityService.js          (placeholder) Move readiness assessment
    moveMutationService.js          Saved move CRUD, truck CRUD
    moveQueryService.js             Saved move reads, waypoints
    moveSummaryService.js           Move summary, missing item estimation, room breakdown
    routeService.js                 Route calculation (Google Directions API)
    specialHandlingService.js       Oversized/heavy/fragile item flagging
    trucksService.js                TRUCK_SIZES, truck recommendations
  workflow/
    agentDelegationService.js       Orchestrator tool handler factory
    onboardingService.js            Profile setup, location creation, onboarding completion
    userDeleteService.js            Cascade user deletion
    userMaturityService.js          (placeholder) User profile completeness
    userService.js                  User profile reads/writes, weekly metrics
```

## Agent Line Counts

| Agent | Before Refactor | Current | Reduction |
|-------|----------------|---------|-----------|
| censusAgent.js | ~1400 | 787 | 44% |
| vectorAgent.js | ~1046 | 473 | 55% |
| nexusOrchestratorAgent.js | ~472 | 460 | 3% |
