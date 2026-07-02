-- 036_add_scan_events.sql
--
-- Pathway F (observability). Analog of item_estimate_events for the scan path,
-- which had none: one row per analyze_photo/analyze_video tool call, recording
-- what stage it reached, how it did there, and what it cost — the single table
-- that would have answered most of the 2026-07-01 beta investigation
-- (docs/notes/beta-scan-reliability-investigation.md, Section 5.2 #5).
--
-- NOTE for whoever merges Pathway C (#42) second: C's Phase 2 `scan_jobs` table
-- is a different concept (one row per upload, tracking async job lifecycle).
-- Arbiter ruling (merge order): this migration lands first, so it keeps 036;
-- C-P2's scan_jobs renumbers to 038.

CREATE TABLE IF NOT EXISTS scan_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_id TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- What was analyzed
  media_kind TEXT NOT NULL CHECK (media_kind IN ('photo', 'video')),
  media_url TEXT,
  media_bytes BIGINT,
  frame_count INT,

  -- How it was analyzed
  provider TEXT,
  model TEXT,

  -- Outcome
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_stage TEXT,          -- e.g. 'download', 'frame_extraction', 'audio_extraction',
                              -- 'frame_upload', 'vision_call', 'parse', 'persist'
  error_message TEXT,
  stage_status JSONB,         -- { download: 'ok', frame_extraction: 'ok', vision_call: 'error', ... }
  parse_error TEXT,

  -- Cost / performance
  latency_ms INT,
  token_usage JSONB,          -- { promptTokens, candidatesTokens, totalTokens } when the provider reports it

  -- Result
  item_count INT
);

CREATE INDEX IF NOT EXISTS idx_scan_events_user ON scan_events(user_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_session ON scan_events(session_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_created ON scan_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_status_error ON scan_events(status) WHERE status = 'error';
