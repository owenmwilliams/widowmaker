-- 045_add_mover_invites.sql
--
-- Discover moving companies — invite-loop v1 (F3, issue #100). A customer
-- searches real moving companies near their move origin (Google Places),
-- picks up to 5, and sends each one their inventory doc share link plus an
-- invite to claim a free Nexus Moves mover account.
--
--   mover_invites — one row per (customer, business) invite:
--     company_id         — set when the business already had a Nexus account
--                          at send time (direct email) OR when it later claims
--                          via the invite link; NULL while unclaimed.
--     place_ref          — Google Places place_id; the conservative "already
--                          on Nexus" match key for future searches.
--     business_email     — the contact email we actually delivered to (Nexus
--                          companies only at send time; Places never returns
--                          business emails, so non-Nexus invites are forwarded
--                          by the customer instead).
--     status             — 'sent' | 'claimed' | 'failed'.
--     share_token_or_url — the inventory share URL that rode along.
--     invite_token       — opaque single-use token behind
--                          {APP}/mover/claim/{inviteToken} (only minted for
--                          non-Nexus invites; claim is atomic like magic
--                          links). Same sensitivity class as companies.token.
--
-- Keep in sync with db/init-movetrack.sql (scripts/check-schema-drift.js).

CREATE TABLE IF NOT EXISTS mover_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    place_ref VARCHAR(255),
    business_name VARCHAR(255) NOT NULL,
    business_email VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'sent',
    share_token_or_url VARCHAR(500),
    invite_token VARCHAR(80) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mover_invites_user
    ON mover_invites(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mover_invites_place_ref
    ON mover_invites(place_ref);

CREATE INDEX IF NOT EXISTS idx_mover_invites_company
    ON mover_invites(company_id);
