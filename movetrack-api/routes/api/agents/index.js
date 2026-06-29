const express = require('express');
const router = express.Router();
const rateLimits = require('../../../config/rateLimits');
const { enforceAiBudget } = require('../../../middleware/aiBudget');

router.use(rateLimits.apiLimiter);
// Block AI calls once the user is over their daily/monthly spend cap.
router.use(enforceAiBudget);

router.use('/nexus', require('./nexus'));
router.use('/census', require('./census'));
router.use('/vector', require('./vector'));

module.exports = router;
