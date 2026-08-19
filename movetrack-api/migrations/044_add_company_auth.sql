-- 044_add_company_auth.sql
--
-- Mover dashboard login (F2, issue #99). Moving companies get their own
-- magic-link auth — COMPLETELY SEPARATE from user auth_tokens — so a company
-- session can never pass user authenticate() and vice versa.
--
--   company_auth_tokens — one row per issued company token, following the
--     auth_tokens conventions: tokens are SHA-256 HASHED at rest (a db breach
--     exposes no usable tokens), single-use is enforced via used_at, and
--     ip/user-agent are kept for forensics.
--       purpose 'magic_link' — 15-minute single-use login link mailed to the
--                              company's contact_email
--       purpose 'session'    — 30-day dashboard session minted on verify;
--                              logout sets used_at
--
--   company_capture_sessions.completed_at — when the customer finished the
--     walkthrough ("I'm done"). The dashboard shows it next to created_at;
--     rows completed before this column existed stay NULL (status is still
--     the source of truth for completion).
--
-- Keep in sync with db/init-movetrack.sql (scripts/check-schema-drift.js).

CREATE TABLE IF NOT EXISTS company_auth_tokens (
    id BIGSERIAL PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    token_hash VARCHAR(500) NOT NULL UNIQUE,
    purpose VARCHAR(20) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address VARCHAR(45),
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_company_auth_tokens_company
    ON company_auth_tokens(company_id);
CREATE INDEX IF NOT EXISTS idx_company_auth_tokens_expires_at
    ON company_auth_tokens(expires_at);

ALTER TABLE company_capture_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
