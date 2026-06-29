const express = require('express');
const router = express.Router();
const { enforceAiBudget } = require('../../../middleware/aiBudget');

// Block vision calls once the user is over their daily/monthly AI spend cap.
router.use(enforceAiBudget);

router.use('/', require('./image'));
router.use('/video', require('./video'));

module.exports = router;
