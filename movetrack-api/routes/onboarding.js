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
    port: process.env.MT_DATALAYER_PORT,
  },
});

const jsonParser = bodyParser.json({ limit: '2mb' });

router.post('/complete', jsonParser, async function (req, res) {
  const userId = req.user?.user_id || req.user?.userId;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { profile = null, location = null, rooms = [] } = req.body || {};

  if (
    !location ||
    !location.name ||
    !location.address ||
    !location.city ||
    !location.state ||
    !location.zip
  ) {
    return res.status(400).json({ success: false, error: 'Location information is incomplete' });
  }

  const normalizedRooms = Array.isArray(rooms)
    ? rooms
        .map((room) => (typeof room === 'string' ? room.trim() : ''))
        .filter((room) => room.length > 0)
    : [];

  try {
    const result = await knex.transaction(async (trx) => {
      if (profile && (profile.first_name || profile.last_name)) {
        await trx('users')
          .update({
            first_name: profile.first_name || null,
            last_name: profile.last_name || null,
            updated_at: trx.fn.now(),
          })
          .where({ user_id: userId });
      }

      let locationId = location.id || null;
      if (locationId) {
        const updated = await trx('locations')
          .update({
            name: location.name,
            address: location.address,
            address_2: location.address2 || null,
            city: location.city,
            state: location.state,
            zip: location.zip,
            updated_at: trx.fn.now(),
          })
          .where({ id: locationId, user_id: userId })
          .returning('id');
        if (!updated || !updated.length) {
          locationId = null;
        } else {
          locationId = updated[0].id || updated[0];
        }
      }

      if (!locationId) {
        const inserted = await trx('locations')
          .insert({
            user_id: userId,
            name: location.name,
            address: location.address,
            address_2: location.address2 || null,
            city: location.city,
            state: location.state,
            zip: location.zip,
            location_type: 'primary_residence',
          })
          .returning('id');
        locationId = inserted?.[0]?.id || inserted?.[0];
      }

      const collections = await trx('collections')
        .where({ user_id: userId, location_id: locationId });
      const collectionMap = new Map();
      collections.forEach((col) => {
        if (!col?.name) return;
        collectionMap.set(col.name.trim().toLowerCase(), col.id);
      });

      const pendingRooms = new Set(normalizedRooms.map((room) => room.toLowerCase()));

      let createdCollections = 0;
      for (const room of pendingRooms) {
        if (!room.length || collectionMap.has(room)) continue;
        const label =
          normalizedRooms.find((r) => r.toLowerCase() === room) || room;
        const insertedCollection = await trx('collections')
          .insert({
            user_id: userId,
            location_id: locationId,
            name: label,
            description: null,
          })
          .returning('id');
        const newId = insertedCollection?.[0]?.id || insertedCollection?.[0];
        collectionMap.set(room, newId);
        createdCollections += 1;
      }

      await trx('users')
        .update({ onboarding_completed: true, updated_at: trx.fn.now() })
        .where({ user_id: userId });

      return {
        location_id: locationId,
        created_collections: createdCollections,
      };
    });

    return res.json({ success: true, summary: result });
  } catch (error) {
    console.error("Failed to complete onboarding:", error);
    return res.status(500).json({ success: false, error: "Failed to finalize onboarding" });
  }
});

module.exports = router;
