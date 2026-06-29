# Database migration audit — June 2026

Triggered by the empty-inventory bug (`locations.lat` missing on fresh builds).
Two passes: (A) an empirical schema-drift diff of `init` vs the migrations, and
(B) a code review of the migration runner + deploy pipeline. Status reflects what
was fixed in this work vs. what remains a recommendation.

## A. Schema drift — `init-movetrack.sql` vs migrations  ✅ FIXED

`db/init-movetrack.sql` was last hand-synced ~migration `018`. Because the runner
baselines migrations ≤ `026` without executing them, every object a later (or
un-backported earlier) migration introduced was **absent from fresh builds while
present in production**. Found by building a DB from `init` + the runner and
diffing against every object the migrations declare.

**Missing from fresh builds (now reconciled):**

- **6 tables:** `move_waypoints` (011), `move_vehicles`, `move_team_members`,
  `move_locations` (014), `beta_interaction_logs`, `item_feedback` (026).
- **15 columns:** `locations.lat/lng` + access-info (014, fixed in `029`);
  `move_sessions.session_type` + waypoint/vehicle refs (012/014);
  `move_waypoints.distance_source`/`segment_*`/`is_dropoff`/`location_id`
  (013/015/021/014); `items.qr_code`/`qr_assigned_at` (019),
  `confidence_score`/`confidence_source` (026);
  `item_estimate_events.error_message`/`error_stage` (024).
- **24 indexes** across those tables.

**Fix:** reconciled into `init`; idempotent forward migrations `029` (locations)
and `030` (everything else) repair already-deployed fresh-from-init databases and
no-op on production. Verified: a fresh `init` + runner build now reports **zero
drift**, and the new CI `schema-drift` job keeps it that way.

> Caveat: the guard checks object **existence**, not types/defaults/constraints/
> triggers/views. A one-time `pg_dump --schema-only` of prod into `init` is the
> recommended way to close that remaining gap (needs DB access — operator step).

## B. Migration runner & pipeline review

Severity is **as actually reachable through `bin/migrate.js`**, which baselines
≤ `026` (never executes them) and only runs ≥ `027`.

| # | Finding | Real severity | Status |
|---|---|---|---|
| B1 | `015`/`016` contain their own `BEGIN/COMMIT`; the runner also wraps each migration in a transaction → nested-transaction error **if replayed**. | Low via runner (both are baselined, never run). Landmine only on replay-from-empty. | **Documented** as never-replay (changelog + process doc). Don't edit the applied files. |
| B2 | `\connect movetrack_db;` in `007`. | Low (runner strips `\connect`; `007` is baselined). | Mitigated by `readSql()` stripping + the "plain SQL only" rule. |
| B3 | Duplicate-numbered migrations `009–016`. | Low (all baselined; runner orders deterministically by number then filename). | **Documented as frozen.** Renumbering would orphan `schema_migrations` rows — explicitly *not* done. Rule going forward: unique numbers. |
| B4 | `015` `DELETE`s orphaned rows with no audit/guard. | N/A now (already ran on prod historically). | Informational. Future destructive migrations: guard + log counts (in process doc). |
| B5 | `007` vs `018` overlapping hierarchy enforcement. | Low (historical/baselined). | Informational. |
| B6 | Pre-migration backup ordering in `cloudbuild.yaml`. | **Not a bug.** `run-migrations` `waitFor`s `backup-db`; Cloud Build aborts if the backup fails, so migrations never run without a restore point. The "stale backup" concern misreads it — the backup captures DB state immediately before migration. | Verified correct; documented in process doc. |
| B7 | Adoption uses a single sentinel table (`users`) to detect an existing schema. | Medium (a DB with partial pre-`004` schema could be misclassified as fresh). | **Recommendation** (not changed): prefer explicit `baseline` for hand-provisioned DBs; consider a multi-table check. |
| B8 | `ROLLBACK` failure is swallowed silently. | Low. | **Recommendation:** log the rollback error. |
| B9 | No connection/statement timeout on the runner client. | Low (proxy readiness is awaited in cloudbuild). | **Recommendation:** add `connectionTimeoutMillis`. |
| B10 | Adoption records ≤ `026` as applied without verifying prod actually has them. | Medium — this is the *mechanism* behind the Part A drift. | **Mitigated** for fresh builds by the drift guard + reconciliation; for prod, the `029`/`030` `IF NOT EXISTS` migrations self-heal any genuinely-missing object. |
| B11 | `init` header said "after migrations (001-018)". | Trivial. | **Fixed** — header now states init must track migrations + points to this process. |

### Open recommendations (deferred — not blocking, touch the working deploy path)

Small, safe hardening of `bin/migrate.js`, intentionally **not** bundled with this
fix to keep the prod-critical runner change-free right after a critical bugfix:

- Log `ROLLBACK` failures instead of swallowing them (B8).
- Add `connectionTimeoutMillis` to the client config (B9).
- Harden the adopt heuristic, or require explicit `baseline` for hand-provisioned
  DBs (B7).
- Adopt the `pg_dump`-into-`init` practice to close the type/constraint gap the
  existence-only guard can't see, and to retire hand-maintenance of `init`.

These are tracked here for a follow-up PR.
