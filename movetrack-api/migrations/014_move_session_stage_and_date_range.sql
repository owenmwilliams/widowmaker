-- Migration 014: Add move date ranges and session stage tracking
BEGIN;

-- Add desired move window to saved_moves
ALTER TABLE saved_moves
  ADD COLUMN IF NOT EXISTS desired_start_date DATE,
  ADD COLUMN IF NOT EXISTS desired_end_date DATE;

-- Backfill desired dates using existing move_date when missing
UPDATE saved_moves
SET desired_start_date = COALESCE(desired_start_date, move_date),
    desired_end_date = COALESCE(desired_end_date, move_date)
WHERE desired_start_date IS NULL
   OR desired_end_date IS NULL;

-- Add detailed session tracking columns
ALTER TABLE move_sessions
  ADD COLUMN IF NOT EXISTS session_date DATE,
  ADD COLUMN IF NOT EXISTS stage VARCHAR(20) NOT NULL DEFAULT 'planning',
  ADD COLUMN IF NOT EXISTS completed_destination_location_id INTEGER REFERENCES locations(id);

-- Ensure session_date populated for historical rows
UPDATE move_sessions
SET session_date = COALESCE(session_date, move_date)
WHERE session_date IS NULL;

-- Align completed sessions with their destination
UPDATE move_sessions
SET completed_destination_location_id = session_end_location_id
WHERE status = 'complete'
  AND session_end_location_id IS NOT NULL
  AND completed_destination_location_id IS NULL;

-- Enforce valid stage values
ALTER TABLE move_sessions
  ADD CONSTRAINT chk_move_sessions_stage
  CHECK (stage IN ('planning', 'action', 'complete'));

-- Attempt to backfill saved_move_id when missing before enforcing NOT NULL
WITH candidate_moves AS (
  SELECT ms.id as session_id,
         sm.id as move_id
  FROM move_sessions ms
  JOIN saved_moves sm
    ON sm.origin_location_id = ms.origin_location_id
   AND sm.destination_location_id = ms.destination_location_id
   AND (sm.move_date = ms.move_date OR sm.desired_start_date = ms.move_date)
  JOIN users u ON u.user_id = sm.user_id
  WHERE ms.saved_move_id IS NULL
    AND LOWER(u.email) = LOWER(ms.owner)
)
UPDATE move_sessions ms
SET saved_move_id = cm.move_id
FROM candidate_moves cm
WHERE ms.id = cm.session_id;

-- Require saved_move_id now that backfill attempt is complete
ALTER TABLE move_sessions
  ALTER COLUMN saved_move_id SET NOT NULL;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_saved_moves_desired_range
  ON saved_moves(desired_start_date, desired_end_date);
CREATE INDEX IF NOT EXISTS idx_move_sessions_session_date
  ON move_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_move_sessions_stage
  ON move_sessions(stage);
CREATE INDEX IF NOT EXISTS idx_move_sessions_completed_dest
  ON move_sessions(completed_destination_location_id);

COMMIT;
