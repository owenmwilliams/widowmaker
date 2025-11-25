-- Migration 013: Expand move session endpoints to support arbitrary start/end locations and truck staging
BEGIN;

ALTER TABLE move_sessions
  ADD COLUMN IF NOT EXISTS session_start_location_id INTEGER REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS session_start_collection_id INTEGER REFERENCES collections(id),
  ADD COLUMN IF NOT EXISTS session_end_location_id INTEGER REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS session_end_collection_id INTEGER REFERENCES collections(id),
  ADD COLUMN IF NOT EXISTS truck_location_id INTEGER REFERENCES locations(id);

UPDATE move_sessions
SET session_start_location_id = COALESCE(session_start_location_id, origin_location_id),
    session_end_location_id = COALESCE(session_end_location_id, destination_location_id)
WHERE session_start_location_id IS NULL
   OR session_end_location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_move_sessions_start_location ON move_sessions(session_start_location_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_end_location ON move_sessions(session_end_location_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_truck_location ON move_sessions(truck_location_id);

COMMENT ON COLUMN move_sessions.session_start_location_id IS 'Location ID where a move session starts (can be truck or site)';
COMMENT ON COLUMN move_sessions.session_end_location_id IS 'Location ID where a move session ends (can be truck or site)';
COMMENT ON COLUMN move_sessions.truck_location_id IS 'Auto-generated truck location tied to this session';

COMMIT;
