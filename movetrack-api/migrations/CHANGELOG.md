# Migrations changelog

One line per migration, newest at the bottom. **Add an entry here in the same PR
that adds a migration file.** This is the human-readable index; the authoritative
record of what has run on a given database is its `schema_migrations` table.

See `docs/database-changes.md` for the full process (how to add a change, and the
init-sync rule the CI `schema-drift` job enforces).

## Conventions

- Filenames are `NNN_snake_case.sql`, zero-padded 3-digit prefix.
- **New migrations must use the next unused number** and must be **idempotent**
  (`IF NOT EXISTS` / `IF EXISTS`, `CREATE OR REPLACE`) and **plain SQL** (no psql
  meta-commands like `\connect`).
- The runner (`bin/migrate.js`) applies each migration once, in its own
  transaction, ordered by numeric prefix then filename.

## Frozen history (do not edit or renumber)

Numbers **009–016 contain duplicates** (e.g. two `009_`, three `015_`). This is
historical: they were authored on parallel branches and already applied to
production, and the runner records them **by filename**. Renumbering or editing
them would orphan the `schema_migrations` rows and risk re-runs. They are frozen.
Migrations **004–026 are baselined** by the runner on adoption (recorded as
applied without executing), so they never re-run on prod or a fresh build — which
is exactly why init must carry their schema (see the drift guard).

`015_convert_to_uuid_user_ids.sql` and `016_finalize_uuid_conversion.sql` are
**destructive and not idempotent** (they DROP columns and DELETE orphaned rows,
and wrap themselves in `BEGIN/COMMIT`). Never replay them. Provision new
environments from `db/init-movetrack.sql` (or a prod schema dump), not by
replaying from empty.

## Log

| Migration | Summary |
|---|---|
| `004_create_auth_tables` | Auth tables for magic-link authentication |
| `005_add_tags_and_container_capacity` | Item tags + container capacity fields |
| `006_add_dimension_fields` | Individual dimension fields on items |
| `007_enforce_location_hierarchy` | Enforce location hierarchy (legacy; superseded by 018) |
| `008_add_saved_moves` | `saved_moves` table for move planning |
| `009_add_move_day_tracking` | Move-day tracking |
| `009_add_move_session_columns` | Start/end/truck location columns on `move_sessions` |
| `010_add_item_scans_and_loading_zones` | Item scanning + loading zones |
| `010_add_truck_naming` | Truck naming fields on `locations` |
| `011_add_move_waypoints` | `move_waypoints` table (long-distance routing) |
| `011_separate_zone_planning_from_scans` | Split zone planning from scanning |
| `012_add_session_name` | Session naming on move sessions |
| `012_add_session_types` | `session_type` + waypoint refs on `move_sessions` |
| `013_add_waypoint_distance_source` | `distance_source` on `move_waypoints` |
| `013_move_session_flow_endpoints` | Arbitrary start/end + truck staging endpoints |
| `014_move_architecture_v2` | `move_vehicles`/`move_team_members`/`move_locations`; access-info + lat/lng on `locations`; vehicle/waypoint refs |
| `014_move_session_stage_and_date_range` | Move date ranges + session stage |
| `015_add_collection_location` | Collections always have a `location_id` |
| `015_add_segment_distances` | Segment distance/duration on `move_waypoints` |
| `015_convert_to_uuid_user_ids` | **Destructive.** user_id bigint → UUID |
| `016_create_user_plans` | `user_plans` (subscriptions) |
| `016_finalize_uuid_conversion` | **Destructive.** Finalize UUID conversion, drop legacy columns |
| `017_split_dimensions_fields` | Numeric dimension columns on items |
| `018_enforce_collection_location_hierarchy` | Strict collection→location hierarchy |
| `019_add_qr_codes` | `qr_code`/`qr_assigned_at` on items + containers |
| `020_add_onboarding_flag` | Onboarding-completed flag |
| `021_add_waypoint_dropoff_flag` | `is_dropoff` on `move_waypoints` |
| `022_add_missing_schema_elements` | Parity pass vs init (qr/notes/updated_at) |
| `023_add_image_uploads_tracking` | `image_uploads` table (GDPR / orphan cleanup) |
| `024_add_item_estimate_event_errors` | `error_message`/`error_stage` on `item_estimate_events` |
| `025_add_nexus_session_type` | `nexus` session type for the orchestrator |
| `026_add_beta_instrumentation` | `beta_interaction_logs`, `item_feedback`; confidence cols on items |
| `027_add_user_costs` | Per-user AI cost ledger + budget caps (B4) |
| `028_unified_media_assets` | Unified media-asset registry |
| `029_reconcile_location_access_columns` | Backfill `locations` access-info + lat/lng into every DB (fixed empty inventory snapshot) |
| `030_reconcile_init_schema_drift` | Backfill all remaining init↔migration drift: 6 tables, columns, 24 indexes |
| `031_backfill_location_permissions` | Data repair: grant owner `permissions` to locations orphaned by the HTTP create path (made them invisible to reads) |
| `032_add_inventory_shares` | `inventory_shares` table — tokenized public read-only inventory links for sharing with moving companies |
| `036_add_scan_events` | `scan_events` table — one row per analyze_photo/analyze_video with per-stage status, error_stage, latency, token usage (Pathway F observability) |
| `037_add_client_events` | `client_events` table — batched iOS client event log (upload/SSE/turn/review-card lifecycle) (Pathway F observability) |
| `038_add_scan_jobs` | `scan_jobs` table — durable async scan records; review card materialized from `result` (#42 Phase 2) |
| `040_drop_orphaned_move_tables` | **Destructive.** Drop 5 orphaned tables no code reads/writes: `move_projects`, `move_tasks`, `storage_units`, `move_vehicles`, `move_team_members` (#86 M1) |
