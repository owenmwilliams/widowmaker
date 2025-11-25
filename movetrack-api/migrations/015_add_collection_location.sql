-- Migration 015: ensure collections always have a location_id
BEGIN;

ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id);

DO $$
DECLARE
  owner_name TEXT;
  default_loc_id INTEGER;
BEGIN
  FOR owner_name IN
    SELECT DISTINCT owner FROM collections WHERE location_id IS NULL
  LOOP
    SELECT id INTO default_loc_id
    FROM locations
    WHERE owner = owner_name
    ORDER BY
      CASE
        WHEN location_type = 'primary_residence' THEN 1
        WHEN location_type = 'residence' THEN 2
        ELSE 3
      END,
      created_at ASC
    LIMIT 1;

    IF default_loc_id IS NULL THEN
      INSERT INTO locations (owner, name, location_type, description, created_at)
      VALUES (owner_name, 'Primary Location', 'primary_residence', 'Auto-created for collections', NOW())
      RETURNING id INTO default_loc_id;
    END IF;

    UPDATE collections
    SET location_id = default_loc_id
    WHERE owner = owner_name AND location_id IS NULL;
  END LOOP;

  ALTER TABLE collections
    ALTER COLUMN location_id SET NOT NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_collections_location
  ON collections(location_id);

COMMIT;
