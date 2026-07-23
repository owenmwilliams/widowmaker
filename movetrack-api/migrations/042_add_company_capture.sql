-- 042_add_company_capture.sql
--
-- Moving-company capture links (H1, issue #96). A company gets a link
-- https://app…/c/{token} to put on its website or mail to customers; the
-- customer records one video per room in the browser — no account, no OTP —
-- and the company automatically receives the Mover Inventory share link.
--
--   companies                — one row per moving company; `token` is the
--                              opaque url-safe id embedded in the /c/ link.
--   company_capture_sessions — one row per customer who started a capture:
--                              which company, the customer's real email, the
--                              lightweight guest user that owns the media and
--                              inventory, consent, per-session caps counters
--                              (≤20 videos / ≤500MB enforced in the route via
--                              a single conditional UPDATE), and expiry.
--   users.source             — nullable marker for how the user row came to
--                              exist ('company_link' for capture guests);
--                              normal signup rows keep NULL.
--
-- The guest user's `users.email` is a synthetic unique address — the real
-- customer email lives on the session row. Reusing an existing account by
-- typed-in email (no OTP!) would let anyone pull a stranger's inventory into
-- a company share, so guests are ALWAYS a fresh user row.
--
-- Keep in sync with db/init-movetrack.sql (scripts/check-schema-drift.js).

ALTER TABLE users ADD COLUMN IF NOT EXISTS source VARCHAR(40);

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    token VARCHAR(80) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_token ON companies(token);

CREATE TABLE IF NOT EXISTS company_capture_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_email VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    consent BOOLEAN NOT NULL DEFAULT FALSE,
    videos_count INTEGER NOT NULL DEFAULT 0,
    bytes_total BIGINT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_capture_sessions_company
    ON company_capture_sessions(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_capture_sessions_user
    ON company_capture_sessions(user_id);
