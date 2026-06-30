var express = require('express');
var router = express.Router();
const { getSharedReport } = require('../../services/inventory/shareService');

/*
 * Public, UNAUTHENTICATED inventory share view.
 * Mounted at /public (allowlisted in middleware/auth.js). Resolves a share
 * strictly by its opaque token; never exposes other users' data.
 *
 * GET /public/inventory/:token -> mover-ready report JSON (or 404/410).
 */
router.get('/inventory/:token', async function (req, res, next) {
  try {
    const result = await getSharedReport(req.params.token);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    // Read-only public content; allow short caching by the browser.
    res.set('Cache-Control', 'public, max-age=60');
    res.json(result.report);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
