-- Migration: Add distance_source column to move_waypoints
-- Tracks whether distance values are estimates (Haversine) or calculated (from routing API)

-- Add distance_source column
-- Values: 'estimated' (Haversine + road factor), 'calculated' (from Google Directions API), 'polyline' (from route polyline)
ALTER TABLE move_waypoints
ADD COLUMN IF NOT EXISTS distance_source VARCHAR(20) DEFAULT 'calculated';

-- Update existing records based on source
-- If source is 'suggested', they were calculated from polyline
UPDATE move_waypoints SET distance_source = 'polyline' WHERE source = 'suggested' AND distance_source IS NULL;

-- If source is 'manual' or 'manual_geocoded', mark as estimated (we'll calculate on next save)
UPDATE move_waypoints SET distance_source = 'estimated' WHERE source IN ('manual', 'manual_geocoded') AND distance_from_origin_miles IS NOT NULL AND distance_source IS NULL;

-- Add comment
COMMENT ON COLUMN move_waypoints.distance_source IS 'How distance was calculated: estimated (Haversine), calculated (Directions API), polyline (from route)';
