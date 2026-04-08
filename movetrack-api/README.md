# movetrack-api

Express + PostgreSQL backend for Nexus Moves — an AI-powered moving assistant.

## Stack

- **Runtime**: Node.js + Express
- **Database**: PostgreSQL (Cloud SQL) via Knex (writes) + pg-promise (reads)
- **AI**: Google Gemini via `@google/generative-ai` SDK, tiered model routing
- **Storage**: Google Cloud Storage for images/videos
- **Auth**: Session tokens in localStorage, `authenticate` middleware
- **Deploy**: Cloud Run

## Project Structure

```
agents/              AI agents (Gemini tool-calling loops)
  censusAgent.js       Inventory cataloging, photo/video analysis (15 tools)
  vectorAgent.js       Move logistics — truck, cost, labor, route (7 tools)
  nexusOrchestratorAgent.js  Routes to Census/Vector, owns onboarding (7 tools)

routes/              HTTP transport layer (no business logic)
  api/agents/          Agent chat (POST /message, GET /sessions)
  api/inventory/       CRUD: locations, collections, containers, items, snapshot
  api/move/            Moves, move-day coordination, routing
  api/user/            Auth, profile, files, onboarding
  api/vision/          Image + video processing
  admin/               Analytics, email, maintenance
  auth/                Google OAuth, magic links
  billing/             Stripe

services/            Business logic
  infra/               DB, auth, GCS, metrics, geocoding, vision providers
  inventory/           Items, rooms, queries, mutations, maturity, estimation
  move/                Trucks, labor, cost, route, distance, move-day
  workflow/            Onboarding, agent delegation, user management
  analytics/           Reporting

scripts/             CLI tools, tests, migration helpers
docs/                Project documentation
```

## Quick Start

```bash
npm install
cp .env.example .env   # configure DB, API keys
npm start              # or: ./start-dev.sh
```

## Documentation

| Doc | Description | Status |
|-----|-------------|--------|
| [Architecture](docs/architecture.md) | Layer overview, dependency rules, agent tools, service catalog | Current |
| [Service Map](docs/service-map.md) | Refactor history — every file move, extraction, and deletion | Current |
| [Vision Setup](docs/vision-setup.md) | Multi-provider vision AI configuration (Gemini, Claude, GPT-4) | Current |
| [Image Storage](docs/image-storage-privacy.md) | Upload flow, GDPR/CCPA compliance, orphan cleanup | Current |
| [Zombie Audit](docs/zombie-audit.md) | Dead code audit from April 2025 refactor | Done |

## Key Patterns

- **Thin routes**: Routes parse HTTP I/O only. All logic lives in services.
- **Thin agents**: Agents own Gemini loops and tool declarations. Tool handlers delegate to services.
- **Permissions table**: Every resource (item, collection, location) gets a `permissions` row on creation.
- **SSE streaming**: Agents emit events via `onEvent`; routes stream as `text/event-stream`.
- **Context summarization**: Fire-and-forget after each agent interaction (threshold: 20+ messages).
