-- 037_add_client_events.sql
--
-- Pathway F (observability). The iOS client recorded nothing prior to this —
-- a client-side failure (upload abort, SSE timeout, discarded review card) was
-- invisible to the server. This is a lightweight event log, not a crash
-- reporter: see MoveTrack-iOS/widowmaker/MoveTrack/Services/ClientEventLogger.swift
-- for the follow-up note on full crash/error reporting (Sentry/Crashlytics —
-- vendor choice left to Owen).

CREATE TABLE IF NOT EXISTS client_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  event_type TEXT NOT NULL CHECK (event_type IN (
    'upload_started', 'upload_succeeded', 'upload_failed',
    'sse_timeout', 'turn_failed',
    'review_card_shown', 'review_card_committed'
  )),
  client_at TIMESTAMPTZ,       -- when the event happened on-device (vs. created_at, when it was received)
  metadata JSONB,               -- freeform: mediaKind, byteSize, errorMessage, itemCount, etc.
  app_version TEXT,
  os_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_client_events_user ON client_events(user_id);
CREATE INDEX IF NOT EXISTS idx_client_events_session ON client_events(session_id);
CREATE INDEX IF NOT EXISTS idx_client_events_created ON client_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_events_type ON client_events(event_type);
