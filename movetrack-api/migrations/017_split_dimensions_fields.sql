BEGIN;

-- Ensure numeric dimension columns exist on items
ALTER TABLE items
    ADD COLUMN IF NOT EXISTS length_in NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS width_in NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS height_in NUMERIC(10, 2);

-- Ensure containers can store internal dimensions
ALTER TABLE containers
    ADD COLUMN IF NOT EXISTS inner_length_in NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS inner_width_in NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS inner_height_in NUMERIC(10, 2);

-- Backfill numeric dimensions from the legacy text column if it still exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'items'
          AND column_name = 'dimensions'
    ) THEN
        WITH parsed AS (
            SELECT
                id,
                regexp_matches(
                    regexp_replace(lower(dimensions), '[^0-9\\.x×]', '', 'g'),
                    '([0-9\\.]+)[x×]([0-9\\.]+)[x×]([0-9\\.]+)'
                ) AS dims
            FROM items
            WHERE dimensions IS NOT NULL
              AND btrim(dimensions) <> ''
        )
        UPDATE items
        SET
            length_in = COALESCE(length_in, (parsed.dims)[1]::NUMERIC),
            width_in  = COALESCE(width_in,  (parsed.dims)[2]::NUMERIC),
            height_in = COALESCE(height_in, (parsed.dims)[3]::NUMERIC)
        FROM parsed
        WHERE parsed.id = items.id
          AND parsed.dims IS NOT NULL;

        ALTER TABLE items DROP COLUMN IF EXISTS dimensions;
    END IF;
END$$;

COMMENT ON COLUMN items.length_in IS 'Item length in inches';
COMMENT ON COLUMN items.width_in  IS 'Item width in inches';
COMMENT ON COLUMN items.height_in IS 'Item height in inches';

COMMENT ON COLUMN containers.inner_length_in IS 'Usable inner length in inches';
COMMENT ON COLUMN containers.inner_width_in  IS 'Usable inner width in inches';
COMMENT ON COLUMN containers.inner_height_in IS 'Usable inner height in inches';

COMMIT;
