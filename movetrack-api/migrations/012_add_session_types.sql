-- Migration: Add session types and waypoint references to move_sessions
-- Session types differentiate between loading, driving, and unloading sessions
-- Waypoint references track the start/end points for driving sessions

-- Add session_type column
-- 'loading' = moving items from location to truck
-- 'driving' = moving truck from one waypoint to another
-- 'unloading' = moving items from truck to location
-- 'transfer' = moving items between locations (no truck involved)
ALTER TABLE move_sessions
ADD COLUMN IF NOT EXISTS session_type VARCHAR(20) DEFAULT 'loading';

-- Add waypoint reference columns for driving sessions
ALTER TABLE move_sessions
ADD COLUMN IF NOT EXISTS start_waypoint_id BIGINT REFERENCES move_waypoints(id),
ADD COLUMN IF NOT EXISTS end_waypoint_id BIGINT REFERENCES move_waypoints(id);

-- Add current waypoint for tracking where the truck is now
-- This gets updated when a driving session is completed
ALTER TABLE move_sessions
ADD COLUMN IF NOT EXISTS current_truck_waypoint_id BIGINT REFERENCES move_waypoints(id);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_move_sessions_type ON move_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_move_sessions_start_waypoint ON move_sessions(start_waypoint_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_end_waypoint ON move_sessions(end_waypoint_id);

-- Add comments
COMMENT ON COLUMN move_sessions.session_type IS 'Type of session: loading, driving, unloading, or transfer';
COMMENT ON COLUMN move_sessions.start_waypoint_id IS 'Starting waypoint for driving sessions';
COMMENT ON COLUMN move_sessions.end_waypoint_id IS 'Ending waypoint for driving sessions';
COMMENT ON COLUMN move_sessions.current_truck_waypoint_id IS 'Current waypoint location of the truck (updated when driving completes)';
