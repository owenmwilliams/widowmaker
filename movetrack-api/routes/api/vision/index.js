const express = require('express');
const router = express.Router();

router.use('/', require('./image'));
router.use('/video', require('./video'));

module.exports = router;
