-- 041_add_quote_leads.sql
--
-- Lean quote-shopping lead-gen (#90). The QuoteShoppingModal tier picker used
-- to be pure theater — no API call, no record. Owner decision: a tier confirm
-- now submits a real lead that is persisted here and emailed to the owner,
-- who brokers quotes manually while volume is low.
--
-- saved_move_id is BIGINT (not UUID) because saved_moves.id is BIGSERIAL.
--
-- Keep in sync with db/init-movetrack.sql (scripts/check-schema-drift.js).

CREATE TABLE IF NOT EXISTS quote_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    saved_move_id BIGINT REFERENCES saved_moves(id) ON DELETE SET NULL,
    tier VARCHAR(40) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(40),
    move_summary JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_leads_status_created
    ON quote_leads(status, created_at);
