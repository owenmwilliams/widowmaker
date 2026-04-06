var express = require('express');
var router = express.Router();
const { authenticate } = require('../../../services/infra/authService');
const { getInventorySnapshot } = require('../../../services/inventory/inventorySummaryQueryService');

router.use(authenticate);

/* GET full inventory snapshot for client-side hydration. */
router.get('/', async function (req, res, next) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const data = await getInventorySnapshot(userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
