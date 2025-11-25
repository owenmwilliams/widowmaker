-- Migration 011: Separate zone planning from scanning
-- Description: Create separate tables for zone assignments to support pre-planning
--              Zone assignments are now independent of the scanning workflow

-- Create container_zones table for pre-planning container loading zones
CREATE TABLE IF NOT EXISTS container_zones (
  id BIGSERIAL PRIMARY KEY,
  move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
  container_id BIGINT NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  loading_zone INTEGER,
  load_priority INTEGER,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Each container can only have one zone assignment per move session
  CONSTRAINT unique_container_per_session UNIQUE (move_session_id, container_id)
);

-- Create item_zones table for pre-planning loose item loading zones
CREATE TABLE IF NOT EXISTS item_zones (
  id BIGSERIAL PRIMARY KEY,
  move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  loading_zone INTEGER,
  load_priority INTEGER,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Each item can only have one zone assignment per move session
  CONSTRAINT unique_item_per_session UNIQUE (move_session_id, item_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_container_zones_session ON container_zones(move_session_id);
CREATE INDEX IF NOT EXISTS idx_container_zones_container ON container_zones(container_id);
CREATE INDEX IF NOT EXISTS idx_container_zones_zone ON container_zones(loading_zone);
CREATE INDEX IF NOT EXISTS idx_item_zones_session ON item_zones(move_session_id);
CREATE INDEX IF NOT EXISTS idx_item_zones_item ON item_zones(item_id);
CREATE INDEX IF NOT EXISTS idx_item_zones_zone ON item_zones(loading_zone);

-- Add comments for documentation
COMMENT ON TABLE container_zones IS 'Pre-planning: zone assignments for containers (independent of scanning)';
COMMENT ON TABLE item_zones IS 'Pre-planning: zone assignments for loose items (independent of scanning)';
COMMENT ON COLUMN container_zones.loading_zone IS 'Planned loading zone: 1=front/heavy, 2=middle, 3=rear/light';
COMMENT ON COLUMN item_zones.loading_zone IS 'Planned loading zone: 1=front/heavy, 2=middle, 3=rear/light';
COMMENT ON COLUMN container_zones.load_priority IS 'Loading order priority within zone (lower = load first)';
COMMENT ON COLUMN item_zones.load_priority IS 'Loading order priority within zone (lower = load first)';
