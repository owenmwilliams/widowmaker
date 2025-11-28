var express = require('express');
var router = express.Router();
var bodyParser = require('body-parser');
const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.MT_DATALAYER_HOSTNAME,
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE,
  },
});

const jsonParser = bodyParser.json({ limit: '5mb' });

const parseNumber = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/[^0-9.\-]/g, '');
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
};

router.post('/inventory', jsonParser, async function (req, res) {
  try {
    const user = req.user;
    const userId = user?.user_id || user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { location_id, items } = req.body || {};
    if (!location_id) {
      return res.status(400).json({ success: false, error: 'location_id is required' });
    }
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, error: 'No rows to import' });
    }

    const location = await knex('locations')
      .where({ id: location_id, user_id: userId })
      .first();
    if (!location) {
      return res.status(404).json({ success: false, error: 'Location not found' });
    }

    const trx = await knex.transaction();
    try {
      const existingCollections = await trx('collections')
        .where({ user_id: userId, location_id });

      const collectionMap = new Map();
      existingCollections.forEach((c) => {
        if (!c || !c.name) return;
        collectionMap.set(c.name.trim().toLowerCase(), c.id);
      });

      const collectionIdSet = existingCollections.map((c) => c.id);
      let existingContainers = [];
      if (collectionIdSet.length) {
        existingContainers = await trx('containers')
          .where({ user_id: userId })
          .whereIn('collection_id', collectionIdSet);
      }

      const containerMap = new Map();
      existingContainers.forEach((container) => {
        if (!container || !container.name) return;
        const key = `${container.collection_id}::${container.name.trim().toLowerCase()}`;
        containerMap.set(key, container.id);
      });

      let createdCollections = 0;
      let createdContainers = 0;
      let createdItems = 0;
      const rowResults = [];

      for (const row of items) {
        const rowNumber = row?.rowNumber ?? null;
        const name = (row?.name || '').trim();
        const roomLabel = (row?.room || '').trim();

        if (!name || !roomLabel) {
          rowResults.push({
            row: rowNumber,
            status: 'skipped',
            reason: 'Missing name or room',
          });
          continue;
        }

        const normalizedRoom = roomLabel.toLowerCase();
        let collectionId = collectionMap.get(normalizedRoom);
        if (!collectionId) {
          const inserted = await trx('collections')
            .insert({
              user_id: userId,
              location_id,
              name: roomLabel,
              description: null,
            })
            .returning('id');
          collectionId = inserted?.[0]?.id || inserted?.[0];
          collectionMap.set(normalizedRoom, collectionId);
          createdCollections += 1;
        }

        let containerId = null;
        const containerName = (row?.container || '').trim();
        if (containerName) {
          const normalizedContainer = containerName.toLowerCase();
          const containerKey = `${collectionId}::${normalizedContainer}`;
          containerId = containerMap.get(containerKey);
          if (!containerId) {
            const insertedContainer = await trx('containers')
              .insert({
                user_id: userId,
                collection_id: collectionId,
                name: containerName,
                description: row?.container_description || null,
              })
              .returning('id');
            containerId =
              insertedContainer?.[0]?.id || insertedContainer?.[0];
            containerMap.set(containerKey, containerId);
            createdContainers += 1;
          }
        }

        const quantity = parseInt(row?.quantity, 10);
        const payload = {
          user_id: userId,
          collection_id: collectionId,
          container_id: containerId,
          name,
          description: row?.description || null,
          notes: row?.notes || null,
          material: row?.material || null,
          primary_color: row?.primary_color || null,
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
          weight_lbs: parseNumber(row?.weight_lbs ?? row?.weight),
          length_in: parseNumber(row?.length_in ?? row?.length),
          width_in: parseNumber(row?.width_in ?? row?.width),
          height_in: parseNumber(row?.height_in ?? row?.height),
        };

        const insertedItem = await trx('items')
          .insert(payload)
          .returning(['id', 'name']);
        createdItems += 1;

        rowResults.push({
          row: rowNumber,
          status: 'imported',
          item_id: insertedItem?.[0]?.id || insertedItem?.[0],
        });
      }

      await trx.commit();

      return res.json({
        success: true,
        summary: {
          created_items: createdItems,
          created_collections: createdCollections,
          created_containers: createdContainers,
          total_rows: items.length,
        },
        rows: rowResults,
      });
    } catch (error) {
      await trx.rollback();
      console.error('Inventory import failed:', error);
      return res
        .status(500)
        .json({ success: false, error: 'Failed to import inventory' });
    }
  } catch (error) {
    console.error('Inventory import error:', error);
    return res
      .status(500)
      .json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
