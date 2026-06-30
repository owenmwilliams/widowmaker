var express = require('express');
var router = express.Router();
const { authenticate } = require('../../../services/infra/authService');
const { createShare, listShares, revokeShare } = require('../../../services/inventory/shareService');

router.use(authenticate);

/* POST /shares — create a public share link for the user's inventory. */
router.post('/', async function (req, res, next) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { moveId, title, expiresInDays } = req.body || {};
    const share = await createShare(userId, {
      moveId: moveId || null,
      title: title || null,
      expiresInDays: expiresInDays || null,
    });
    res.status(201).json(share);
  } catch (err) {
    next(err);
  }
});

/* GET /shares — list the user's share links. */
router.get('/', async function (req, res, next) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(await listShares(userId));
  } catch (err) {
    next(err);
  }
});

/* DELETE /shares/:token — revoke a share link. */
router.delete('/:token', async function (req, res, next) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const revoked = await revokeShare(userId, req.params.token);
    if (!revoked) return res.status(404).json({ error: 'Share not found' });
    res.json(revoked);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
