var express = require('express');
var router = express.Router();
const { authenticate } = require('../../../services/infra/authService');
const { storage } = require('../../../services/infra/gcsService');
const knex = require('../../../services/infra/knex');

router.use(authenticate);

/* GET current user profile. */
router.get('/', async function(req, res, next) {
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const user = await knex('users')
      .select('user_id', 'first_name', 'last_name', 'user_name')
      .where({ user_id: userId })
      .first();

    if (user) {
      res.send(user);
    } else {
      res.send('nodata');
    }
  } catch (err) {
    return next(err);
  }
});

/* GET any matching usernames. */
router.get('/usercheck', async function(req, res, next) {
  var username = req.query.username

  try {
    await knex('users')
      .countDistinct('user_name')
      .where(
        knex.raw('user_name = ?', username)
      )
    .then(function (data) {
      if (data) {
        res.send(data)
      } else {
        res.send('nodata')
      }
    })
    .catch(function (err) {
      return next(err);
    });
  }
  catch(e) {
    res.send(e)
  }
});

/* POST a new username. */
router.post('/post', express.json(), async function(req, res, next) {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const updatePayload = {
      user_name: req.query.username,
      first_name: req.query.firstname,
      last_name: req.query.lastname,
      email: req.query.email,
      phone: req.query.phone
    };

    Object.keys(updatePayload).forEach((key) => {
      if (updatePayload[key] === undefined) {
        delete updatePayload[key];
      }
    });

    await knex('users')
      .insert({
        user_id: userId,
        ...updatePayload
      })
      .onConflict('user_id')
      .merge(updatePayload);

    res.sendStatus(200);
  } catch (e) {
    return next(e);
  }
});

router.put('/name', express.json(), async function(req, res, next) {
  const { first_name, last_name } = req.body || {};
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!first_name || typeof first_name !== 'string' || !first_name.trim()) {
    return res.status(400).json({ error: 'first_name is required' });
  }

  try {
    const result = await knex('users')
      .update({
        first_name: first_name.trim(),
        last_name: typeof last_name === 'string' ? last_name.trim() : null
      })
      .where({ user_id: userId })
      .returning(['user_id', 'first_name', 'last_name']);

    if (!result || !result.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, user: result[0] });
  } catch (error) {
    console.error('Failed to update user name:', error);
    res.status(500).json({ error: 'Failed to update user name' });
  }
});

router.put('/onboarding', async function(req, res) {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    await knex('users')
      .update({
        onboarding_completed: true,
        updated_at: knex.fn.now()
      })
      .where({ user_id: userId });

    res.json({ success: true, onboarding_completed: true });
  } catch (error) {
    console.error('Failed to update onboarding status:', error);
    res.status(500).json({ success: false, error: 'Failed to update onboarding status' });
  }
});

/**
 * DELETE /users/account
 * Delete user account and ALL associated data (GDPR compliant)
 */
router.delete('/account', async function(req, res) {
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  console.log('========================================');
  console.log('Account Deletion Request (GDPR)');
  console.log('========================================');
  console.log(`User ID: ${userId}`);
  console.log('');

  try {
    // 1. Delete all user images from GCS and database
    console.log('[Account Deletion] Step 1: Deleting all user images...');
    const userImages = await knex('image_uploads')
      .where('user_id', userId);

    console.log(`[Account Deletion] Found ${userImages.length} images to delete`);

    let imageDeleteCount = 0;
    let imageDeleteErrors = 0;

    for (const img of userImages) {
      try {
        const bucket = storage.bucket(img.gcs_bucket);
        const file = bucket.file(img.gcs_path);

        const [exists] = await file.exists();
        if (exists) {
          await file.delete();
          console.log(`[Account Deletion] ✓ Deleted image: ${img.gcs_path}`);
        }

        imageDeleteCount++;
      } catch (error) {
        console.error(`[Account Deletion] ✗ Failed to delete image ${img.gcs_path}:`, error.message);
        imageDeleteErrors++;
      }
    }

    // Delete image tracking records
    await knex('image_uploads')
      .where('user_id', userId)
      .delete();

    console.log(`[Account Deletion] Images deleted: ${imageDeleteCount}, Errors: ${imageDeleteErrors}`);
    console.log('');

    // 2. Delete user data in order (respecting foreign key constraints)
    console.log('[Account Deletion] Step 2: Deleting user data...');

    const itemsDeleted = await knex('items').where('user_id', userId).delete();
    console.log(`[Account Deletion] ✓ Deleted ${itemsDeleted} items`);

    const containersDeleted = await knex('containers').where('user_id', userId).delete();
    console.log(`[Account Deletion] ✓ Deleted ${containersDeleted} containers`);

    const collectionsDeleted = await knex('collections').where('user_id', userId).delete();
    console.log(`[Account Deletion] ✓ Deleted ${collectionsDeleted} collections`);

    const locationsDeleted = await knex('locations').where('user_id', userId).delete();
    console.log(`[Account Deletion] ✓ Deleted ${locationsDeleted} locations`);

    const movesDeleted = await knex('saved_moves').where('user_id', userId).delete();
    console.log(`[Account Deletion] ✓ Deleted ${movesDeleted} saved moves`);

    const sessionsDeleted = await knex('move_sessions').where('user_id', userId).delete();
    console.log(`[Account Deletion] ✓ Deleted ${sessionsDeleted} move sessions`);

    const waypointsDeleted = await knex('move_waypoints').where('user_id', userId).delete();
    console.log(`[Account Deletion] ✓ Deleted ${waypointsDeleted} waypoints`);

    const tokensDeleted = await knex('auth_tokens').where('user_id', userId).delete();
    console.log(`[Account Deletion] ✓ Deleted ${tokensDeleted} auth tokens`);

    console.log('');

    // 3. Delete user account
    console.log('[Account Deletion] Step 3: Deleting user account...');
    await knex('users').where('user_id', userId).delete();
    console.log(`[Account Deletion] ✓ Deleted user account`);

    console.log('');
    console.log('========================================');
    console.log('Account Deletion Summary:');
    console.log(`  User ID: ${userId}`);
    console.log(`  Images deleted: ${imageDeleteCount}`);
    console.log(`  Items deleted: ${itemsDeleted}`);
    console.log(`  Collections deleted: ${collectionsDeleted}`);
    console.log(`  Containers deleted: ${containersDeleted}`);
    console.log(`  Locations deleted: ${locationsDeleted}`);
    console.log(`  Moves deleted: ${movesDeleted}`);
    console.log(`  Sessions deleted: ${sessionsDeleted}`);
    console.log('========================================');
    console.log('');

    res.json({
      success: true,
      message: 'Account and all data deleted successfully (GDPR compliant)',
      deletedCounts: {
        images: imageDeleteCount,
        items: itemsDeleted,
        collections: collectionsDeleted,
        containers: containersDeleted,
        locations: locationsDeleted,
        moves: movesDeleted,
        sessions: sessionsDeleted
      }
    });

  } catch (error) {
    console.error('[Account Deletion] Fatal error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account',
      message: error.message
    });
  }
});

module.exports = router;
