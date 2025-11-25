-- Migration: Move Architecture v2
-- This migration restructures move-related tables for a cleaner architecture:
-- 1. Move access info from saved_moves to locations table
-- 2. Create move_vehicles table for vehicle tracking
-- 3. Create move_team_members table (move-level, not session-level)
-- 4. Add location_id to move_waypoints for work stops
-- 5. Remove 'transfer' session type (use loading/unloading/driving only)

-- ============================================================================
-- PART 1: Add access info columns to locations table
-- These fields describe how to access a location for moving purposes
-- ============================================================================

-- Stairs info
ALTER TABLE locations ADD COLUMN IF NOT EXISTS has_stairs BOOLEAN DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS number_of_flights INTEGER;

-- Elevator info
ALTER TABLE locations ADD COLUMN IF NOT EXISTS has_elevator BOOLEAN DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS elevator_type VARCHAR(100);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS elevator_distance INTEGER;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS elevator_reservation_required BOOLEAN DEFAULT false;

-- Parking info
ALTER TABLE locations ADD COLUMN IF NOT EXISTS parking_situation VARCHAR(100);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS parking_distance INTEGER;

-- Entry info
ALTER TABLE locations ADD COLUMN IF NOT EXISTS entry_type VARCHAR(100);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS entry_challenges JSONB DEFAULT '[]';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS access_notes TEXT;

-- Add lat/lng for geocoded locations
ALTER TABLE locations ADD COLUMN IF NOT EXISTS lat NUMERIC(10, 7);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS lng NUMERIC(10, 7);

-- Comments for documentation
COMMENT ON COLUMN locations.has_stairs IS 'Does this location have stairs for moving access?';
COMMENT ON COLUMN locations.number_of_flights IS 'Number of flights of stairs';
COMMENT ON COLUMN locations.has_elevator IS 'Is there an elevator available?';
COMMENT ON COLUMN locations.elevator_type IS 'Type of elevator (freight, passenger, service)';
COMMENT ON COLUMN locations.elevator_distance IS 'Distance from parking to elevator in feet';
COMMENT ON COLUMN locations.elevator_reservation_required IS 'Does elevator need to be reserved?';
COMMENT ON COLUMN locations.parking_situation IS 'Parking type (street, driveway, lot, loading dock)';
COMMENT ON COLUMN locations.parking_distance IS 'Distance from parking to entry in feet';
COMMENT ON COLUMN locations.entry_type IS 'Entry type (front door, side door, garage, loading dock)';
COMMENT ON COLUMN locations.entry_challenges IS 'JSON array of challenges (narrow_doorway, tight_corners, etc.)';
COMMENT ON COLUMN locations.access_notes IS 'Additional access notes and instructions';
COMMENT ON COLUMN locations.lat IS 'Latitude coordinate';
COMMENT ON COLUMN locations.lng IS 'Longitude coordinate';

-- ============================================================================
-- PART 2: Create move_vehicles table
-- Tracks vehicles used for moves (trucks, trailers, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS move_vehicles (
  id SERIAL PRIMARY KEY,
  move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,

  -- Vehicle identification
  vehicle_type VARCHAR(50) NOT NULL DEFAULT 'truck', -- truck, trailer, van, car
  name VARCHAR(100),                                 -- "26ft Box Truck", "My Trailer"
  license_plate VARCHAR(20),

  -- Capacity info
  capacity_cu_ft INTEGER,
  max_weight_lbs INTEGER,

  -- Rental info (if applicable)
  is_rental BOOLEAN DEFAULT false,
  rental_company VARCHAR(100),
  rental_confirmation VARCHAR(100),
  pickup_date DATE,
  return_date DATE,
  pickup_location TEXT,
  return_location TEXT,

  -- Current status
  status VARCHAR(20) DEFAULT 'available', -- available, in_use, returned
  current_load_cu_ft INTEGER DEFAULT 0,
  current_load_weight_lbs INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for move lookups
CREATE INDEX IF NOT EXISTS idx_move_vehicles_move_id ON move_vehicles(move_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_move_vehicles_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_move_vehicles_timestamp ON move_vehicles;
CREATE TRIGGER trigger_update_move_vehicles_timestamp
  BEFORE UPDATE ON move_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION update_move_vehicles_timestamp();

COMMENT ON TABLE move_vehicles IS 'Vehicles (trucks, trailers) used for moves';

-- ============================================================================
-- PART 3: Create move_team_members table
-- Team members at the MOVE level (not per-session)
-- ============================================================================

CREATE TABLE IF NOT EXISTS move_team_members (
  id SERIAL PRIMARY KEY,
  move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,

  -- Member info
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,  -- Required for sharing/coordination
  email VARCHAR(255),

  -- Role and permissions
  role VARCHAR(50) DEFAULT 'helper', -- owner, driver, helper, coordinator
  can_drive BOOLEAN DEFAULT false,

  -- Availability
  available_dates JSONB DEFAULT '[]',  -- Array of dates they're available

  -- Invitation status
  invitation_status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, declined
  invitation_sent_at TIMESTAMP,
  invitation_accepted_at TIMESTAMP,
  share_token VARCHAR(100),  -- Unique token for sharing link

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_move_team_members_move_id ON move_team_members(move_id);
CREATE INDEX IF NOT EXISTS idx_move_team_members_share_token ON move_team_members(share_token);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_move_team_members_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_move_team_members_timestamp ON move_team_members;
CREATE TRIGGER trigger_update_move_team_members_timestamp
  BEFORE UPDATE ON move_team_members
  FOR EACH ROW
  EXECUTE FUNCTION update_move_team_members_timestamp();

COMMENT ON TABLE move_team_members IS 'Team members assigned to a move (at move level, not session level)';
COMMENT ON COLUMN move_team_members.phone IS 'Phone number - required for sharing links and coordination';
COMMENT ON COLUMN move_team_members.share_token IS 'Unique token for sharing move access link';

-- ============================================================================
-- PART 4: Add location_id to move_waypoints
-- Allows waypoints to reference locations for "work stops" (storage, staging)
-- ============================================================================

ALTER TABLE move_waypoints ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_move_waypoints_location_id ON move_waypoints(location_id);
COMMENT ON COLUMN move_waypoints.location_id IS 'Optional reference to a location for work stops (storage facilities, staging areas)';

-- ============================================================================
-- PART 5: Update session_type to remove 'transfer' option
-- Only loading, unloading, and driving are valid session types
-- ============================================================================

-- First update any existing 'transfer' sessions to 'loading' (closest equivalent)
UPDATE move_sessions SET session_type = 'loading' WHERE session_type = 'transfer';

-- Note: We don't need to modify the constraint as it was a simple default value
-- The application code will enforce the valid types going forward
COMMENT ON COLUMN move_sessions.session_type IS 'Type of session: loading, driving, or unloading (transfer deprecated)';

-- ============================================================================
-- PART 6: Add vehicle_id to driving sessions
-- Links driving sessions to the vehicle being driven
-- ============================================================================

ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES move_vehicles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_move_sessions_vehicle_id ON move_sessions(vehicle_id);
COMMENT ON COLUMN move_sessions.vehicle_id IS 'Vehicle used for this driving session';

-- ============================================================================
-- PART 7: Create move_locations junction table for multi-location moves
-- Simple mapping to support moves with multiple origin/intermediate/destination locations
-- ============================================================================

CREATE TABLE IF NOT EXISTS move_locations (
  id SERIAL PRIMARY KEY,
  move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,

  -- Role in the move
  location_role VARCHAR(20) NOT NULL DEFAULT 'intermediate', -- origin, intermediate, destination
  sequence_order INTEGER DEFAULT 0,

  -- What happens at this location
  has_loading BOOLEAN DEFAULT false,
  has_unloading BOOLEAN DEFAULT false,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Prevent duplicate entries
  UNIQUE(move_id, location_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_move_locations_move_id ON move_locations(move_id);
CREATE INDEX IF NOT EXISTS idx_move_locations_location_id ON move_locations(location_id);

COMMENT ON TABLE move_locations IS 'Junction table linking moves to multiple locations (origin, intermediate, destination)';
COMMENT ON COLUMN move_locations.location_role IS 'Role of location in move: origin, intermediate, or destination';
COMMENT ON COLUMN move_locations.has_loading IS 'Whether items are loaded at this location';
COMMENT ON COLUMN move_locations.has_unloading IS 'Whether items are unloaded at this location';
