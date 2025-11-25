-- Migration 009: Add Move Day tracking functionality
-- Description: Adds tables and fields to support move day operations including
--              box scanning, loading/unloading tracking, timeline events, and damage reporting

-- Create move_sessions table to track active moves
CREATE TABLE IF NOT EXISTS move_sessions (
  id BIGSERIAL PRIMARY KEY,
  owner VARCHAR NOT NULL,
  saved_move_id BIGINT REFERENCES saved_moves(id),
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, in_progress, loading, in_transit, unloading, completed, cancelled
  move_date DATE,
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  origin_location_id INTEGER REFERENCES locations(id),
  destination_location_id INTEGER REFERENCES locations(id),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create box_scans table to track individual box check-ins/outs
CREATE TABLE IF NOT EXISTS box_scans (
  id BIGSERIAL PRIMARY KEY,
  move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
  container_id BIGINT NOT NULL REFERENCES containers(id),
  scan_type VARCHAR(50) NOT NULL, -- loaded, unloaded, arrived_at_room, unpacked
  scanned_by VARCHAR,
  location_type VARCHAR(50), -- origin, truck, destination
  destination_room VARCHAR(255), -- for unloading scans
  notes TEXT,
  scanned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create move_timeline table for activity log
CREATE TABLE IF NOT EXISTS move_timeline (
  id BIGSERIAL PRIMARY KEY,
  move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL, -- session_started, box_loaded, box_unloaded, damage_reported, note_added, status_changed, session_completed
  event_data JSONB, -- flexible field for event-specific data
  description TEXT,
  created_by VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create damage_reports table for move day issues
CREATE TABLE IF NOT EXISTS damage_reports (
  id BIGSERIAL PRIMARY KEY,
  move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
  container_id BIGINT REFERENCES containers(id),
  item_id BIGINT REFERENCES items(id),
  severity VARCHAR(50) NOT NULL, -- minor, moderate, severe
  description TEXT NOT NULL,
  photo_urls TEXT[], -- array of photo URLs
  reported_by VARCHAR NOT NULL,
  reported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved BOOLEAN DEFAULT FALSE,
  resolution_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create move_crew table to track helpers/movers
CREATE TABLE IF NOT EXISTS move_crew (
  id BIGSERIAL PRIMARY KEY,
  move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(100), -- lead_mover, helper, driver, friend, family
  phone VARCHAR(20),
  email VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_move_sessions_owner ON move_sessions(owner);
CREATE INDEX IF NOT EXISTS idx_move_sessions_status ON move_sessions(status);
CREATE INDEX IF NOT EXISTS idx_move_sessions_date ON move_sessions(move_date);
CREATE INDEX IF NOT EXISTS idx_box_scans_session ON box_scans(move_session_id);
CREATE INDEX IF NOT EXISTS idx_box_scans_container ON box_scans(container_id);
CREATE INDEX IF NOT EXISTS idx_box_scans_type ON box_scans(scan_type);
CREATE INDEX IF NOT EXISTS idx_move_timeline_session ON move_timeline(move_session_id);
CREATE INDEX IF NOT EXISTS idx_damage_reports_session ON damage_reports(move_session_id);
CREATE INDEX IF NOT EXISTS idx_move_crew_session ON move_crew(move_session_id);

-- Add comments for documentation
COMMENT ON TABLE move_sessions IS 'Active move tracking sessions linking to saved move plans';
COMMENT ON TABLE box_scans IS 'Individual box scanning events during loading/unloading';
COMMENT ON TABLE move_timeline IS 'Chronological activity log for move day events';
COMMENT ON TABLE damage_reports IS 'Damage and issue reporting during the move';
COMMENT ON TABLE move_crew IS 'Crew members and helpers for a specific move';

COMMENT ON COLUMN move_sessions.status IS 'Current status: pending, in_progress, loading, in_transit, unloading, completed, cancelled';
COMMENT ON COLUMN box_scans.scan_type IS 'Type of scan: loaded, unloaded, arrived_at_room, unpacked';
COMMENT ON COLUMN box_scans.location_type IS 'Where the scan occurred: origin, truck, destination';
COMMENT ON COLUMN move_timeline.event_type IS 'Type of event: session_started, box_loaded, box_unloaded, damage_reported, note_added, status_changed, session_completed';
COMMENT ON COLUMN damage_reports.severity IS 'Severity level: minor, moderate, severe';
