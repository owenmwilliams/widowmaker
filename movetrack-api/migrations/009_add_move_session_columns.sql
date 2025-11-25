-- Migration: Add missing columns to move_sessions table
-- These columns are needed for session start/end tracking and truck location

ALTER TABLE move_sessions
ADD COLUMN IF NOT EXISTS session_start_location_id BIGINT REFERENCES locations(id),
ADD COLUMN IF NOT EXISTS session_start_collection_id BIGINT REFERENCES collections(id),
ADD COLUMN IF NOT EXISTS session_end_location_id BIGINT REFERENCES locations(id),
ADD COLUMN IF NOT EXISTS session_end_collection_id BIGINT REFERENCES collections(id),
ADD COLUMN IF NOT EXISTS truck_location_id BIGINT REFERENCES locations(id);

-- Add indexes for the new foreign key columns
CREATE INDEX IF NOT EXISTS idx_move_sessions_start_location ON move_sessions(session_start_location_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_start_collection ON move_sessions(session_start_collection_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_end_location ON move_sessions(session_end_location_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_end_collection ON move_sessions(session_end_collection_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_truck_location ON move_sessions(truck_location_id);

-- Add comments
COMMENT ON COLUMN move_sessions.session_start_location_id IS 'Actual starting location for this specific session (may differ from origin)';
COMMENT ON COLUMN move_sessions.session_start_collection_id IS 'Optional starting collection within the start location';
COMMENT ON COLUMN move_sessions.session_end_location_id IS 'Target end location for this session (may be truck or destination)';
COMMENT ON COLUMN move_sessions.session_end_collection_id IS 'Optional target collection within the end location';
COMMENT ON COLUMN move_sessions.truck_location_id IS 'Reference to the truck staging location if this session uses a truck';
