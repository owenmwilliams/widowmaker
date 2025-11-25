-- Migration 016: Finalize UUID conversion and cleanup legacy columns
-- This migration completes the transition to UUID user_id and removes owner/username columns

BEGIN;

-- Step 1: Drop foreign key constraints that reference users.user_id (bigint)
-- These will be recreated with UUID references later
ALTER TABLE auth_tokens DROP CONSTRAINT IF EXISTS auth_tokens_user_id_fkey;
ALTER TABLE saved_moves DROP CONSTRAINT IF EXISTS saved_moves_user_id_fkey;
ALTER TABLE login_history DROP CONSTRAINT IF EXISTS login_history_user_id_fkey;
ALTER TABLE collections DROP CONSTRAINT IF EXISTS collections_user_id_fkey;
ALTER TABLE containers DROP CONSTRAINT IF EXISTS containers_user_id_fkey;
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_user_id_fkey;
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_user_id_fkey;
ALTER TABLE move_projects DROP CONSTRAINT IF EXISTS move_projects_user_id_fkey;
ALTER TABLE move_sessions DROP CONSTRAINT IF EXISTS move_sessions_user_id_fkey;
ALTER TABLE storage_units DROP CONSTRAINT IF EXISTS storage_units_user_id_fkey;

-- Step 2: Convert UUID columns to user_id in FK tables that already have user_uuid
-- These tables already have the UUID values populated from migration 015
ALTER TABLE auth_tokens DROP COLUMN IF EXISTS user_id;
ALTER TABLE auth_tokens RENAME COLUMN user_uuid TO user_id;

ALTER TABLE saved_moves DROP COLUMN IF EXISTS user_id;
ALTER TABLE saved_moves RENAME COLUMN user_uuid TO user_id;

ALTER TABLE login_history DROP COLUMN IF EXISTS user_id;
ALTER TABLE login_history RENAME COLUMN user_uuid TO user_id;

-- Step 3: Convert bigint user_id to UUID for tables with owner columns
-- Add temporary UUID columns
ALTER TABLE collections ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE items ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE move_projects ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS user_uuid UUID;
ALTER TABLE storage_units ADD COLUMN IF NOT EXISTS user_uuid UUID;

-- Populate UUID columns by matching bigint user_id to users.user_id
UPDATE collections c SET user_uuid = u.uuid FROM users u WHERE c.user_id = u.user_id;
UPDATE containers c SET user_uuid = u.uuid FROM users u WHERE c.user_id = u.user_id;
UPDATE items i SET user_uuid = u.uuid FROM users u WHERE i.user_id = u.user_id;
UPDATE locations l SET user_uuid = u.uuid FROM users u WHERE l.user_id = u.user_id;
UPDATE move_projects mp SET user_uuid = u.uuid FROM users u WHERE mp.user_id = u.user_id;
UPDATE move_sessions ms SET user_uuid = u.uuid FROM users u WHERE ms.user_id = u.user_id;
UPDATE storage_units su SET user_uuid = u.uuid FROM users u WHERE su.user_id = u.user_id;

-- Make UUID columns NOT NULL
ALTER TABLE collections ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE containers ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE items ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE locations ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE move_projects ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE move_sessions ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE storage_units ALTER COLUMN user_uuid SET NOT NULL;

-- Drop old bigint user_id columns and rename user_uuid to user_id
ALTER TABLE collections DROP COLUMN user_id;
ALTER TABLE collections RENAME COLUMN user_uuid TO user_id;

ALTER TABLE containers DROP COLUMN user_id;
ALTER TABLE containers RENAME COLUMN user_uuid TO user_id;

ALTER TABLE items DROP COLUMN user_id;
ALTER TABLE items RENAME COLUMN user_uuid TO user_id;

ALTER TABLE locations DROP COLUMN user_id;
ALTER TABLE locations RENAME COLUMN user_uuid TO user_id;

ALTER TABLE move_projects DROP COLUMN user_id;
ALTER TABLE move_projects RENAME COLUMN user_uuid TO user_id;

ALTER TABLE move_sessions DROP COLUMN user_id;
ALTER TABLE move_sessions RENAME COLUMN user_uuid TO user_id;

ALTER TABLE storage_units DROP COLUMN user_id;
ALTER TABLE storage_units RENAME COLUMN user_uuid TO user_id;

-- Step 4: Convert users table to use UUID as primary key
-- Drop primary key constraint on bigint user_id
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;

-- Drop the old bigint user_id column
ALTER TABLE users DROP COLUMN user_id;

-- Rename uuid to user_id
ALTER TABLE users RENAME COLUMN uuid TO user_id;

-- Make user_id the new primary key
ALTER TABLE users ADD PRIMARY KEY (user_id);

-- Step 5: Add foreign key constraints with UUID
ALTER TABLE auth_tokens
  ADD CONSTRAINT auth_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE saved_moves
  ADD CONSTRAINT saved_moves_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE login_history
  ADD CONSTRAINT login_history_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE collections
  ADD CONSTRAINT collections_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE containers
  ADD CONSTRAINT containers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE items
  ADD CONSTRAINT items_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE locations
  ADD CONSTRAINT locations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE move_projects
  ADD CONSTRAINT move_projects_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE move_sessions
  ADD CONSTRAINT move_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE storage_units
  ADD CONSTRAINT storage_units_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- Step 6: Drop views that depend on owner column
DROP VIEW IF EXISTS containers_with_location;
DROP VIEW IF EXISTS items_with_location;

-- Step 6b: Drop the legacy owner varchar columns
ALTER TABLE collections DROP COLUMN IF EXISTS owner;
ALTER TABLE containers DROP COLUMN IF EXISTS owner;
ALTER TABLE items DROP COLUMN IF EXISTS owner;
ALTER TABLE locations DROP COLUMN IF EXISTS owner;
ALTER TABLE move_projects DROP COLUMN IF EXISTS owner;
ALTER TABLE move_sessions DROP COLUMN IF EXISTS owner;
ALTER TABLE storage_units DROP COLUMN IF EXISTS owner;

-- Step 7: Drop the user_name column from users table
ALTER TABLE users DROP COLUMN IF EXISTS user_name;

-- Step 8: Recreate indexes on user_id columns (may have been affected by column rename)
DROP INDEX IF EXISTS idx_collections_user_id;
DROP INDEX IF EXISTS idx_containers_user_id;
DROP INDEX IF EXISTS idx_items_user_id;
DROP INDEX IF EXISTS idx_locations_user_id;
DROP INDEX IF EXISTS idx_move_projects_user_id;
DROP INDEX IF EXISTS idx_move_sessions_user_id;
DROP INDEX IF EXISTS idx_storage_units_user_id;

CREATE INDEX idx_collections_user_id ON collections(user_id);
CREATE INDEX idx_containers_user_id ON containers(user_id);
CREATE INDEX idx_items_user_id ON items(user_id);
CREATE INDEX idx_locations_user_id ON locations(user_id);
CREATE INDEX idx_move_projects_user_id ON move_projects(user_id);
CREATE INDEX idx_move_sessions_user_id ON move_sessions(user_id);
CREATE INDEX idx_storage_units_user_id ON storage_units(user_id);

-- Step 9: Recreate views with user_id instead of owner
CREATE VIEW containers_with_location AS
  SELECT cont.id,
    cont.user_id,
    cont.name,
    cont.collection_id,
    cont.description,
    cont.box_number,
    cont.box_type,
    cont.sealed,
    cont.sealed_at,
    cont.weight_lbs,
    cont.fragile_contents,
    cont.created_at,
    cont.updated_at,
    cont.qr_code,
    cont.color_code,
    cont.max_weight_lbs,
    cont.max_volume_cuft,
    cont.box_size,
    c.location_id,
    l.name AS location_name
  FROM containers cont
    JOIN collections c ON cont.collection_id = c.id
    JOIN locations l ON c.location_id = l.id;

CREATE VIEW items_with_location AS
  SELECT i.id,
    i.user_id,
    i.name,
    i.collection_id,
    i.description,
    i.container_id,
    i.quantity,
    i.estimated_value,
    i.fragile,
    i.priority,
    i.weight_lbs,
    i.dimensions,
    i.created_at,
    i.updated_at,
    i.picture_url,
    i.notes,
    i.material,
    i.primary_color,
    i.tags,
    i.length_in,
    i.width_in,
    i.height_in,
    c.location_id,
    l.name AS location_name
  FROM items i
    JOIN collections c ON i.collection_id = c.id
    JOIN locations l ON c.location_id = l.id;

COMMIT;
