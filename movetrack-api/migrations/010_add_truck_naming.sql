-- Migration: Add truck naming support to locations table
-- Allows users to define custom names for trucks (e.g., "Big Blue", "U-Haul #1")
-- Falls back to auto-generated sequential names if not provided

-- Add truck_identifier column for user-friendly truck names
ALTER TABLE locations
ADD COLUMN IF NOT EXISTS truck_identifier VARCHAR(100);

-- Add truck_sequence for auto-generated sequential numbers
-- This tracks the order in which trucks are created for a move
ALTER TABLE locations
ADD COLUMN IF NOT EXISTS truck_sequence INTEGER;

-- Add truck_size column to store the truck size for reference
ALTER TABLE locations
ADD COLUMN IF NOT EXISTS truck_size VARCHAR(20);

-- Add index for truck-type locations
CREATE INDEX IF NOT EXISTS idx_locations_truck_type ON locations(user_id, location_type) WHERE location_type = 'truck';

-- Add comments
COMMENT ON COLUMN locations.truck_identifier IS 'User-defined truck name (e.g., "Big Blue", "U-Haul #1"). If null, auto-generates "Truck 1", "Truck 2", etc.';
COMMENT ON COLUMN locations.truck_sequence IS 'Sequential number for this truck within a move (used for auto-naming)';
COMMENT ON COLUMN locations.truck_size IS 'Size of the truck (e.g., "26ft", "15ft", "van")';
