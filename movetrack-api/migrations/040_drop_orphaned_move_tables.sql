-- 040_drop_orphaned_move_tables.sql
--
-- M1 (issue #86): drop the five move tables that no route, service, or agent
-- tool reads or writes. They date from the pre-saved_moves architecture:
--   move_projects / move_tasks / storage_units  — legacy "move project" model
--   move_vehicles / move_team_members           — 014_move_architecture_v2,
--                                                 never wired to an endpoint
--
-- CASCADE also removes their dependent objects: the item_history and
-- move_sessions foreign keys (the bare columns item_history.move_project_id
-- and move_sessions.vehicle_id remain), indexes, and triggers.
--
-- One DROP TABLE per statement (rather than a single multi-table DROP) so
-- scripts/check-schema-drift.js registers each table as dropped.

DROP TABLE IF EXISTS move_tasks CASCADE;
DROP TABLE IF EXISTS move_projects CASCADE;
DROP TABLE IF EXISTS storage_units CASCADE;
DROP TABLE IF EXISTS move_vehicles CASCADE;
DROP TABLE IF EXISTS move_team_members CASCADE;

-- Bookkeeping for the schema-drift checker: these indexes were declared by
-- earlier migrations (014/015/016/022/030) and vanished with their tables.
DROP INDEX IF EXISTS idx_move_projects_user_id;
DROP INDEX IF EXISTS idx_move_projects_status;
DROP INDEX IF EXISTS idx_move_tasks_project;
DROP INDEX IF EXISTS idx_storage_units_user_id;
DROP INDEX IF EXISTS idx_move_vehicles_move_id;
DROP INDEX IF EXISTS idx_move_team_members_move_id;
DROP INDEX IF EXISTS idx_move_team_members_share_token;

-- Trigger functions that only served the dropped tables (014).
DROP FUNCTION IF EXISTS update_move_vehicles_timestamp() CASCADE;
DROP FUNCTION IF EXISTS update_move_team_members_timestamp() CASCADE;
