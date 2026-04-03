const express = require('express');
const router = express.Router();
const rateLimits = require('../../../config/rateLimits');

router.use('/users', require('./users'));
router.use('/onboarding', require('./userOnboarding'));
router.use('/imports', require('./userImport'));
router.use('/file', rateLimits.uploadLimiter, require('./userFiles'));

module.exports = router;
