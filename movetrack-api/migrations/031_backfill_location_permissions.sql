-- Migration 031: Backfill missing 'location' owner permissions.
--
-- The HTTP createLocation() flow (routes/api/inventory/locations.js ->
-- locationMutationService.createLocation) historically inserted the location row
-- but NOT the matching permissions row. Every location read path
-- (getAllLocations / getSingleLocation / the inventory snapshot) filters locations
-- through the permissions table, so any location added via the frontend
-- "Add Location" flow was invisible to its own owner.
--
-- The code is fixed to write the permission on create; this repairs locations that
-- were already orphaned. Idempotent via NOT EXISTS — safe to re-run, no-op once
-- every location has its owner permission.

INSERT INTO permissions (user_id, resource_id, resource_type, permission_level, granted_by)
SELECT l.user_id, l.id, 'location', 'owner', l.user_id
  FROM locations l
 WHERE l.user_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM permissions p
      WHERE p.resource_id = l.id
        AND p.resource_type = 'location'
        AND p.user_id = l.user_id
   );
