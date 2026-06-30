-- Migration 032: Inventory share links (mover-shareable inventory).
--
-- Backs a tokenized, public, read-only view of a user's inventory so it can be
-- texted/emailed to moving companies for quotes without giving them an account.
-- The public route resolves a share ONLY by its opaque token and never exposes
-- other users' data. Shares are revocable and can expire.
--
-- Idempotent (CREATE TABLE / CREATE INDEX ... IF NOT EXISTS). Mirrored in
-- db/init-movetrack.sql; see docs/database-changes.md.

CREATE TABLE IF NOT EXISTS inventory_shares (
  id             BIGSERIAL PRIMARY KEY,
  token          TEXT NOT NULL UNIQUE,
  user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  move_id        BIGINT REFERENCES saved_moves(id) ON DELETE SET NULL,
  title          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  view_count     INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventory_shares_token ON inventory_shares(token);
CREATE INDEX IF NOT EXISTS idx_inventory_shares_user ON inventory_shares(user_id);
