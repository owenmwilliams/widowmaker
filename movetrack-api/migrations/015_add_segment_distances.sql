-- Migration: Add segment distance/duration columns to move_waypoints
-- These track the distance FROM the previous point (origin or prior waypoint) TO this waypoint

-- Add segment distance column (distance from previous point)
ALTER TABLE move_waypoints ADD COLUMN IF NOT EXISTS segment_distance_miles NUMERIC(10,2);
ALTER TABLE move_waypoints ADD COLUMN IF NOT EXISTS segment_duration_hours NUMERIC(5,2);

-- Comments
COMMENT ON COLUMN move_waypoints.segment_distance_miles IS 'Distance in miles from previous point (origin or prior waypoint) to this waypoint';
COMMENT ON COLUMN move_waypoints.segment_duration_hours IS 'Drive time in hours from previous point to this waypoint';
