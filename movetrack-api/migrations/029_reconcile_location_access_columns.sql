-- Migration 029: Reconcile the locations access-info + geo columns into every database.
--
-- Background
-- ----------
-- Migration 014 (move_architecture_v2) added move-access columns and lat/lng to
-- `locations`, but db/init-movetrack.sql was never updated to match. Any database
-- provisioned fresh from init -- and then adopted by the migration runner, which
-- baselines everything through 026 and therefore SKIPS running 014 -- ends up
-- without these columns.
--
-- The inventory snapshot query (services/inventory/inventorySummaryQueryService.js)
-- selects locations.lat / locations.lng, so on such a database it fails with
-- "column locations.lat does not exist" and the entire inventory (items, rooms,
-- containers) silently fails to load in the client.
--
-- This migration is fully idempotent (ADD COLUMN IF NOT EXISTS):
--   * Production (which ran 014 historically) -> no-op.
--   * Any database built fresh from the old init -> repaired.
-- init-movetrack.sql is reconciled in the same change so future fresh builds
-- already include these columns and this migration no-ops there too.

ALTER TABLE locations ADD COLUMN IF NOT EXISTS has_stairs BOOLEAN DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS number_of_flights INTEGER;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS has_elevator BOOLEAN DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS elevator_type VARCHAR(100);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS elevator_distance INTEGER;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS elevator_reservation_required BOOLEAN DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS parking_situation VARCHAR(100);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS parking_distance INTEGER;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS entry_type VARCHAR(100);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS entry_challenges JSONB DEFAULT '[]';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS access_notes TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS lat NUMERIC(10, 7);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS lng NUMERIC(10, 7);
