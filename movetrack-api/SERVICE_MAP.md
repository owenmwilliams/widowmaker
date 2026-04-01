# Service Map — File Moves & Extractions

Tracks every file that moved, was created, or was deleted during the `refactor/api-folder-structure` work.

## Moves (file relocated)

| From | To | Reason |
|------|----|--------|
| `bin/censusAgentService.js` | `agents/censusAgent.js` | Agent layer |
| `bin/nexusService.js` | `agents/nexusOrchestratorAgent.js` | Agent layer |
| `bin/vectorService.js` | `agents/vectorAgent.js` | Agent layer |
| `services/distanceUtils.js` | `services/shared/distanceUtils.js` | Neutral utility |
| `services/itemEstimationService.js` | `services/shared/itemEstimationService.js` | Neutral utility |
| `services/qrService.js` | `services/shared/qrService.js` | Neutral utility |
| `services/geocodingService.js` | `services/infra/geocodingService.js` | Google Maps API wrapper = infra |
| `services/images/` | `services/shared/images/` | Neutral utilities |
| `services/shared/geminiHistoryBuilder.js` | `services/infra/geminiHistoryBuilder.js` | Gemini SDK plumbing = infra |
| `services/vision/` | `services/infra/vision/` | Model-integration plumbing = infra |
| `services/infra/modelConnectionService.js` | `scripts/modelConnectionTest.js` | CLI-only tool, not a service |

## New Files (extracted from agents)

| File | Extracted From | Contents |
|------|---------------|----------|
| `services/infra/knex.js` | censusAgent + vectorAgent inline pools | Shared Knex singleton |
| `services/census/inventoryMutationService.js` | censusAgent tool handlers | addItem, updateItem, deleteItem, addRoom, updateRoom, updateLocation, findOrCreateRoom, getPrimaryLocationId |
| `services/census/inventoryQueryService.js` | censusAgent + vectorAgent | searchItems, getItemPhoto, getInventoryTotals |
| `services/census/duplicateDetectionService.js` | censusAgent tool handlers | findDuplicates, levenshtein |
| `services/census/mediaInventoryWorkflowService.js` | censusAgent tool handlers | analyzePhotoForInventory, analyzeVideoForInventory, downloadBuffer |
| `services/vector/truckSizingService.js` | vectorAgent inline logic | TRUCK_SIZES, recommendTruckSize |
| `services/vector/moveCostService.js` | vectorAgent inline logic | COST_PARAMS, estimateMoveCost |
| `services/vector/laborEstimationService.js` | vectorAgent inline logic | estimateLabor |
| `services/vector/specialHandlingService.js` | vectorAgent inline logic | flagSpecialItems |
| `services/vector/routeService.js` | vectorAgent inline logic | calculateRoute |
| `services/vector/moveSummaryService.js` | vectorAgent inline logic | getMoveSummary, estimateMissingItems, getRoomBreakdown |
| `services/orchestrator/onboardingService.js` | censusAgent tool handlers | setUserProfile, setLocation, markOnboardingComplete |
| `services/orchestrator/agentDelegationService.js` | nexusOrchestratorAgent | buildToolHandlers |
| `services/shared/enrichMessages.js` | 3 route files (census, nexus, vector) | enrichMessagesWithActions |

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
