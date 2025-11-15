-- Add individual dimension fields to items table
-- These complement the existing 'dimensions' text field with structured numeric fields

ALTER TABLE items
ADD COLUMN IF NOT EXISTS length_in NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS width_in NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS height_in NUMERIC(10, 2);

-- Add comments to document the fields
COMMENT ON COLUMN items.length_in IS 'Item length in inches';
COMMENT ON COLUMN items.width_in IS 'Item width in inches';
COMMENT ON COLUMN items.height_in IS 'Item height in inches';
