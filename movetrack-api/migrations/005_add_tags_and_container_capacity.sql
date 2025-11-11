-- Migration 005: Add item tags and container capacity fields
-- Description: Adds characteristic tags to items (material, color, tags array)
--              and adds size/weight capacity fields to containers for packing functionality

-- Add tags and material/color fields to items table
ALTER TABLE items
ADD COLUMN IF NOT EXISTS material VARCHAR(100),
ADD COLUMN IF NOT EXISTS primary_color VARCHAR(50),
ADD COLUMN IF NOT EXISTS tags TEXT[];

-- Add container capacity fields
ALTER TABLE containers
ADD COLUMN IF NOT EXISTS max_weight_lbs DECIMAL(10, 2),
ADD COLUMN IF NOT  EXISTS max_volume_cuft DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS box_size VARCHAR(50); -- 'small', 'medium', 'large', 'extra_large', 'custom'

-- Create index on tags for faster filtering
CREATE INDEX IF NOT EXISTS idx_items_tags ON items USING GIN (tags);

-- Create index on material for filtering
CREATE INDEX IF NOT EXISTS idx_items_material ON items (material);

-- Create index on primary_color for filtering
CREATE INDEX IF NOT EXISTS idx_items_primary_color ON items (primary_color);

COMMENT ON COLUMN items.material IS 'Primary material of the item (e.g., ceramic, metal, glass, wood, plastic, fabric)';
COMMENT ON COLUMN items.primary_color IS 'Primary color of the item';
COMMENT ON COLUMN items.tags IS 'Array of characteristic tags (e.g., Fragile, Glass, Antique, Decorative)';
COMMENT ON COLUMN containers.max_weight_lbs IS 'Maximum weight capacity in pounds';
COMMENT ON COLUMN containers.max_volume_cuft IS 'Maximum volume capacity in cubic feet';
COMMENT ON COLUMN containers.box_size IS 'Standard box size category or custom';
