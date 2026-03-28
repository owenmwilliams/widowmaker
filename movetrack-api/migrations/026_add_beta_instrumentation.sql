BEGIN;

-- ── 1. Beta interaction logs ─────────────────────────────────────────────────
-- One row per processMessage() call for performance tracking during family beta.

CREATE TABLE IF NOT EXISTS beta_interaction_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Timing (milliseconds)
  total_latency_ms INT,
  ttfe_ms INT,                            -- time to first emit (proxy for TTFT)
  gemini_latency_ms INT,                  -- sum of all generateContent() calls
  vision_latency_ms INT,                  -- time in analyze_photo / analyze_video

  -- Message context
  had_attachments BOOLEAN DEFAULT FALSE,
  attachment_count INT DEFAULT 0,
  attachment_types TEXT[],
  tool_calls TEXT[],
  tool_call_count INT DEFAULT 0,
  items_added_this_turn INT DEFAULT 0,

  -- Vision quality
  detected_item_count INT,
  avg_confidence NUMERIC(4,3),
  min_confidence NUMERIC(4,3),
  vision_provider TEXT,

  -- Gemini model info
  gemini_model TEXT,
  gemini_rounds INT DEFAULT 1,

  -- Error tracking
  had_error BOOLEAN DEFAULT FALSE,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_beta_logs_user ON beta_interaction_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_beta_logs_created ON beta_interaction_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beta_logs_session ON beta_interaction_logs(session_id);

-- ── 2. Confidence columns on items ───────────────────────────────────────────
ALTER TABLE items ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,3);
ALTER TABLE items ADD COLUMN IF NOT EXISTS confidence_source TEXT;

-- ── 3. Item feedback for precision/hallucination tracking ────────────────────
CREATE TABLE IF NOT EXISTS item_feedback (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  interaction_log_id BIGINT REFERENCES beta_interaction_logs(id) ON DELETE SET NULL,
  feedback TEXT NOT NULL CHECK (feedback IN ('correct', 'wrong', 'hallucinated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_feedback_item ON item_feedback(item_id);
CREATE INDEX IF NOT EXISTS idx_item_feedback_user ON item_feedback(user_id);

COMMIT;

SELECT '026 beta instrumentation migration complete' AS status;
