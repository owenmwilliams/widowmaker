const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../services/infra/authService');
const {
  getUserProfile,
  checkUsernameAvailability,
  upsertUserProfile,
  updateUserName,
} = require('../../../services/workflow/userService');
const { completeOnboarding, importInventory } = require('../../../services/workflow/onboardingService');
const { deleteUserAccount } = require('../../../services/workflow/userDeleteService');

const jsonParser = express.json({ limit: '5mb' });

router.use(authenticate);

// ─── GET / ────────────────────────────────────────────────────────────────────
// Fetch current user profile.
router.get('/', async (req, res, next) => {
  try {
    const user = await getUserProfile(req.user?.user_id);
    if (!user) return res.send('nodata');
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ─── GET /usercheck ───────────────────────────────────────────────────────────
// Check username availability.
router.get('/usercheck', async (req, res, next) => {
  try {
    const count = await checkUsernameAvailability(req.query.username);
    res.json([{ count: String(count) }]);
  } catch (err) {
    next(err);
  }
});

// ─── POST /post ───────────────────────────────────────────────────────────────
// Upsert user profile fields (reads from query params for backwards compat).
router.post('/post', async (req, res, next) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    await upsertUserProfile(userId, {
      user_name:  req.query.username,
      first_name: req.query.firstname,
      last_name:  req.query.lastname,
      email:      req.query.email,
      phone:      req.query.phone,
    });
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /name ────────────────────────────────────────────────────────────────
// Update first and last name.
router.put('/name', jsonParser, async (req, res) => {
  const { first_name, last_name } = req.body || {};
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!first_name || typeof first_name !== 'string' || !first_name.trim()) {
    return res.status(400).json({ error: 'first_name is required' });
  }
  try {
    const user = await updateUserName(userId, first_name, last_name);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    console.error('[users] updateUserName failed:', err.message);
    res.status(500).json({ error: 'Failed to update user name' });
  }
});

// ─── POST /onboarding/complete ────────────────────────────────────────────────
// Complete onboarding: optionally update profile, create location + rooms,
// and mark onboarding_completed = true. All fields optional.
router.post('/onboarding/complete', jsonParser, async (req, res) => {
  const userId = req.user?.user_id || req.user?.userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    const { profile, location, rooms } = req.body || {};
    const result = await completeOnboarding(userId, { profile, location, rooms });
    res.json({ success: true, summary: result });
  } catch (err) {
    console.error('[users] completeOnboarding failed:', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message || 'Failed to complete onboarding' });
  }
});

// ─── POST /imports/inventory ──────────────────────────────────────────────────
// Bulk-import inventory items from CSV-parsed JSON rows.
router.post('/imports/inventory', jsonParser, async (req, res) => {
  const userId = req.user?.user_id || req.user?.userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const { location_id, items } = req.body || {};
  if (!location_id) return res.status(400).json({ success: false, error: 'location_id is required' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ success: false, error: 'No rows to import' });

  try {
    const result = await importInventory(userId, location_id, items);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[users] importInventory failed:', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message || 'Failed to import inventory' });
  }
});

// ─── DELETE /account ──────────────────────────────────────────────────────────
// GDPR-compliant account deletion: removes all GCS assets and DB rows.
router.delete('/account', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    const deletedCounts = await deleteUserAccount(userId);
    res.json({ success: true, message: 'Account and all data deleted successfully (GDPR compliant)', deletedCounts });
  } catch (err) {
    console.error('[users] deleteUserAccount failed:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete account', message: err.message });
  }
});

module.exports = router;
