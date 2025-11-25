-- Migration 012: Add session naming to move sessions
-- Description: Allow users to name sessions for easier identification (e.g., "Planning", "Truck 1", "Loading")

-- Add session_name column to move_sessions table
ALTER TABLE move_sessions
  ADD COLUMN IF NOT EXISTS session_name VARCHAR(255);

-- Create index for performance when searching/filtering by session name
CREATE INDEX IF NOT EXISTS idx_move_sessions_name ON move_sessions(session_name);

-- Add comment for documentation
COMMENT ON COLUMN move_sessions.session_name IS 'User-defined name for the session (e.g., "Planning", "Truck 1", "Loading")';
