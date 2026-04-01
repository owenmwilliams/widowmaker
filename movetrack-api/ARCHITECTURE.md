# movetrack-api Architecture

## Layer Overview

```
routes/          → Transport only (HTTP, SSE, file upload). No business logic.
agents/          → AI orchestration (Gemini tool-calling loops, session management).
                   Thin delegates to services for all business logic.
services/
  census/        → Inventory domain (CRUD, queries, duplicates, media workflows)
  vector/        → Logistics domain (truck sizing, costs, labor, routes, summaries)
  orchestrator/  → Cross-agent (onboarding, delegation)
  shared/        → Neutral reusable utilities (distance, QR, estimation, enrichMessages)
  infra/         → Plumbing (DB, auth, GCS, Gemini history, vision providers, metrics)
scripts/         → CLI tools, one-off tests, migration helpers
```

## Dependency Rules

```
routes  →  agents  →  services/*
routes  →  services/infra  (auth middleware, DB)
routes  →  services/shared (enrichMessages)

services/census      →  services/infra
services/vector      →  services/infra, services/census (inventoryQueryService for totals)
services/orchestrator →  services/infra, services/census, agents (delegation)
services/shared      →  services/infra only
services/infra       →  external packages only (no intra-project deps)
```

**Never**: agents importing from routes, services importing from routes, circular deps between service layers.

## Agents

| Agent | File | Role | Tools |
|-------|------|------|-------|
| Census | `agents/censusAgent.js` | Inventory cataloging, photo/video analysis, room management | 13 tools |
| Vector | `agents/vectorAgent.js` | Move planning, truck/cost/labor/route estimation | 8 tools |
| Orchestrator | `agents/nexusOrchestratorAgent.js` | Routes user messages to Census or Vector, owns onboarding | 7 tools |

Each agent has its own Gemini session (`nexus_sessions` table with `session_type`), conversation history, and context summarization.

## Key Patterns

- **Knex singleton**: `services/infra/knex.js` — shared connection pool for all transactional writes.
- **pg-promise**: `services/infra/db.js` — used for reads and simple queries.
- **Permissions table**: Every resource (item, collection, location) gets a `permissions` row on creation.
- **GCS uploads**: `services/infra/gcsService.uploadBuffer(buffer, path, mimeType)`.
- **Vision multi-provider**: `services/infra/vision/visionService.js` wraps Gemini, Claude, OpenAI, HuggingFace, Together.ai.
- **SSE streaming**: Agents emit events via `onEvent` callback; routes stream them as `text/event-stream`.
- **Context summarization**: Fire-and-forget after each interaction, threshold-based (20+ messages).

## Adding a New Agent

1. Create `agents/myAgent.js` with SYSTEM_PROMPT, toolDeclarations, toolHandlers, processMessage().
2. Create services under `services/myDomain/` for business logic.
3. Create `routes/myAgent.js` with POST /message and GET /sessions/:id/messages.
4. Wire in `app.js`.
5. Add delegation tool to orchestrator if it should be routable from Nexus.

## File Naming Conventions

- Services: `camelCaseService.js` (e.g., `inventoryMutationService.js`)
- Routes: `camelCase.js` matching the URL segment
- Agents: `camelCaseAgent.js`
