-- 046_add_intake_quotes.sql
--
-- Agentic intake, Mode A demo cut (#107). A customer who opens a company's
-- capture link can answer a short estimator battery (and/or film rooms) and
-- get a PRICED quote computed deterministically from THE VENDOR'S OWN rate
-- card — not from industry defaults like the consumer estimate engine (#89).
--
--   companies.trust_block — JSONB block of the legal/consumer-protection
--       facts every quote must carry (legal name, CAL-T / US DOT numbers,
--       statutory liability + a worked example, deposit/refund rule, clock
--       rules, regulator link). The quote API REFUSES to price without a
--       complete block (409) — a price with no license/liability context is
--       exactly the dark pattern this product exists to kill.
--
--   rate_cards — versioned pricing config per company. `data` holds the
--       whole card as JSONB (hourlyByCrew, minHours, billingIncrementMin,
--       travelRule, truckFee, surcharges, packingAddon, deposit terms,
--       nteMarginPct, maxQuoteWithoutReview, reviewFlagItems). Versions are
--       immutable once quoted against; the newest ACTIVE version prices new
--       quotes, and intake_quotes pins the version it used.
--
--   intake_quotes — one row per priced (or review-flagged) quote. `inputs`
--       stores EVERYTHING the engine consumed (answers, inventory snapshot,
--       distance, the rate-card data snapshot); `outputs` the full computed
--       payload. Together with rate_card_version + engine_version, any quote
--       is exactly reproducible after the fact (PRD R8).
--
-- Keep in sync with db/init-movetrack.sql (scripts/check-schema-drift.js).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS trust_block JSONB;

CREATE TABLE IF NOT EXISTS rate_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_cards_company_version
    ON rate_cards(company_id, version);

CREATE TABLE IF NOT EXISTS intake_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    capture_session_id UUID REFERENCES company_capture_sessions(id) ON DELETE SET NULL,
    rate_card_version INTEGER NOT NULL,
    engine_version VARCHAR(40) NOT NULL,
    inputs JSONB NOT NULL,
    outputs JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'quoted',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_quotes_company
    ON intake_quotes(company_id, created_at DESC);
