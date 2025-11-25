-- Migration 010: Add item scanning and loading zones for truck packing
-- Description: Extends move day tracking to support loose item scanning and zone-based loading

-- Add item_scans table for tracking loose items (items not in containers)
CREATE TABLE IF NOT EXISTS item_scans (
  id BIGSERIAL PRIMARY KEY,
  move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES items(id),
  scan_type VARCHAR(50) NOT NULL, -- loaded, unloaded, arrived_at_room, unpacked
  scanned_by VARCHAR,
  location_type VARCHAR(50), -- origin, truck, destination
  destination_room VARCHAR(255),
  notes TEXT,
  scanned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Constraint: An item can only be scanned if it's not in a container
  -- This will be enforced at the application level
  CONSTRAINT unique_item_scan_per_type UNIQUE (move_session_id, item_id, scan_type)
);

-- Add truck_size and num_zones to move_sessions
ALTER TABLE move_sessions
  ADD COLUMN IF NOT EXISTS truck_size VARCHAR(50), -- van, 10ft, 15ft, 17ft, 20ft, 26ft
  ADD COLUMN IF NOT EXISTS num_zones INTEGER DEFAULT 3;

-- Add loading_zone to both box_scans and item_scans
ALTER TABLE box_scans
  ADD COLUMN IF NOT EXISTS loading_zone INTEGER, -- 1=front/heavy, 2=middle, 3=rear/light, etc
  ADD COLUMN IF NOT EXISTS zone_assigned_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS load_priority INTEGER; -- Lower number = load first

ALTER TABLE item_scans
  ADD COLUMN IF NOT EXISTS loading_zone INTEGER,
  ADD COLUMN IF NOT EXISTS zone_assigned_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS load_priority INTEGER;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_item_scans_session ON item_scans(move_session_id);
CREATE INDEX IF NOT EXISTS idx_item_scans_item ON item_scans(item_id);
CREATE INDEX IF NOT EXISTS idx_item_scans_type ON item_scans(scan_type);
CREATE INDEX IF NOT EXISTS idx_item_scans_zone ON item_scans(loading_zone);
CREATE INDEX IF NOT EXISTS idx_box_scans_zone ON box_scans(loading_zone);

-- Add comments for documentation
COMMENT ON TABLE item_scans IS 'Tracks scanning of loose items (not in containers) during move day';
COMMENT ON COLUMN item_scans.scan_type IS 'Type of scan: loaded, unloaded, arrived_at_room, unpacked';
COMMENT ON COLUMN move_sessions.truck_size IS 'Size of moving truck: van, 10ft, 15ft, 17ft, 20ft, 26ft';
COMMENT ON COLUMN move_sessions.num_zones IS 'Number of loading zones based on truck size';
COMMENT ON COLUMN box_scans.loading_zone IS 'Assigned loading zone: 1=front/heavy, 2=middle, 3=rear/light';
COMMENT ON COLUMN box_scans.load_priority IS 'Loading order priority (lower = load first)';
COMMENT ON COLUMN item_scans.loading_zone IS 'Assigned loading zone: 1=front/heavy, 2=middle, 3=rear/light';
COMMENT ON COLUMN item_scans.load_priority IS 'Loading order priority (lower = load first)';
