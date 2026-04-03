'use strict';

/**
 * Inventory Query Service
 *
 * Read-only inventory queries: search, item photos, aggregate totals.
 * Used by both Census and Vector agents.
 */

const knex = require('../infra/knex');
const { signItemUrls } = require('../infra/gcsService');

const QR_BASE_URL = (process.env.APP_BASE_URL || 'https://reloprep.com').replace(/\/$/, '');

function buildQrUrl(type, token) {
  if (!token) return null;
  return `${QR_BASE_URL}/qr/${type}/${token}`;
}

/**
 * Search items with dynamic filters.
 */
async function searchItems(userId, args) {
  const allowedMissing = [
    'weight_lbs', 'length_in', 'width_in', 'height_in',
    'description', 'picture_url', 'material', 'primary_color', 'estimated_value',
  ];

  let query = knex('items')
    .select(
      'items.id', 'items.name', 'items.description', 'items.quantity',
      'items.weight_lbs', 'items.length_in', 'items.width_in', 'items.height_in',
      'items.fragile', 'items.material', 'items.primary_color',
      'items.estimated_value', 'items.picture_url',
      'collections.name as room_name'
    )
    .leftJoin('collections', 'items.collection_id', 'collections.id')
    .where('items.user_id', userId);

  if (args.room_name) {
    query = query.whereRaw('LOWER(collections.name) = ?', [args.room_name.toLowerCase()]);
  }
  if (args.search) {
    query = query.whereRaw('LOWER(items.name) LIKE ?', [`%${args.search.toLowerCase()}%`]);
  }
  if (args.missing_field && allowedMissing.includes(args.missing_field)) {
    query = query.whereNull(`items.${args.missing_field}`);
  }
  if (args.fragile !== undefined) {
    query = query.where('items.fragile', args.fragile);
  }

  const limit = Math.min(args.limit || 50, 100);
  const items = await query.orderBy('items.name').limit(limit);

  return { success: true, items, count: items.length };
}

/**
 * Get an item's photo by id or name.
 */
async function getItemPhoto(userId, args) {
  let item;
  if (args.item_id) {
    item = await knex('items')
      .select('id', 'name', 'picture_url')
      .where({ id: args.item_id, user_id: userId })
      .first();
  } else if (args.item_name) {
    item = await knex('items')
      .select('id', 'name', 'picture_url')
      .where({ user_id: userId })
      .whereRaw('LOWER(name) LIKE ?', [`%${args.item_name.toLowerCase()}%`])
      .first();
  }

  if (!item) {
    return { success: false, error: 'Item not found' };
  }
  if (!item.picture_url) {
    return { success: true, hasPhoto: false, name: item.name, message: 'No photo available for this item.' };
  }
  return { success: true, hasPhoto: true, name: item.name, picture_url: item.picture_url };
}

/**
 * Get aggregate inventory totals (weight, volume, missing counts).
 * Used by both Census and Vector agents.
 */
async function getInventoryTotals(userId) {
  const items = await knex('items')
    .select(
      'items.id', 'items.name', 'items.quantity',
      'items.weight_lbs', 'items.length_in', 'items.width_in', 'items.height_in',
      'items.fragile', 'items.description', 'items.material',
      'collections.name as room_name'
    )
    .leftJoin('collections', 'items.collection_id', 'collections.id')
    .where('items.user_id', userId);

  let totalWeight = 0;
  let totalVolumeCuFt = 0;
  let totalItems = 0;
  let missingWeight = 0;
  let missingDimensions = 0;

  for (const item of items) {
    const qty = item.quantity || 1;
    totalItems += qty;

    if (item.weight_lbs) {
      totalWeight += item.weight_lbs * qty;
    } else {
      missingWeight += qty;
    }

    if (item.length_in && item.width_in && item.height_in) {
      const vol = (item.length_in * item.width_in * item.height_in) / 1728;
      totalVolumeCuFt += vol * qty;
    } else {
      missingDimensions += qty;
    }
  }

  return {
    items,
    totalItems,
    totalWeight: Math.round(totalWeight),
    totalVolumeCuFt: Math.round(totalVolumeCuFt * 100) / 100,
    missingWeight,
    missingDimensions,
  };
}

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

async function getAllCollections(userId) {
  return knex
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
    .groupBy('locations.id', 'locations.name', 'collections.id', 'collections.name', 'collections.description');
}

async function getAllCollectionsGrouped(userId) {
  return knex.with(
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
  .groupBy('location_id', 'location_name');
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

// ── Locations ─────────────────────────────────────────────────────────────────

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

// ── Items ─────────────────────────────────────────────────────────────────────

/**
 * Get items belonging to a specific container (filtered by location + collection + container).
 */
async function getItemsByContainer(userId, { locationId, collectionId, containerId }) {
  return knex
    .select({
      id: 'items.id',
      name: 'items.name',
      description: 'items.description',
      quantity: 'items.quantity',
      picture_url: 'items.picture_url',
      qr_code: 'items.qr_code',
      container_id: 'containers.id',
      collection_id: 'collections.id',
      location_id: 'locations.id',
    })
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
    .andWhere(knex.raw('collections.id = ?', collectionId))
    .andWhere(knex.raw('containers.id = ?', containerId));
}

/**
 * Get a single item with full location/collection/container context.
 */
async function getSingleItem(userId, itemId) {
  return knex
    .select({
      location_id: 'locations.id',
      location_name: 'locations.name',
      collection_id: 'collections.id',
      collection_name: 'collections.name',
      container_id: 'containers.id',
      container_name: 'containers.name',
      id: 'items.id',
      name: 'items.name',
      description: 'items.description',
      quantity: 'items.quantity',
      picture_url: 'items.picture_url',
      estimated_value: 'items.estimated_value',
      fragile: 'items.fragile',
      priority: 'items.priority',
      weight_lbs: 'items.weight_lbs',
      qr_code: 'items.qr_code',
      qr_assigned_at: 'items.qr_assigned_at',
      dimensions: knex.raw(`
        CASE
          WHEN items.length_in IS NOT NULL AND items.width_in IS NOT NULL AND items.height_in IS NOT NULL
            THEN CONCAT(items.length_in, '" × ', items.width_in, '" × ', items.height_in, '"')
          ELSE NULL
        END
      `),
      length_in: 'items.length_in',
      width_in: 'items.width_in',
      height_in: 'items.height_in',
      notes: 'items.notes',
      material: 'items.material',
      primary_color: 'items.primary_color',
      tags: 'items.tags',
    })
    .from('items')
    .leftJoin('permissions', function () {
      this.on('permissions.resource_id', '=', 'items.id')
          .andOn('permissions.resource_type', '=', knex.raw('?', ['item']));
    })
    .leftJoin('collections', 'collections.id', 'items.collection_id')
    .leftJoin('containers', 'containers.id', 'items.container_id')
    .leftJoin('locations', 'locations.id', 'collections.location_id')
    .where(knex.raw('permissions.user_id = ?', userId))
    .andWhere(knex.raw('items.id = ?', itemId));
}

/**
 * Get all items for a user across all locations, with hierarchy context.
 */
async function getAllItems(userId) {
  return knex('locations')
    .distinct({
      location_id: 'locations.id',
      location_name: 'locations.name',
      collection_id: 'collections.id',
      collection_name: 'collections.name',
      container_id: 'containers.id',
      container_name: 'containers.name',
      id: 'items.id',
      name: 'items.name',
      description: 'items.description',
      quantity: 'items.quantity',
      qr_code: 'items.qr_code',
      picture_url: 'items.picture_url',
    })
    .leftJoin('permissions', function () {
      this.on('permissions.resource_id', '=', 'locations.id')
          .andOn('permissions.resource_type', '=', knex.raw('?', ['location']));
    })
    .leftJoin('collections', 'collections.location_id', 'locations.id')
    .leftJoin('containers', 'containers.collection_id', 'collections.id')
    .leftJoin('items', 'items.container_id', 'containers.id')
    .whereNotNull('items.id')
    .andWhere(knex.raw('permissions.user_id = ?', userId));
}

// ── Inventory Snapshot ────────────────────────────────────────────────────────

/**
 * Fetch the full inventory for a user in a single parallel query burst.
 * Returns { locations, collections, containers, items } — the canonical shape
 * for client-side hydration. Items have signed GCS picture_url and qr_url.
 * Containers also have qr_url. Truck-type locations are excluded.
 */
async function getInventorySnapshot(userId) {
  const [locationRows, collectionRows, containerRows, itemRows] = await Promise.all([
    // Locations — permissions join, truck type excluded
    knex('locations')
      .select(
        'locations.id', 'locations.name', 'locations.description',
        'locations.address', 'locations.address_2', 'locations.city',
        'locations.state', 'locations.zip', 'locations.country',
        'locations.location_type', 'locations.lat', 'locations.lng'
      )
      .leftJoin('permissions', function () {
        this.on('permissions.resource_id', '=', 'locations.id')
            .andOn('permissions.resource_type', '=', knex.raw('?', ['location']));
      })
      .where('permissions.user_id', userId)
      .andWhere(function () {
        this.whereNull('locations.location_type').orWhereNot('locations.location_type', 'truck');
      }),

    // Collections — direct ownership + location name
    knex('collections')
      .select('collections.*', 'locations.name as location_name')
      .leftJoin('locations', 'collections.location_id', 'locations.id')
      .where('collections.user_id', userId),

    // Containers — direct ownership + location_id/name via collection
    knex('containers')
      .select('containers.*', 'collections.location_id', 'locations.name as location_name')
      .leftJoin('collections', 'containers.collection_id', 'collections.id')
      .leftJoin('locations', 'collections.location_id', 'locations.id')
      .where('containers.user_id', userId),

    // Items — direct ownership + location_id via collection
    knex('items')
      .select('items.*', 'collections.location_id', 'locations.name as location_name')
      .leftJoin('collections', 'items.collection_id', 'collections.id')
      .leftJoin('locations', 'collections.location_id', 'locations.id')
      .where('items.user_id', userId),
  ]);

  // Derive qr_url for items and containers
  const items = itemRows.map(item => ({ ...item, qr_url: buildQrUrl('item', item.qr_code) }));
  const containers = containerRows.map(c => ({ ...c, qr_url: buildQrUrl('container', c.qr_code) }));

  // Sign GCS picture_url on items (no-op in local dev)
  await signItemUrls(items);

  return { locations: locationRows, collections: collectionRows, containers, items };
}

async function getLooseItems(userId) {
  const result = await knex.raw(`
    SELECT i.id, i.name, i.description, i.weight_lbs, i.fragile
    FROM items i
    WHERE i.user_id = ? AND i.container_id IS NULL
    ORDER BY i.name ASC
  `, [userId]);
  return result.rows;
}

module.exports = {
  searchItems,
  getItemPhoto,
  getInventoryTotals,
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
  getItemsByContainer,
  getSingleItem,
  getAllItems,
  getInventorySnapshot,
  getLooseItems,
};
