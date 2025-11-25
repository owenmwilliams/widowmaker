-- Migration 015: Convert user_id from bigint to UUID
-- This migration converts the users table to use UUID for user_id
-- and prepares for removing username and owner columns

BEGIN;

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Step 1: Add new UUID column to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT uuid_generate_v4() UNIQUE;

-- Step 2: Generate UUIDs for all existing users (if they don't have one)
UPDATE users
SET uuid = uuid_generate_v4()
WHERE uuid IS NULL;

-- Step 3: Make uuid NOT NULL
ALTER TABLE users
  ALTER COLUMN uuid SET NOT NULL;

-- Step 4: Add uuid columns to tables that reference users via FK
ALTER TABLE auth_tokens
  ADD COLUMN IF NOT EXISTS user_uuid UUID;

ALTER TABLE saved_moves
  ADD COLUMN IF NOT EXISTS user_uuid UUID;

ALTER TABLE login_history
  ADD COLUMN IF NOT EXISTS user_uuid UUID;

-- Step 5: Populate uuid columns in dependent tables
UPDATE auth_tokens at
SET user_uuid = u.uuid
FROM users u
WHERE at.user_id = u.user_id;

UPDATE saved_moves sm
SET user_uuid = u.uuid
FROM users u
WHERE sm.user_id = u.user_id;

UPDATE login_history lh
SET user_uuid = u.uuid
FROM users u
WHERE lh.user_id = u.user_id;

-- Step 6: Add uuid columns to tables with 'owner' (varchar email)
-- We'll populate these in the next migration after matching owner to users
ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

ALTER TABLE containers
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

ALTER TABLE move_projects
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

ALTER TABLE move_sessions
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

ALTER TABLE storage_units
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

-- Step 7: Populate user_id by matching owner to users
-- Try matching by email first, then by user_name
UPDATE collections c
SET user_id = u.user_id
FROM users u
WHERE c.owner = u.email OR c.owner = u.user_name;

UPDATE containers c
SET user_id = u.user_id
FROM users u
WHERE c.owner = u.email OR c.owner = u.user_name;

UPDATE items i
SET user_id = u.user_id
FROM users u
WHERE i.owner = u.email OR i.owner = u.user_name;

UPDATE locations l
SET user_id = u.user_id
FROM users u
WHERE l.owner = u.email OR l.owner = u.user_name;

UPDATE move_projects mp
SET user_id = u.user_id
FROM users u
WHERE mp.owner = u.email OR mp.owner = u.user_name;

UPDATE move_sessions ms
SET user_id = u.user_id
FROM users u
WHERE ms.owner = u.email OR ms.owner = u.user_name;

UPDATE storage_units su
SET user_id = u.user_id
FROM users u
WHERE su.owner = u.email OR su.owner = u.user_name;

-- Step 7b: Delete orphaned data (rows where owner doesn't match any user)
DELETE FROM collections WHERE user_id IS NULL;
DELETE FROM containers WHERE user_id IS NULL;
DELETE FROM items WHERE user_id IS NULL;
DELETE FROM locations WHERE user_id IS NULL;
DELETE FROM move_projects WHERE user_id IS NULL;
DELETE FROM move_sessions WHERE user_id IS NULL;
DELETE FROM storage_units WHERE user_id IS NULL;

-- Step 8: Create indexes for performance (before adding constraints)
CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_containers_user_id ON containers(user_id);
CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_locations_user_id ON locations(user_id);
CREATE INDEX IF NOT EXISTS idx_move_projects_user_id ON move_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_user_id ON move_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_storage_units_user_id ON storage_units(user_id);

-- Step 9: Add NOT NULL constraints to user_id columns
-- Only add if all rows have been populated
ALTER TABLE collections
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE containers
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE items
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE locations
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE move_projects
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE move_sessions
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE storage_units
  ALTER COLUMN user_id SET NOT NULL;

COMMIT;
