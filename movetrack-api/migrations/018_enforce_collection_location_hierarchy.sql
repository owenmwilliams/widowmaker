-- Migration 018: Enforce strict collection-location hierarchy
-- This migration establishes the rule that:
-- 1. Every collection MUST have a location_id (represents where items are physically stored)
-- 2. Every container MUST have a collection_id
-- 3. Every item MUST have a collection_id
-- 4. Containers and items inherit their location from their collection (no separate location_id)

BEGIN;

-- ============================================================================
-- STEP 1: Add location_id to collections
-- ============================================================================

-- Add the location_id column to collections if it doesn't exist
ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS location_id BIGINT;

-- Add foreign key constraint
ALTER TABLE collections
  DROP CONSTRAINT IF EXISTS collections_location_id_fkey;

ALTER TABLE collections
  ADD CONSTRAINT collections_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_collections_location
  ON collections(location_id);

-- ============================================================================
-- STEP 2: Populate location_id for existing collections (if any)
-- ============================================================================

-- For existing collections without a location_id, try to infer from their containers
UPDATE collections c
SET location_id = (
  SELECT cont.location_id
  FROM containers cont
  WHERE cont.collection_id = c.id
    AND cont.location_id IS NOT NULL
  LIMIT 1
)
WHERE c.location_id IS NULL
  AND EXISTS (
    SELECT 1 FROM containers cont
    WHERE cont.collection_id = c.id AND cont.location_id IS NOT NULL
  );

-- For collections still without a location, try to infer from items
UPDATE collections c
SET location_id = (
  SELECT i.location_id
  FROM items i
  WHERE i.collection_id = c.id
    AND i.location_id IS NOT NULL
  LIMIT 1
)
WHERE c.location_id IS NULL
  AND EXISTS (
    SELECT 1 FROM items i
    WHERE i.collection_id = c.id AND i.location_id IS NOT NULL
  );

-- For any remaining collections, create a default location per user
DO $$
DECLARE
  user_rec RECORD;
  default_loc_id BIGINT;
BEGIN
  FOR user_rec IN
    SELECT DISTINCT owner_id
    FROM collections
    WHERE location_id IS NULL
  LOOP
    -- Try to find an existing primary location for this user
    SELECT id INTO default_loc_id
    FROM locations
    WHERE owner_id = user_rec.owner_id
    ORDER BY
      CASE
        WHEN location_type = 'primary_residence' THEN 1
        WHEN location_type = 'residence' THEN 2
        ELSE 3
      END,
      created_at ASC
    LIMIT 1;

    -- If no location exists, create one
    IF default_loc_id IS NULL THEN
      INSERT INTO locations (owner_id, name, location_type, description, created_at, updated_at)
      VALUES (user_rec.owner_id, 'Primary Location', 'primary_residence', 'Auto-created default location', NOW(), NOW())
      RETURNING id INTO default_loc_id;
    END IF;

    -- Assign this location to all collections for this user that don't have one
    UPDATE collections
    SET location_id = default_loc_id
    WHERE owner_id = user_rec.owner_id
      AND location_id IS NULL;
  END LOOP;
END $$;

-- Now make location_id NOT NULL
ALTER TABLE collections
  ALTER COLUMN location_id SET NOT NULL;

-- ============================================================================
-- STEP 3: Ensure all containers have collection_id
-- ============================================================================

-- Delete orphaned containers (those without a collection_id)
DELETE FROM containers WHERE collection_id IS NULL;

-- Make collection_id NOT NULL on containers
ALTER TABLE containers
  ALTER COLUMN collection_id SET NOT NULL;

-- Update containers to remove ON DELETE SET NULL (should be CASCADE or RESTRICT)
ALTER TABLE containers
  DROP CONSTRAINT IF EXISTS containers_collection_id_fkey;

ALTER TABLE containers
  ADD CONSTRAINT containers_collection_id_fkey
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE;

-- ============================================================================
-- STEP 4: Ensure all items have collection_id
-- ============================================================================

-- Delete orphaned items (those without a collection_id)
DELETE FROM items WHERE collection_id IS NULL;

-- Make collection_id NOT NULL on items
ALTER TABLE items
  ALTER COLUMN collection_id SET NOT NULL;

-- Update items to remove ON DELETE SET NULL (should be CASCADE or RESTRICT)
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_collection_id_fkey;

ALTER TABLE items
  ADD CONSTRAINT items_collection_id_fkey
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE;

-- ============================================================================
-- STEP 5: Remove redundant location_id from containers and items
-- ============================================================================
-- NOTE: Location is now derived from collection.location_id
-- The containers.location_id and items.location_id columns are redundant

-- Drop the location_id columns from containers
ALTER TABLE containers
  DROP CONSTRAINT IF EXISTS containers_location_id_fkey;

DROP INDEX IF EXISTS idx_containers_location;

ALTER TABLE containers
  DROP COLUMN IF EXISTS location_id;

-- Drop the location_id columns from items
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_location_id_fkey;

DROP INDEX IF EXISTS idx_items_location;

ALTER TABLE items
  DROP COLUMN IF EXISTS location_id;

-- ============================================================================
-- STEP 6: Add constraint to ensure items in containers share same collection
-- ============================================================================

-- Create a function to validate that item and container share the same collection
CREATE OR REPLACE FUNCTION check_item_container_collection()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.container_id IS NOT NULL THEN
    -- Check that the container's collection matches the item's collection
    IF NOT EXISTS (
      SELECT 1
      FROM containers c
      WHERE c.id = NEW.container_id
        AND c.collection_id = NEW.collection_id
    ) THEN
      RAISE EXCEPTION 'Item and container must belong to the same collection';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on items table
DROP TRIGGER IF EXISTS trigger_check_item_container_collection ON items;

CREATE TRIGGER trigger_check_item_container_collection
  BEFORE INSERT OR UPDATE OF container_id, collection_id ON items
  FOR EACH ROW
  EXECUTE FUNCTION check_item_container_collection();

-- ============================================================================
-- STEP 7: Update views to use collection.location_id
-- ============================================================================

-- Drop and recreate containers_with_location view
DROP VIEW IF EXISTS containers_with_location;

CREATE VIEW containers_with_location AS
  SELECT cont.id,
    cont.owner_id,
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
    c.location_id,
    l.name AS location_name
  FROM containers cont
    JOIN collections c ON cont.collection_id = c.id
    JOIN locations l ON c.location_id = l.id;

-- Drop and recreate items_with_location view
DROP VIEW IF EXISTS items_with_location;

CREATE VIEW items_with_location AS
  SELECT i.id,
    i.owner_id,
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
    c.location_id,
    l.name AS location_name
  FROM items i
    JOIN collections c ON i.collection_id = c.id
    JOIN locations l ON c.location_id = l.id;

COMMIT;
