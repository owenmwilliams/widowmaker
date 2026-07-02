# Service Map — File Moves & Extractions

Tracks every file that moved, was created, or was deleted during the `refactor/api-folder-structure` work.

## Moves (file relocated)

| From | To | Reason |
|------|----|--------|
| `bin/censusAgentService.js` | `agents/censusAgent.js` | Agent layer |
| `bin/nexusService.js` | `agents/nexusOrchestratorAgent.js` | Agent layer |
| `bin/vectorService.js` | `agents/vectorAgent.js` | Agent layer |
| `services/distanceUtils.js` | `services/primitives/distanceUtils.js` | Reusable calculation |
| `services/itemEstimationService.js` | `services/primitives/itemEstimationService.js` | Reusable calculation |
| `services/qrService.js` | `services/primitives/qrService.js` | Reusable calculation |
| `services/geocodingService.js` | `services/infra/geocodingService.js` | Google Maps API wrapper = infra |
| `services/images/` | `services/primitives/images/` | Reusable utilities |
| `services/shared/geminiHistoryBuilder.js` | `services/infra/geminiHistoryBuilder.js` | Gemini SDK plumbing = infra |
| `services/vision/` | `services/infra/vision/` | Model-integration plumbing = infra |
| `services/infra/modelConnectionService.js` | `scripts/modelConnectionTest.js` | CLI-only tool, not a service |

## New Files (extracted from agents)

| File | Extracted From | Contents |
|------|---------------|----------|
| `services/infra/knex.js` | censusAgent + vectorAgent inline pools | Shared Knex singleton |
| `services/inventory/inventoryMutationService.js` | censusAgent tool handlers | addItem, updateItem, deleteItem, addRoom, updateRoom, updateLocation, findOrCreateRoom, getPrimaryLocationId |
| `services/inventory/inventoryQueryService.js` | censusAgent + vectorAgent | searchItems, getItemPhoto, getInventoryTotals |
| `services/inventory/duplicateDetectionService.js` | censusAgent tool handlers | findDuplicates, levenshtein |
| `services/inventory/mediaInventoryWorkflowService.js` | censusAgent tool handlers | analyzePhotoForInventory, analyzeVideoForInventory |
| `services/infra/mediaDownloadService.js` | `mediaInventoryWorkflowService.js`'s inline `downloadBuffer` (Pathway A, issue #40) | downloadBuffer, MediaDownloadError |
| `services/move/truckSizingService.js` | vectorAgent inline logic | TRUCK_SIZES, recommendTruckSize |
| `services/move/moveCostService.js` | vectorAgent inline logic | COST_PARAMS, estimateMoveCost |
| `services/move/laborEstimationService.js` | vectorAgent inline logic | estimateLabor |
| `services/move/specialHandlingService.js` | vectorAgent inline logic | flagSpecialItems |
| `services/move/routeService.js` | vectorAgent inline logic | calculateRoute |
| `services/move/moveSummaryService.js` | vectorAgent inline logic | getMoveSummary, estimateMissingItems, getRoomBreakdown |
| `services/workflow/onboardingService.js` | censusAgent tool handlers | setUserProfile, setLocation, markOnboardingComplete |
| `services/workflow/agentDelegationService.js` | nexusOrchestratorAgent | buildToolHandlers |
| `services/primitives/enrichMessages.js` | 3 route files (census, nexus, vector) | enrichMessagesWithActions |

## Directory Renames

| Old Name | New Name | Rationale |
|----------|----------|-----------|
| `services/census/` | `services/inventory/` | Domain clarity — items, rooms, inference, readiness |
| `services/vector/` | `services/move/` | Domain clarity — truck, labor, cost, route |
| `services/orchestrator/` | `services/workflow/` | Domain clarity — user + session + progression |
| `services/shared/` | `services/primitives/` | Reusable calculations, not "shared" grab-bag |

## Deleted

| File | Reason |
|------|--------|
| `services/infra/gcp.js` | 0 imports — unused Cloud SQL helper |
| `services/infra/twelveLabsService.js` | 0 imports — superseded by Gemini video |
| `services/images/transform.js` | 0 imports — unused transforms |

## Agent Line Count Reduction

| Agent | Before | After | Reduction |
|-------|--------|-------|-----------|
| censusAgent.js | ~1400 | ~772 | 45% |
| vectorAgent.js | ~1046 | ~486 | 54% |
| nexusOrchestratorAgent.js | ~472 | ~460 | 3% (gained onboarding, lost buildToolHandlers) |
