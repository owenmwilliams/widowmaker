-- 033_add_home_profile_to_locations.sql
--
-- Adds home-profile fields to locations so a captured inventory can be
-- benchmarked against what's typical for a home of that size (the reasonableness
-- check that runs before sharing with movers — e.g. flag a 3-bed home totaling
-- 92 lbs). All columns are nullable and additive; safe on the live schema.

ALTER TABLE locations ADD COLUMN IF NOT EXISTS bedrooms SMALLINT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS bathrooms NUMERIC(3, 1);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS home_type VARCHAR(50);
