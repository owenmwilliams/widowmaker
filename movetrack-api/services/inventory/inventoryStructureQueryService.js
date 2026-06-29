'use strict';

/**
 * inventoryStructureQueryService.js
 *
 * Hierarchical structure reads: locations, collections, containers.
 * Returns the shape of the inventory tree, not the items inside it.
 */

const knex = require('../infra/knex');

// Location queries have moved to workflow/locationQueryService.
// Re-exported below for backwards compatibility.
const { getAllLocations, getSingleLocation } = require('../workflow/locationQueryService');

// ── Collections ───────────────────────────────────────────────────────────────

async function getCollectionsByLocation(userId, locationId) {
  return knex
    .select({
      id: 'collections.id',
      name: 'collections.name',
      description: 'collections.description',
      location_id: 'locations.id',
    })
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
    .andWhere(knex.raw('locations.id = ?', locationId))
    .groupBy('collections.id', 'collections.name', 'collections.description', 'locations.id');
}

async function getSingleCollection(userId, collectionId) {
  return knex
    .select({
      id: 'collections.id',
      name: 'collections.name',
      description: 'collections.description',
      location_id: 'locations.id',
    })
    .from('locations')
    .leftJoin('permissions', function () {
      this.on('permissions.resource_id', '=', 'locations.id')
          .andOn('permissions.resource_type', '=', knex.raw('?', ['location']));
    })
    .leftJoin('collections', 'collections.location_id', 'locations.id')
    .where(knex.raw('permissions.user_id = ?', userId))
    .andWhere(knex.raw('collections.id = ?', collectionId));
}

async function getAllCollections(userId, { limit, offset } = {}) {
  let query = knex
    .select({
      id: 'collections.id',
      name: 'collections.name',
      description: 'collections.description',
      location_id: 'locations.id',
      location_name: 'locations.name',
    })
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
    .whereNotNull('collections.id')
    .andWhere(knex.raw('permissions.user_id = ?', userId))
    .groupBy('locations.id', 'locations.name', 'collections.id', 'collections.name', 'collections.description')
    .orderBy('collections.id');

  if (Number.isFinite(limit)) query = query.limit(limit);
  if (Number.isFinite(offset) && offset > 0) query = query.offset(offset);
  return query;
}

async function getAllCollectionsGrouped(userId, { limit, offset } = {}) {
  let query = knex.with(
    'ONE',
    knex.raw(
      `SELECT
        locations.id AS location_id,
        locations.name AS location_name,
        JSON_BUILD_OBJECT(
            'id', collections.id,
            'name', collections.name) AS collections_json
      FROM locations
          LEFT JOIN permissions ON permissions.resource_id = locations.id AND permissions.resource_type = 'location'
          LEFT JOIN collections ON collections.location_id = locations.id
      WHERE permissions.user_id = ?
          AND collections.id IS NOT NULL`,
      userId
    )
  )
  .select('location_id', 'location_name',
    knex.raw('JSON_AGG(collections_json) AS collections'))
  .from('ONE')
  .groupBy('location_id', 'location_name')
  .orderBy('location_id');

  if (Number.isFinite(limit)) query = query.limit(limit);
  if (Number.isFinite(offset) && offset > 0) query = query.offset(offset);
  return query;
}

// ── Containers ────────────────────────────────────────────────────────────────

async function getContainersByCollection(userId, locationId, collectionId) {
  return knex.with(
    'distinct_items',
    knex.raw(
      `SELECT DISTINCT
        containers.id,
        containers.name AS container_name,
        containers.description AS container_description,
        collections.id AS collection_id,
        locations.id AS location_id,
        items.id AS item_id,
        items.quantity AS item_quantity
      FROM locations
        LEFT JOIN permissions ON permissions.resource_id = locations.id AND permissions.resource_type = 'location'
        LEFT JOIN collections ON collections.location_id = locations.id
        LEFT JOIN containers ON containers.collection_id = collections.id
        LEFT JOIN items ON items.container_id = containers.id
      WHERE permissions.user_id = :username
        AND locations.id = :locationid
        AND collections.id = :collectionid`,
      { username: userId, locationid: locationId, collectionid: collectionId }
    )
  )
  .select('id', 'container_name', 'container_description', 'location_id', 'collection_id')
  .countDistinct('item_id', { as: 'total_items' })
  .sum('item_quantity', { as: 'total_count_items' })
  .from('distinct_items')
  .groupBy('id', 'container_name', 'container_description', 'location_id', 'collection_id');
}

async function getSingleContainer(userId, containerId) {
  return knex
    .select({
      id: 'containers.id',
      name: 'containers.name',
      description: 'containers.description',
      qr_code: 'containers.qr_code',
      qr_assigned_at: 'containers.qr_assigned_at',
      collection_id: 'collections.id',
      location_id: 'locations.id',
      max_weight_lbs: 'containers.max_weight_lbs',
      max_volume_cuft: 'containers.max_volume_cuft',
      box_size: 'containers.box_size',
      inner_length_in: 'containers.inner_length_in',
      inner_width_in: 'containers.inner_width_in',
      inner_height_in: 'containers.inner_height_in',
    })
    .from('locations')
    .leftJoin('permissions', function () {
      this.on('permissions.resource_id', '=', 'locations.id')
          .andOn('permissions.resource_type', '=', knex.raw('?', ['location']));
    })
    .leftJoin('collections', 'collections.location_id', 'locations.id')
    .leftJoin('containers', 'containers.collection_id', 'collections.id')
    .where(knex.raw('permissions.user_id = ?', userId))
    .andWhere(knex.raw('containers.id = ?', containerId));
}

async function getAllContainers(userId) {
  return knex.with(
    'distinct_items',
    knex.raw(
      `SELECT DISTINCT
        locations.id AS location_id,
        locations.name AS location_name,
        collections.id AS collection_id,
        collections.name AS collection_name,
        containers.id,
        containers.name AS container_name,
        containers.description AS container_description,
        items.id AS item_id,
        items.quantity AS item_quantity
      FROM locations
        LEFT JOIN permissions ON permissions.resource_id = locations.id AND permissions.resource_type = 'location'
        LEFT JOIN collections ON collections.location_id = locations.id
        LEFT JOIN containers ON containers.collection_id = collections.id
        LEFT JOIN items ON items.container_id = containers.id
      WHERE permissions.user_id = ?`,
      userId
    )
  )
  .select('location_id', 'location_name', 'collection_id', 'collection_name', 'id', 'container_name', 'container_description')
  .countDistinct('item_id', { as: 'total_items' })
  .sum('item_quantity', { as: 'total_count_items' })
  .from('distinct_items')
  .whereNotNull('id')
  .groupBy('location_id', 'location_name', 'collection_id', 'collection_name', 'id', 'container_name', 'container_description');
}

async function getAllContainersGrouped(userId) {
  return knex.raw(`
    WITH TWO AS (
      WITH ONE AS (
      SELECT
          locations.id AS location_id,
          locations.name AS location_name,
          collections.id AS collection_id,
          collections.name AS collection_name,
          JSON_BUILD_OBJECT(
              'id', containers.id,
              'name', containers.name) AS containers_json
      FROM locations
          LEFT JOIN permissions ON permissions.resource_id = locations.id AND permissions.resource_type = 'location'
          LEFT JOIN collections ON collections.location_id = locations.id
          LEFT JOIN containers ON containers.collection_id = collections.id
      WHERE permissions.user_id = ?
          AND containers.id IS NOT NULL
      )
      SELECT
          location_id,
          location_name,
          collection_id,
          collection_name,
          JSON_AGG(containers_json) AS containers
      FROM ONE
      GROUP BY 1, 2, 3, 4
  )

  SELECT
      location_id,
      location_name,
      JSON_AGG(collections_json) AS collections
  FROM(
      SELECT
          location_id,
          location_name,
          JSON_BUILD_OBJECT(
              'id', collection_id,
              'name', collection_name,
              'containers', containers
          ) AS collections_json
      FROM TWO
  ) AS TWO_FROM
  GROUP BY 1, 2
  `, userId);
}

module.exports = {
  getAllLocations,
  getSingleLocation,
  getCollectionsByLocation,
  getSingleCollection,
  getAllCollections,
  getAllCollectionsGrouped,
  getContainersByCollection,
  getSingleContainer,
  getAllContainers,
  getAllContainersGrouped,
};
