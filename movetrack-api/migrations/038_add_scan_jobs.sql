-- 038_add_scan_jobs.sql
--
-- Durable scan jobs (Pathway C, issue #42 Phase 2). A photo/video scan used to
-- live entirely inside one SSE HTTP request — a dropped connection, app
-- backgrounding, or an API restart lost the scan with nothing to show for it.
-- Each scan is now a row created when the client registers uploaded media,
-- processed via a Cloud Tasks push queue (request-context CPU), and the client
-- materializes the review card from `result`, surviving disconnects.
--
-- Numbering: 036/037 belong to Pathway F (#45) per the arbiter's merge-order
-- ruling; this pathway takes 038.
--
-- Idempotency: unique per (user, key) among jobs the user hasn't consumed yet.
-- Once a job is consumed (its outcome acknowledged), the same media may be
-- scanned again intentionally — so the uniqueness is scoped by consumed_at.

CREATE TABLE IF NOT EXISTS scan_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    session_id UUID REFERENCES nexus_sessions(id) ON DELETE SET NULL,
    idempotency_key VARCHAR(80),
    media_url TEXT NOT NULL,
    mime_type VARCHAR(100),
    media_kind VARCHAR(10) NOT NULL DEFAULT 'photo' CHECK (media_kind IN ('photo', 'video')),
    room_hint VARCHAR(255),
    caption TEXT,
    plan VARCHAR(20) NOT NULL DEFAULT 'basic',
    status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    stage VARCHAR(30),
    attempts INTEGER NOT NULL DEFAULT 0,
    result JSONB,
    error TEXT,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_jobs_idem
    ON scan_jobs(user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scan_jobs_user
    ON scan_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_pending
    ON scan_jobs(created_at) WHERE status IN ('queued', 'processing');
