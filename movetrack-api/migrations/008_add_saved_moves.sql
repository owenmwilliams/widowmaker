-- Create saved_moves table to store move planning data
CREATE TABLE IF NOT EXISTS saved_moves (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,

  -- Move configuration
  origin_location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
  destination_location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
  move_date DATE,
  num_helpers INTEGER DEFAULT 2,
  packing_services_required VARCHAR(20) DEFAULT 'none' CHECK (packing_services_required IN ('none', 'partial', 'full')),

  -- Origin location details
  has_stairs BOOLEAN DEFAULT false,
  number_of_flights INTEGER,
  has_elevator BOOLEAN DEFAULT false,
  elevator_type VARCHAR(100),
  elevator_distance INTEGER,
  elevator_reservation_required BOOLEAN DEFAULT false,
  parking_situation VARCHAR(100),
  parking_distance INTEGER,
  entry_type VARCHAR(100),
  entry_challenges JSONB DEFAULT '[]',
  access_notes TEXT,

  -- Destination location details
  dest_has_stairs BOOLEAN DEFAULT false,
  dest_number_of_flights INTEGER,
  dest_has_elevator BOOLEAN DEFAULT false,
  dest_elevator_type VARCHAR(100),
  dest_elevator_distance INTEGER,
  dest_elevator_reservation_required BOOLEAN DEFAULT false,
  dest_parking_situation VARCHAR(100),
  dest_parking_distance INTEGER,
  dest_entry_type VARCHAR(100),
  dest_entry_challenges JSONB DEFAULT '[]',
  dest_access_notes TEXT,

  -- Additional details
  special_requirements TEXT,
  estimated_square_footage INTEGER,
  use_truck_route BOOLEAN DEFAULT true,
  avoid_tolls BOOLEAN DEFAULT false,

  -- Calculated inventory metrics (snapshot at save time)
  total_items INTEGER,
  total_weight_lbs NUMERIC(10, 2),
  total_volume_cu_ft NUMERIC(10, 2),
  estimated_distance_miles INTEGER,

  -- Cached cost calculations (valid for 2 weeks)
  cost_calculations JSONB,
  cost_calculations_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Route data
  route_data JSONB,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Index for user lookups
CREATE INDEX idx_saved_moves_user_id ON saved_moves(user_id);

-- Index for date-based queries
CREATE INDEX idx_saved_moves_move_date ON saved_moves(move_date);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_saved_moves_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_saved_moves_timestamp
  BEFORE UPDATE ON saved_moves
  FOR EACH ROW
  EXECUTE FUNCTION update_saved_moves_timestamp();
