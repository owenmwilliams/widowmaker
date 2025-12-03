-- Migration 030: Finalize UUID migration - Replace user_id with uuid as primary key
-- This completes the UUID migration started in 015
-- WARNING: This will delete all existing users and related data

BEGIN;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop all existing data (since we're early in development)
-- This is simpler than trying to migrate existing integer IDs
TRUNCATE TABLE auth_tokens CASCADE;
TRUNCATE TABLE login_history CASCADE;
TRUNCATE TABLE saved_moves CASCADE;
TRUNCATE TABLE move_waypoints CASCADE;
TRUNCATE TABLE move_sessions CASCADE;
TRUNCATE TABLE items CASCADE;
TRUNCATE TABLE containers CASCADE;
TRUNCATE TABLE collections CASCADE;
TRUNCATE TABLE locations CASCADE;
TRUNCATE TABLE users CASCADE;

-- Drop the old user_id column and uuid column if they exist
ALTER TABLE users DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE users DROP COLUMN IF EXISTS uuid CASCADE;

-- Add user_id as UUID primary key
ALTER TABLE users
  ADD COLUMN user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4();

-- Recreate auth_tokens with UUID user_id
ALTER TABLE auth_tokens DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE auth_tokens DROP COLUMN IF EXISTS user_uuid CASCADE;
ALTER TABLE auth_tokens
  ADD COLUMN user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE;

-- Recreate login_history with UUID user_id
ALTER TABLE login_history DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE login_history DROP COLUMN IF EXISTS user_uuid CASCADE;
ALTER TABLE login_history
  ADD COLUMN user_id UUID REFERENCES users(user_id) ON DELETE CASCADE;

-- Recreate saved_moves with UUID user_id
ALTER TABLE saved_moves DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE saved_moves DROP COLUMN IF EXISTS user_uuid CASCADE;
ALTER TABLE saved_moves
  ADD COLUMN user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE;

-- Recreate other tables with UUID user_id
ALTER TABLE collections DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE collections
  ADD COLUMN user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE containers DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE containers
  ADD COLUMN user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE items DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE items
  ADD COLUMN user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE locations DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE locations
  ADD COLUMN user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE move_sessions DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE move_sessions
  ADD COLUMN user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE move_waypoints DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE move_waypoints
  ADD COLUMN user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_containers_user_id ON containers(user_id);
CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_locations_user_id ON locations(user_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_user_id ON move_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_move_waypoints_user_id ON move_waypoints(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_moves_user_id ON saved_moves(user_id);

COMMIT;
