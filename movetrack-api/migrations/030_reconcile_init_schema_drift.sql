-- Migration 030: Reconcile schema objects that drifted out of db/init-movetrack.sql.
--
-- Background
-- ----------
-- db/init-movetrack.sql was last hand-synced around migration 018, so every table,
-- column, and index introduced by later migrations (and a few earlier ones whose
-- objects were never backported) is absent from a database built fresh from init.
-- The migration runner (bin/migrate.js) adopts such a database by baselining
-- everything through 026 WITHOUT running it, so those objects never get created on
-- fresh/staging/local builds -- exactly the bug class as locations.lat/lng (029).
--
-- Production is unaffected: the legacy deploy loop ran every migration, so it
-- already has all of these. This migration is fully idempotent
-- (CREATE TABLE / ADD COLUMN / CREATE INDEX ... IF NOT EXISTS): a no-op on
-- production and on fresh builds from the reconciled init, a repair on any
-- already-deployed fresh-from-init database. db/init-movetrack.sql carries an
-- identical reconciliation block so future fresh builds include these directly.
--
-- Each object is annotated with the migration that originally introduced it.

-- ── Tables ───────────────────────────────────────────────────────────────────

-- move_waypoints (011_add_move_waypoints)
CREATE TABLE IF NOT EXISTS move_waypoints (
  id BIGSERIAL PRIMARY KEY,
  saved_move_id BIGINT REFERENCES saved_moves(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(user_id),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(50),
  country VARCHAR(50) DEFAULT 'USA',
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),
  source VARCHAR(50) DEFAULT 'manual',
  distance_from_origin_miles DECIMAL(10, 2),
  typical_drive_hours_from_origin DECIMAL(5, 2),
  notes TEXT,
  overnight_recommended BOOLEAN DEFAULT false,
  sequence_order INTEGER DEFAULT 0,
  -- later additions: 013 (distance_source), 015 (segment_*), 021 (is_dropoff)
  distance_source VARCHAR(20) DEFAULT 'calculated',
  segment_distance_miles NUMERIC(10,2),
  segment_duration_hours NUMERIC(5,2),
  is_dropoff BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- move_vehicles (014_move_architecture_v2)
CREATE TABLE IF NOT EXISTS move_vehicles (
  id SERIAL PRIMARY KEY,
  move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
  vehicle_type VARCHAR(50) NOT NULL DEFAULT 'truck',
  name VARCHAR(100),
  license_plate VARCHAR(20),
  capacity_cu_ft INTEGER,
  max_weight_lbs INTEGER,
  is_rental BOOLEAN DEFAULT false,
  rental_company VARCHAR(100),
  rental_confirmation VARCHAR(100),
  pickup_date DATE,
  return_date DATE,
  pickup_location TEXT,
  return_location TEXT,
  status VARCHAR(20) DEFAULT 'available',
  current_load_cu_ft INTEGER DEFAULT 0,
  current_load_weight_lbs INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- move_team_members (014_move_architecture_v2)
CREATE TABLE IF NOT EXISTS move_team_members (
  id SERIAL PRIMARY KEY,
  move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255),
  role VARCHAR(50) DEFAULT 'helper',
  can_drive BOOLEAN DEFAULT false,
  available_dates JSONB DEFAULT '[]',
  invitation_status VARCHAR(20) DEFAULT 'pending',
  invitation_sent_at TIMESTAMP,
  invitation_accepted_at TIMESTAMP,
  share_token VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- move_locations (014_move_architecture_v2)
CREATE TABLE IF NOT EXISTS move_locations (
  id SERIAL PRIMARY KEY,
  move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  location_role VARCHAR(20) NOT NULL DEFAULT 'intermediate',
  sequence_order INTEGER DEFAULT 0,
  has_loading BOOLEAN DEFAULT false,
  has_unloading BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(move_id, location_id)
);

-- beta_interaction_logs (026_add_beta_instrumentation)
CREATE TABLE IF NOT EXISTS beta_interaction_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_latency_ms INT,
  ttfe_ms INT,
  gemini_latency_ms INT,
  vision_latency_ms INT,
  had_attachments BOOLEAN DEFAULT FALSE,
  attachment_count INT DEFAULT 0,
  attachment_types TEXT[],
  tool_calls TEXT[],
  tool_call_count INT DEFAULT 0,
  items_added_this_turn INT DEFAULT 0,
  detected_item_count INT,
  avg_confidence NUMERIC(4,3),
  min_confidence NUMERIC(4,3),
  vision_provider TEXT,
  gemini_model TEXT,
  gemini_rounds INT DEFAULT 1,
  had_error BOOLEAN DEFAULT FALSE,
  error_message TEXT
);

-- item_feedback (026_add_beta_instrumentation) -- references beta_interaction_logs
CREATE TABLE IF NOT EXISTS item_feedback (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  interaction_log_id BIGINT REFERENCES beta_interaction_logs(id) ON DELETE SET NULL,
  feedback TEXT NOT NULL CHECK (feedback IN ('correct', 'wrong', 'hallucinated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Columns ──────────────────────────────────────────────────────────────────

-- move_sessions: session typing + waypoint/vehicle refs (012, 014)
ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS session_type VARCHAR(20) DEFAULT 'loading';
ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS start_waypoint_id BIGINT REFERENCES move_waypoints(id);
ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS end_waypoint_id BIGINT REFERENCES move_waypoints(id);
ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS current_truck_waypoint_id BIGINT REFERENCES move_waypoints(id);
ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES move_vehicles(id) ON DELETE SET NULL;

-- move_waypoints: optional location ref for work stops (014) + later additions
-- (013 distance_source, 015 segment_*, 021 is_dropoff). Repeated as ALTERs so a
-- pre-existing move_waypoints (prod) is self-healed even though CREATE TABLE above
-- only takes effect on databases that lack the table entirely.
ALTER TABLE move_waypoints ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE move_waypoints ADD COLUMN IF NOT EXISTS distance_source VARCHAR(20) DEFAULT 'calculated';
ALTER TABLE move_waypoints ADD COLUMN IF NOT EXISTS segment_distance_miles NUMERIC(10,2);
ALTER TABLE move_waypoints ADD COLUMN IF NOT EXISTS segment_duration_hours NUMERIC(5,2);
ALTER TABLE move_waypoints ADD COLUMN IF NOT EXISTS is_dropoff BOOLEAN DEFAULT false;

-- items: QR codes (019) + AI confidence (026)
ALTER TABLE items ADD COLUMN IF NOT EXISTS qr_code TEXT UNIQUE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS qr_assigned_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,3);
ALTER TABLE items ADD COLUMN IF NOT EXISTS confidence_source TEXT;

-- item_estimate_events: error metadata for failed AI estimates (024)
ALTER TABLE item_estimate_events ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE item_estimate_events ADD COLUMN IF NOT EXISTS error_stage VARCHAR(64);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- locations (010_add_truck_naming)
CREATE INDEX IF NOT EXISTS idx_locations_truck_type ON locations(user_id, location_type) WHERE location_type = 'truck';

-- move_sessions FK indexes (009_add_move_session_columns)
CREATE INDEX IF NOT EXISTS idx_move_sessions_start_location ON move_sessions(session_start_location_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_start_collection ON move_sessions(session_start_collection_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_end_location ON move_sessions(session_end_location_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_end_collection ON move_sessions(session_end_collection_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_truck_location ON move_sessions(truck_location_id);

-- move_sessions typing + waypoint indexes (012)
CREATE INDEX IF NOT EXISTS idx_move_sessions_type ON move_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_move_sessions_start_waypoint ON move_sessions(start_waypoint_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_end_waypoint ON move_sessions(end_waypoint_id);

-- move_sessions vehicle index (014)
CREATE INDEX IF NOT EXISTS idx_move_sessions_vehicle_id ON move_sessions(vehicle_id);

-- move_waypoints indexes (011, 014)
CREATE INDEX IF NOT EXISTS idx_move_waypoints_saved_move ON move_waypoints(saved_move_id);
CREATE INDEX IF NOT EXISTS idx_move_waypoints_user ON move_waypoints(user_id);
CREATE INDEX IF NOT EXISTS idx_move_waypoints_sequence ON move_waypoints(saved_move_id, sequence_order);
CREATE INDEX IF NOT EXISTS idx_move_waypoints_location_id ON move_waypoints(location_id);

-- move_vehicles / move_team_members / move_locations indexes (014)
CREATE INDEX IF NOT EXISTS idx_move_vehicles_move_id ON move_vehicles(move_id);
CREATE INDEX IF NOT EXISTS idx_move_team_members_move_id ON move_team_members(move_id);
CREATE INDEX IF NOT EXISTS idx_move_team_members_share_token ON move_team_members(share_token);
CREATE INDEX IF NOT EXISTS idx_move_locations_move_id ON move_locations(move_id);
CREATE INDEX IF NOT EXISTS idx_move_locations_location_id ON move_locations(location_id);

-- beta instrumentation indexes (026)
CREATE INDEX IF NOT EXISTS idx_beta_logs_user ON beta_interaction_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_beta_logs_created ON beta_interaction_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beta_logs_session ON beta_interaction_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_item_feedback_item ON item_feedback(item_id);
CREATE INDEX IF NOT EXISTS idx_item_feedback_user ON item_feedback(user_id);
