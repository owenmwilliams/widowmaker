-- Migration: Add is_dropoff field to move_waypoints
-- This allows waypoints to be marked as locations where items should be unloaded

ALTER TABLE move_waypoints
ADD COLUMN IF NOT EXISTS is_dropoff BOOLEAN DEFAULT false;

-- Add comment
COMMENT ON COLUMN move_waypoints.is_dropoff IS 'Whether this waypoint is a drop-off location requiring an unloading session';
