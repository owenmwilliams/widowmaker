-- Migration: Add move_waypoints table for long-distance move tracking
-- Waypoints represent geographic points (cities) where a truck can be located
-- They are separate from owned locations and track the truck's journey

-- Create the move_waypoints table
CREATE TABLE IF NOT EXISTS move_waypoints (
  id BIGSERIAL PRIMARY KEY,
  saved_move_id BIGINT REFERENCES saved_moves(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(user_id),

  -- Location information
  city VARCHAR(100) NOT NULL,
  state VARCHAR(50),
  country VARCHAR(50) DEFAULT 'USA',
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),

  -- Source tracking for future suggestions
  -- 'manual' = user added, 'suggested' = app suggested, 'routing_api' = from routing service
  -- 'popular_stop' = commonly used stop, 'fuel_stop' = gas station recommendation
  source VARCHAR(50) DEFAULT 'manual',

  -- Distance/time metadata (can be populated by routing API)
  distance_from_origin_miles DECIMAL(10, 2),
  typical_drive_hours_from_origin DECIMAL(5, 2),

  -- User notes and recommendations
  notes TEXT,
  overnight_recommended BOOLEAN DEFAULT false,

  -- Ordering within the move (0 = origin, higher = further along route)
  sequence_order INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_move_waypoints_saved_move ON move_waypoints(saved_move_id);
CREATE INDEX IF NOT EXISTS idx_move_waypoints_user ON move_waypoints(user_id);
CREATE INDEX IF NOT EXISTS idx_move_waypoints_sequence ON move_waypoints(saved_move_id, sequence_order);

-- Add comments
COMMENT ON TABLE move_waypoints IS 'Geographic waypoints for long-distance moves, tracking truck journey stops';
COMMENT ON COLUMN move_waypoints.source IS 'How this waypoint was added: manual, suggested, routing_api, popular_stop, fuel_stop';
COMMENT ON COLUMN move_waypoints.sequence_order IS 'Order of waypoint in the journey (0 = origin city)';
COMMENT ON COLUMN move_waypoints.overnight_recommended IS 'Whether an overnight stay is recommended at this waypoint';
