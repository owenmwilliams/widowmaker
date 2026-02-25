-- Migration 007: Enforce Location Hierarchy
-- This migration implements the following rules:
-- 1. Collections MUST have a location
-- 2. Containers/Items MUST exist in a collection
-- 3. Containers/Items INHERIT location from their collection
-- 4. Moves can only use collections in the starting location

\connect movetrack_db;

BEGIN;

-- Step 1: Add location_id to collections table (nullable for now)
ALTER TABLE collections ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(ID);

-- Step 2: Populate collections.location_id based on existing data
-- For each collection, find the most common location_id from its items and containers
UPDATE collections SET location_id = (
    SELECT location_id FROM (
        -- Get location_id from items in this collection
        SELECT location_id, COUNT(*) as count
        FROM items
        WHERE collection_id = collections.id AND location_id IS NOT NULL
        GROUP BY location_id

        UNION ALL

        -- Get location_id from containers in this collection
        SELECT location_id, COUNT(*) as count
        FROM containers
        WHERE collection_id = collections.id AND location_id IS NOT NULL
        GROUP BY location_id
    ) combined
    GROUP BY location_id
    ORDER BY SUM(count) DESC
    LIMIT 1
)
WHERE collections.location_id IS NULL;

-- Step 3: For collections that still don't have a location, use the first available location
-- or create a default "Unassigned" location if none exist
DO $$
DECLARE
    default_location_id INTEGER;
    owner_id BIGINT;
BEGIN
    -- For each collection without a location
    FOR owner_id IN
        SELECT DISTINCT user_id FROM collections WHERE location_id IS NULL AND user_id IS NOT NULL
    LOOP
        -- Find or create a default location for this owner
        SELECT id INTO default_location_id
        FROM locations
        WHERE user_id = owner_id
        ORDER BY
            CASE WHEN location_type = 'primary_residence' THEN 1
                 WHEN location_type = 'residence' THEN 2
                 ELSE 3
            END,
            created_at ASC
        LIMIT 1;

        -- If no location exists for this owner, create one
        IF default_location_id IS NULL THEN
            INSERT INTO locations (user_id, name, location_type, description, created_at)
            VALUES (owner_id, 'Primary Location', 'primary_residence', 'Default location for unassigned collections', NOW())
            RETURNING id INTO default_location_id;

            RAISE NOTICE 'Created default location % for user_id %', default_location_id, owner_id;
        END IF;

        -- Update collections for this owner
        UPDATE collections
        SET location_id = default_location_id
        WHERE user_id = owner_id AND location_id IS NULL;
    END LOOP;
END $$;

-- Step 4: Make collection_id NOT NULL for items and containers (if not already)
-- First check if there are any orphaned items or containers without a collection
DO $$
DECLARE
    orphaned_items_count INTEGER;
    orphaned_containers_count INTEGER;
    default_collection_id INTEGER;
    owner_id BIGINT;
BEGIN
    -- Check for orphaned items
    SELECT COUNT(*) INTO orphaned_items_count
    FROM items
    WHERE collection_id IS NULL;

    IF orphaned_items_count > 0 THEN
        RAISE NOTICE 'Found % orphaned items without a collection', orphaned_items_count;

        -- For each owner with orphaned items, create or use default collection
        FOR owner_id IN
            SELECT DISTINCT user_id FROM items WHERE collection_id IS NULL AND user_id IS NOT NULL
        LOOP
            -- Find or create a default collection
            SELECT id INTO default_collection_id
            FROM collections
            WHERE user_id = owner_id
            ORDER BY created_at ASC
            LIMIT 1;

            IF default_collection_id IS NULL THEN
                -- Get the default location for this owner
                DECLARE default_loc_id INTEGER;
                BEGIN
                    SELECT id INTO default_loc_id
                    FROM locations
                    WHERE user_id = owner_id
                    LIMIT 1;

                    INSERT INTO collections (user_id, name, description, location_id, created_at)
                    VALUES (owner_id, 'Uncategorized', 'Default collection for unassigned items', default_loc_id, NOW())
                    RETURNING id INTO default_collection_id;
                END;
            END IF;

            -- Assign orphaned items to the default collection
            UPDATE items
            SET collection_id = default_collection_id
            WHERE user_id = owner_id AND collection_id IS NULL;

            RAISE NOTICE 'Assigned orphaned items for user_id % to collection %', owner_id, default_collection_id;
        END LOOP;
    END IF;

    -- Check for orphaned containers
    SELECT COUNT(*) INTO orphaned_containers_count
    FROM containers
    WHERE collection_id IS NULL;

    IF orphaned_containers_count > 0 THEN
        RAISE NOTICE 'Found % orphaned containers without a collection', orphaned_containers_count;

        -- Similar logic for containers
        FOR owner_id IN
            SELECT DISTINCT user_id FROM containers WHERE collection_id IS NULL AND user_id IS NOT NULL
        LOOP
            SELECT id INTO default_collection_id
            FROM collections
            WHERE user_id = owner_id
            ORDER BY created_at ASC
            LIMIT 1;

            UPDATE containers
            SET collection_id = default_collection_id
            WHERE user_id = owner_id AND collection_id IS NULL;

            RAISE NOTICE 'Assigned orphaned containers for user_id % to collection %', owner_id, default_collection_id;
        END LOOP;
    END IF;
END $$;

-- Step 5: Now make the constraints NOT NULL
ALTER TABLE collections ALTER COLUMN location_id SET NOT NULL;
-- collection_id should already be NOT NULL in items and containers from the init schema

-- Step 6: Drop location_id from items table (they now inherit from collection)
-- First, let's verify the data integrity
DO $$
DECLARE
    mismatch_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO mismatch_count
    FROM items i
    JOIN collections c ON i.collection_id = c.id
    WHERE i.location_id IS NOT NULL
    AND i.location_id != c.location_id;

    IF mismatch_count > 0 THEN
        RAISE WARNING 'Found % items with location_id different from their collection''s location_id. These will inherit the collection''s location.', mismatch_count;
    END IF;
END $$;

ALTER TABLE items DROP COLUMN IF EXISTS location_id;

-- Step 7: Drop location_id from containers table
DO $$
DECLARE
    mismatch_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO mismatch_count
    FROM containers c_table
    JOIN collections c ON c_table.collection_id = c.id
    WHERE c_table.location_id IS NOT NULL
    AND c_table.location_id != c.location_id;

    IF mismatch_count > 0 THEN
        RAISE WARNING 'Found % containers with location_id different from their collection''s location_id. These will inherit the collection''s location.', mismatch_count;
    END IF;
END $$;

ALTER TABLE containers DROP COLUMN IF EXISTS location_id;

-- Step 8: Create index on collections.location_id for performance
CREATE INDEX IF NOT EXISTS idx_collections_location ON collections(location_id);

-- Step 9: Add helpful view for items with inherited location
CREATE OR REPLACE VIEW items_with_location AS
SELECT
    i.*,
    c.location_id,
    l.name as location_name
FROM items i
JOIN collections c ON i.collection_id = c.id
JOIN locations l ON c.location_id = l.id;

-- Step 10: Add helpful view for containers with inherited location
CREATE OR REPLACE VIEW containers_with_location AS
SELECT
    cont.*,
    c.location_id,
    l.name as location_name
FROM containers cont
JOIN collections c ON cont.collection_id = c.id
JOIN locations l ON c.location_id = l.id;

COMMIT;

-- Verification queries (informational)
SELECT 'Migration 007 completed successfully!' as status;
SELECT
    'Collections with location: ' || COUNT(*) as info
FROM collections
WHERE location_id IS NOT NULL;

SELECT
    'Items (location now inherited from collection): ' || COUNT(*) as info
FROM items;

SELECT
    'Containers (location now inherited from collection): ' || COUNT(*) as info
FROM containers;
