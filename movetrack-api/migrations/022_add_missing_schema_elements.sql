-- Migration 022: Add missing schema elements for parity with init-movetrack.sql
-- This migration adds:
-- 1. Generic update_updated_at_column() function and triggers
-- 2. permissions table
-- 3. item_history table
-- 4. Missing indexes
-- 5. QR code fields on locations
-- 6. Notes field on locations
-- 7. Missing table comments

BEGIN;

-- ============================================================================
-- PART 1: Generic timestamp update function and triggers
-- ============================================================================

-- Create the generic update function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to users table
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to locations table
DROP TRIGGER IF EXISTS update_locations_updated_at ON locations;
CREATE TRIGGER update_locations_updated_at 
    BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to collections table
DROP TRIGGER IF EXISTS update_collections_updated_at ON collections;
CREATE TRIGGER update_collections_updated_at 
    BEFORE UPDATE ON collections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to containers table
DROP TRIGGER IF EXISTS update_containers_updated_at ON containers;
CREATE TRIGGER update_containers_updated_at 
    BEFORE UPDATE ON containers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to items table
DROP TRIGGER IF EXISTS update_items_updated_at ON items;
CREATE TRIGGER update_items_updated_at 
    BEFORE UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to move_sessions table
DROP TRIGGER IF EXISTS update_move_sessions_updated_at ON move_sessions;
CREATE TRIGGER update_move_sessions_updated_at 
    BEFORE UPDATE ON move_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 2: Permissions table for sharing resources
-- ============================================================================

CREATE TABLE IF NOT EXISTS permissions (
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    resource_id BIGINT NOT NULL,
    resource_type VARCHAR(20) NOT NULL, -- 'item', 'collection', 'container', 'location', 'move_project'
    permission_level VARCHAR(20) NOT NULL, -- 'owner', 'view', 'edit', 'admin'
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID NOT NULL REFERENCES users(user_id),
    PRIMARY KEY (user_id, resource_id, resource_type)
);

-- Index for permission lookups
CREATE INDEX IF NOT EXISTS idx_permissions_user ON permissions(user_id);

COMMENT ON TABLE permissions IS 'Sharing permissions for items/collections with family, movers, etc.';

-- ============================================================================
-- PART 3: Item history table for tracking movements
-- ============================================================================

CREATE TABLE IF NOT EXISTS item_history (
    id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    from_location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    to_location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    from_container_id BIGINT REFERENCES containers(id) ON DELETE SET NULL,
    to_container_id BIGINT REFERENCES containers(id) ON DELETE SET NULL,
    move_project_id BIGINT REFERENCES move_projects(id) ON DELETE SET NULL,
    performed_by_id UUID NOT NULL REFERENCES users(user_id),
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
);

-- Indexes for item history
CREATE INDEX IF NOT EXISTS idx_item_history_item ON item_history(item_id);
CREATE INDEX IF NOT EXISTS idx_item_history_project ON item_history(move_project_id);

COMMENT ON TABLE item_history IS 'Track item movements between locations/containers';

-- ============================================================================
-- PART 4: Add QR code and notes fields to locations
-- ============================================================================

ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS qr_code VARCHAR(255) UNIQUE,
    ADD COLUMN IF NOT EXISTS qr_assigned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================================================
-- PART 5: Ensure updated_at column exists on all relevant tables
-- ============================================================================

-- Add updated_at to users if missing
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add updated_at to locations if missing
ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add updated_at to collections if missing
ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add updated_at to move_projects if missing
ALTER TABLE move_projects
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add updated_at to move_tasks if missing
ALTER TABLE move_tasks
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add updated_at to storage_units if missing
ALTER TABLE storage_units
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================================
-- PART 6: Add missing table and column comments
-- ============================================================================

-- Core tables
COMMENT ON TABLE users IS 'User accounts with UUID-based identification';
COMMENT ON TABLE locations IS 'Physical locations (residences, storage units, warehouses)';
COMMENT ON TABLE collections IS 'Logical groupings of items (rooms, categories). MUST have location_id.';
COMMENT ON TABLE containers IS 'Physical boxes/containers. Location inherited from collection.';
COMMENT ON TABLE items IS 'Individual items. Location inherited from collection.';

-- Move tables
COMMENT ON TABLE saved_moves IS 'Comprehensive move planning and cost estimation';
COMMENT ON TABLE move_sessions IS 'Active move tracking sessions';
COMMENT ON TABLE box_scans IS 'Individual box scanning events during loading/unloading';
COMMENT ON TABLE item_scans IS 'Loose item scanning events';
COMMENT ON TABLE container_zones IS 'Pre-planning: zone assignments for containers';
COMMENT ON TABLE item_zones IS 'Pre-planning: zone assignments for loose items';
COMMENT ON TABLE move_timeline IS 'Chronological activity log for move day events';
COMMENT ON TABLE damage_reports IS 'Damage and issue reporting during the move';
COMMENT ON TABLE move_crew IS 'Crew members and helpers for a specific move';

-- Auth tables
COMMENT ON TABLE auth_tokens IS 'Stores magic link tokens and session tokens';
COMMENT ON TABLE login_history IS 'Tracks all login attempts for security and analytics';

-- ============================================================================
-- PART 7: Add missing indexes for performance
-- ============================================================================

-- Move project indexes
CREATE INDEX IF NOT EXISTS idx_move_projects_status ON move_projects(status);
CREATE INDEX IF NOT EXISTS idx_move_tasks_project ON move_tasks(move_project_id);

-- Storage units indexes
CREATE INDEX IF NOT EXISTS idx_storage_units_user_id ON storage_units(user_id);

-- ============================================================================
-- PART 8: Recreate views with all columns from init-movetrack.sql
-- ============================================================================

-- Drop and recreate containers_with_location view
DROP VIEW IF EXISTS containers_with_location;

CREATE VIEW containers_with_location AS
    SELECT cont.id,
        cont.user_id,
        cont.name,
        cont.collection_id,
        cont.description,
        cont.box_number,
        cont.box_type,
        cont.sealed,
        cont.sealed_at,
        cont.weight_lbs,
        cont.fragile_contents,
        cont.created_at,
        cont.updated_at,
        cont.qr_code,
        cont.qr_assigned_at,
        cont.color_code,
        cont.max_weight_lbs,
        cont.max_volume_cuft,
        cont.box_size,
        cont.inner_length_in,
        cont.inner_width_in,
        cont.inner_height_in,
        c.location_id,
        l.name AS location_name
    FROM containers cont
        JOIN collections c ON cont.collection_id = c.id
        JOIN locations l ON c.location_id = l.id;

-- Drop and recreate items_with_location view
DROP VIEW IF EXISTS items_with_location;

CREATE VIEW items_with_location AS
    SELECT i.id,
        i.user_id,
        i.name,
        i.collection_id,
        i.description,
        i.container_id,
        i.quantity,
        i.estimated_value,
        i.fragile,
        i.priority,
        i.weight_lbs,
        i.created_at,
        i.updated_at,
        i.picture_url,
        i.notes,
        i.material,
        i.primary_color,
        i.tags,
        i.length_in,
        i.width_in,
        i.height_in,
        c.location_id,
        l.name AS location_name
    FROM items i
        JOIN collections c ON i.collection_id = c.id
        JOIN locations l ON c.location_id = l.id;

COMMIT;

-- Verification
SELECT 'Migration 022 completed successfully!' as status;
