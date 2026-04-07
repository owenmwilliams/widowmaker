const express = require('express');
const router = express.Router();
const rateLimits = require('../../../config/rateLimits');

router.use(rateLimits.apiLimiter);

router.use('/nexus', require('./nexus'));
router.use('/census', require('./census'));
router.use('/vector', require('./vector'));

module.exports = router;
