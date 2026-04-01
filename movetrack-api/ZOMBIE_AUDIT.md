# Zombie Code Audit

Audited during `refactor/api-folder-structure` branch work (April 2025).

## Deleted (Phase 1a)

| File | Evidence | Action |
|------|----------|--------|
| `services/infra/gcp.js` | 0 imports anywhere | Deleted |
| `services/infra/twelveLabsService.js` | 0 imports, superseded by Gemini video | Deleted |
| `services/images/transform.js` | 0 imports anywhere | Deleted |
| `services/infra/modelConnectionService.js` | 0 production imports (CLI-only tool) | Moved to `scripts/modelConnectionTest.js` |

## Flagged — Legacy

| File | Status | Evidence | Recommendation |
|------|--------|----------|----------------|
| `services/infra/auth.js` | Imported but disabled | `app.js` line 19 imports it; middleware usage at lines 68-75 is **commented out**. Replaced by `jwtMiddleware.js` + `authService.js` session tokens. | Delete when Auth0 is fully decommissioned. Safe to remove now if no Auth0 fallback is needed. |

## Investigated — Active (No Action)

| File | Imports | Notes |
|------|---------|-------|
| `routes/experimental/visionLab.js` | 2 (app.js import + mount) | Frontend `VisionLab.vue` uses `/admin/vision-lab/*` endpoints. Linked from MobileSettings. |
| `routes/experimental/visionLabVideo.js` | 1 (app.js import + mount) | Frontend `VisionLabVideo.vue` uses `/vision-lab-video/*` endpoints. Linked from MobileSettings. |

## Methodology

- `grep -r "require.*<filename>" --include="*.js"` for import counts
- Frontend search for API endpoint references
- `app.js` wiring verification for route mounts
- All services under `services/` verified to have at least 1 active import
