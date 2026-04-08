# movetrack-api Architecture

> Written: 2025-04-01 | Status: **Current** | Last updated during `refactor/api-folder-structure`

## Layer Overview

```
routes/                → Transport only (HTTP, SSE, file upload). No business logic.
  api/agents/          → Agent chat endpoints (POST /message, GET /sessions)
  api/inventory/       → CRUD for locations, collections, containers, items, snapshot
  api/move/            → Move CRUD, move-day coordination, routing/waypoints
  api/user/            → Auth, profile, file uploads, onboarding
  api/vision/          → Image + video processing endpoints
  admin/               → Analytics, email, maintenance
  auth/                → Google OAuth, magic links
  billing/             → Stripe integration
  experimental/        → Vision lab (photo + video)

agents/                → AI orchestration (Gemini tool-calling loops).
                         Thin delegates to services for all business logic.

services/
  infra/               → DB, auth, storage, GCS, metrics, Gemini history, geocoding
  infra/vision/        → Vision providers (Gemini, Claude, OpenAI, HuggingFace, Together.ai),
                         frame extraction, bbox/crop utilities, augmentation
  inventory/           → Items, rooms, containers, queries, mutations, maturity, estimation
  move/                → Trucks, labor, cost, route, distance, special handling, move-day
  workflow/            → Onboarding, agent delegation, user management
  analytics/           → Reporting

scripts/               → CLI tools, one-off tests, migration helpers
```

## Dependency Rules

```
routes  →  agents  →  services/*
routes  →  services/infra  (auth middleware, DB)

services/inventory   →  services/infra
services/move        →  services/infra, services/inventory (summaryQueryService for totals)
services/workflow    →  services/infra, services/inventory, agents (delegation)
services/analytics   →  services/infra
services/infra       →  external packages only (no intra-project deps)
```

**Never**: agents importing from routes, services importing from routes, circular deps between service layers.

## Agents

| Agent | File | Role | Tools |
|-------|------|------|-------|
| Orchestrator | `agents/nexusOrchestratorAgent.js` | Routes user messages to Census or Vector; owns onboarding flow | 7 tools |
| Census | `agents/censusAgent.js` | Inventory cataloging, photo/video analysis, room management, readiness | 15 tools |
| Vector | `agents/vectorAgent.js` | Move planning — truck sizing, cost/labor/route estimation | 7 tools |

### Orchestrator Tools
| Tool | Delegates To |
|------|-------------|
| `delegate_to_census` | Census agent (passes message + optional attachments) |
| `delegate_to_vector` | Vector agent (passes message) |
| `get_inventory_status` | `inventorySummaryQueryService.getInventoryTextSummary` |
| `get_user_profile` | Direct DB query |
| `set_user_profile` | `onboardingService.setUserProfile` |
| `set_location` | `onboardingService.setLocation` |
| `mark_onboarding_complete` | `onboardingService.markOnboardingComplete` |

Tool handlers are built dynamically by `workflow/agentDelegationService.buildToolHandlers`, which closes over `userId`, `attachments`, `plan`, and `onEvent`.

### Census Tools
| Tool | Service |
|------|---------|
| `add_item` | `inventoryMutationService.addItem` |
| `update_item` | `inventoryMutationService.updateItem` |
| `delete_item` | `inventoryMutationService.deleteItem` |
| `add_room` | `inventoryMutationService.addRoom` |
| `update_room` | `inventoryMutationService.updateRoom` |
| `update_location` | `inventoryMutationService.updateLocation` |
| `search_items` | `inventoryItemQueryService.searchItems` |
| `get_item_photo` | `inventoryItemQueryService.getItemPhoto` |
| `get_inventory_summary` | `inventorySummaryQueryService.getInventoryTextSummary` |
| `get_missing_context` | `inventoryMaturityService.getMissingContext` |
| `analyze_photo` | `mediaInventoryWorkflowService.analyzePhotoForInventory` |
| `analyze_video` | `mediaInventoryWorkflowService.analyzeVideoForInventory` |
| `find_duplicates` | `duplicateDetectionService.findDuplicates` |
| `inventory_readiness` | `inventoryMaturityService.inventoryReadinessAssessment` |
| `estimate_missing_items` | `moveSummaryService.estimateMissingItems` |

### Vector Tools
| Tool | Service |
|------|---------|
| `get_move_summary` | `moveSummaryService.getMoveSummary` |
| `recommend_truck_size` | `trucksService.recommendTruckSize` |
| `calculate_route` | `routeService.calculateRoute` |
| `estimate_labor` | `laborEstimationService.estimateLabor` |
| `estimate_move_cost` | `moveCostService.estimateMoveCost` |
| `flag_special_items` | `specialHandlingService.flagSpecialItems` |
| `get_room_breakdown` | `moveSummaryService.getRoomBreakdown` |

Each agent has its own Gemini session (`nexus_sessions` table with `session_type`), conversation history, and fire-and-forget context summarization (threshold: 20+ messages).

## Services

### services/infra/

| File | Purpose |
|------|---------|
| `knex.js` | Shared Knex singleton — connection pool for transactional writes |
| `db.js` | pg-promise connection — used for reads and simple queries |
| `authService.js` | Session token auth, `authenticate` middleware, plan resolution |
| `auth.js` | Google OAuth helper |
| `jwtMiddleware.js` | JWT verification |
| `gcsService.js` | GCS uploads, signed URLs, `signItemUrls` |
| `geocodingService.js` | Google Places autocomplete, place details, address validation |
| `geminiHistoryBuilder.js` | Convert DB message rows into Gemini `contents` format |
| `agentSessionService.js` | Session CRUD, `enrichMessagesWithActions`, conversation starters, quick-start chips |
| `metricsService.js` | Interaction timing/metadata logging |
| `imageCleanupService.js` | Orphaned GCS image cleanup |
| `dateUtils.js` | UTC week-start calculation |

### services/infra/vision/

| File | Purpose |
|------|---------|
| `visionService.js` | Multi-provider vision: Gemini, Claude, OpenAI, HuggingFace, Together.ai |
| `imageService.js` | Image analysis orchestration (room scan, single-item, multi-photo) |
| `videoService.js` | Video analysis orchestration |
| `geminiVideoScanService.js` | Gemini-specific video frame analysis |
| `frameExtractor.js` | ffmpeg-based video frame extraction |
| `imageUtils.js` | Bounding box math, pixel crop, `cropByBoundingBox`, `drawBoundingBox` |
| `augmentationService.js` | Image augmentation utilities |

### services/inventory/

| File | Purpose |
|------|---------|
| `inventoryItemQueryService.js` | `searchItems`, `getItemPhoto`, `getItemsByContainer`, `getSingleItem`, `getAllItems`, `getLooseItems` |
| `inventoryStructureQueryService.js` | `getAllLocations`, `getSingleLocation`, collections (by location, single, all, grouped), containers (by collection, single, all, grouped) |
| `inventorySummaryQueryService.js` | `getInventoryTotals`, `getInventorySnapshot` (client JSON), `getInventoryTextSummary` (AI prompt text) |
| `inventoryMutationService.js` | Add/update/delete items, rooms, locations, containers; QR assignment; permission creation |
| `inventoryMaturityService.js` | `getMissingContext` (gap analysis), `getTypicalItems`, `inventoryReadinessAssessment` (0-100 score) |
| `inventoryReferenceData.js` | `REFERENCE_ROOMS` and `TYPICAL_ITEMS` constants for gap analysis |
| `duplicateDetectionService.js` | Levenshtein-based duplicate item detection |
| `mediaInventoryWorkflowService.js` | Photo/video → item detection workflow (vision + bbox crop + GCS upload) |
| `itemEstimationService.js` | AI-powered weight/dimension estimation for items missing measurements |
| `itemParsingUtils.js` | Dimension string parsing, tag normalization |
| `qrService.js` | QR code token generation and validation |

### services/move/

| File | Purpose |
|------|---------|
| `moveSummaryService.js` | `getMoveSummary`, `estimateMissingItems`, `getRoomBreakdown` |
| `trucksService.js` | `TRUCK_SIZES`, `recommendTruckSize` |
| `moveCostService.js` | DIY + professional cost estimation |
| `laborEstimationService.js` | Load/unload time and crew sizing |
| `routeService.js` | Distance + route calculation (Google Directions API) |
| `distanceService.js` | Haversine, road factor, polyline decode, city-pair fallback table |
| `specialHandlingService.js` | Flag oversized, heavy, fragile, or door-clearance items |
| `moveCoordinationService.js` | Move-day session management, box assignments, task tracking |
| `moveMutationService.js` | Saved move CRUD, truck CRUD |
| `moveQueryService.js` | Saved move reads, waypoint queries |
| `moveMaturityService.js` | *(placeholder)* Move readiness assessment |

### services/workflow/

| File | Purpose |
|------|---------|
| `agentDelegationService.js` | `buildToolHandlers` — wires orchestrator tools to Census/Vector/onboarding |
| `onboardingService.js` | `setUserProfile`, `setLocation`, `markOnboardingComplete` |
| `userService.js` | User profile reads/writes, weekly metrics |
| `userDeleteService.js` | Cascade user deletion |
| `userMaturityService.js` | *(placeholder)* User profile completeness assessment |

### services/analytics/

| File | Purpose |
|------|---------|
| `reportingService.js` | Usage and analytics reporting |

## Key Patterns

- **Knex singleton**: `services/infra/knex.js` — shared connection pool for all transactional writes.
- **pg-promise**: `services/infra/db.js` — used for reads and simple queries. Some services use both (e.g., `inventorySummaryQueryService` uses knex for snapshot, pg-promise for text summary).
- **Permissions table**: Every resource (item, collection, location) gets a `permissions` row on creation.
- **GCS uploads**: `gcsService.uploadBuffer(buffer, path, mimeType)`. Signed URLs via `signItemUrls`.
- **Vision multi-provider**: `services/infra/vision/visionService.js` wraps Gemini, Claude, OpenAI, HuggingFace, Together.ai.
- **SSE streaming**: Agents emit events via `onEvent` callback; routes stream them as `text/event-stream`.
- **Context summarization**: Fire-and-forget after each interaction, threshold-based (20+ messages). Each agent type summarizes independently.
- **Tool labels**: Each agent defines `TOOL_LABELS` mapping tool names to human-readable SSE labels for streaming UI.

## File Naming Conventions

- Complex/higher-level services: `descriptorService.js` (e.g., `inventoryMutationService.js`)
- Cross-cutting utilities: `descriptorUtils.js` (e.g., `dateUtils.js`, `itemParsingUtils.js`, `imageUtils.js`)
- Constant data: `descriptorData.js` or `descriptorReferenceData.js` (e.g., `inventoryReferenceData.js`)
- Routes: `camelCase.js` matching the URL segment
- Agents: `camelCaseAgent.js`

## Adding a New Agent

1. Create `agents/myAgent.js` with `SYSTEM_PROMPT`, `toolDeclarations`, `toolHandlers`, `TOOL_LABELS`, `processMessage()`.
2. Create services under `services/myDomain/` for business logic.
3. Create `routes/api/agents/myAgent.js` with POST /message and GET /sessions/:id/messages.
4. Wire into `routes/api/agents/index.js` and `app.js`.
5. Add delegation tool to orchestrator's `agentDelegationService` if it should be routable from Nexus.
