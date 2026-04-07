'use strict';

/**
 * locationQueryService.js
 *
 * Read-only location queries: list, single, primary lookup, count.
 * Extracted from inventoryStructureQueryService + inventoryMutationService.
 */

const knex = require('../infra/knex');
const conn = require('../infra/db');
const db = conn.db;

/**
 * Get all locations for a user with aggregate counts of rooms, containers, and items.
 */
async function getAllLocations(userId) {
  return knex
    .select(
      'locations.id',
      'locations.name',
      'locations.description',
      'locations.address',
      'locations.address_2',
      'locations.city',
      'locations.state',
      'locations.zip',
      'locations.country',
      'locations.location_type',
      'locations.lat',
      'locations.lng'
    )
    .countDistinct('collections.id', { as: 'total_rooms' })
    .countDistinct('containers.id', { as: 'total_containers' })
    .countDistinct('items.id', { as: 'total_items' })
    .from('locations')
    .leftJoin('permissions', function () {
      this.on('permissions.resource_id', '=', 'locations.id')
          .andOn('permissions.resource_type', '=', knex.raw('?', ['location']));
    })
    .leftJoin('collections', 'collections.location_id', 'locations.id')
    .leftJoin('containers', 'containers.collection_id', 'collections.id')
    .leftJoin('items', 'items.container_id', 'containers.id')
    .where(knex.raw('permissions.user_id = ?', userId))
    .groupBy(
      'locations.id', 'locations.name', 'locations.description',
      'locations.address', 'locations.address_2', 'locations.city',
      'locations.state', 'locations.zip', 'locations.country',
      'locations.location_type', 'locations.lat', 'locations.lng'
    );
}

/**
 * Get a single location by ID (must be owned/permitted by userId).
 */
async function getSingleLocation(userId, locationId) {
  return knex
    .select({
      id: 'locations.id',
      name: 'locations.name',
      description: 'locations.description',
      address: 'locations.address',
      address_2: 'locations.address_2',
      city: 'locations.city',
      state: 'locations.state',
      zip: 'locations.zip',
      location_type: 'locations.location_type',
      country: 'locations.country',
      lat: 'locations.lat',
      lng: 'locations.lng',
    })
    .from('locations')
    .leftJoin('permissions', function () {
      this.on('permissions.resource_id', '=', 'locations.id')
          .andOn('permissions.resource_type', '=', knex.raw('?', ['location']));
    })
    .where(knex.raw('permissions.user_id = ?', userId))
    .andWhere(knex.raw('locations.id = ?', locationId));
}

/**
 * Get the user's primary location_id. Returns null if none exists.
 */
async function getPrimaryLocationId(userId) {
  const loc = await db.oneOrNone(
    `SELECT id FROM locations WHERE user_id = $1
     ORDER BY location_type = 'primary_residence' DESC, created_at ASC LIMIT 1`,
    [userId]
  );
  return loc ? loc.id : null;
}

/**
 * Return current location count for a user (used by plan-cap middleware).
 */
async function getLocationCount(userId) {
  const [row] = await knex('locations').count('* as cnt').where('user_id', userId);
  return Number(row?.cnt || 0);
}

module.exports = {
  getAllLocations,
  getSingleLocation,
  getPrimaryLocationId,
  getLocationCount,
};
