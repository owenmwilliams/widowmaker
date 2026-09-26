-- 047_add_booking_reservations.sql
--
-- Per-vendor MCP agent server, reserve-pending bookings (W1a, #111).
--
--   booking_reservations — one row per "reserve my date" action against a
--       priced intake quote (#108). Status machine:
--         'pending_confirmation' → 'confirmed' | 'declined' | 'expired'
--       The vendor has a 24-hour confirm window (expires_at); expiry is
--       LAZY — any read that encounters a past-due pending row flips it to
--       'expired' (no cron). deposit_simulated is TRUE everywhere in this
--       build: NO real charges exist anywhere yet (real rails are W2), and
--       every customer-facing message says so.
--
--   companies.payments_mode — 'none' | 'simulated'. 'simulated' lets the
--       vendor's agent take a pretend deposit during reserve_booking (demo
--       vendors); 'none' reserves the date with no deposit step at all.
--
-- Keep in sync with db/init-movetrack.sql (scripts/check-schema-drift.js).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS payments_mode VARCHAR(20) NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS booking_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    intake_quote_id UUID NOT NULL REFERENCES intake_quotes(id) ON DELETE CASCADE,
    capture_session_id UUID REFERENCES company_capture_sessions(id) ON DELETE SET NULL,
    customer_email VARCHAR(255) NOT NULL,
    requested_date DATE NOT NULL,
    deposit_amount NUMERIC(10,2),
    deposit_simulated BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(30) NOT NULL DEFAULT 'pending_confirmation',
    expires_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_reservations_company
    ON booking_reservations(company_id, status, created_at DESC);
