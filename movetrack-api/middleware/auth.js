/**
 * middleware/auth.js
 *
 * Application-level authentication gate.
 *
 * `requireAuth` is mounted globally in app.js so the API is DEFAULT-DENY:
 * every request must carry a valid magic-link session token unless its path is
 * on the explicit public allowlist below. This is the safety net that prevents a
 * newly-added route from accidentally shipping unauthenticated.
 *
 * Per-route `router.use(authenticate)` calls are kept as defense-in-depth; they
 * short-circuit when `req.user` is already populated (see authService.authenticate),
 * so there is no double database lookup.
 */

const { authenticate } = require('../services/infra/authService');

// Path prefixes that must remain reachable without a session.
//   /auth               – magic-link request / verify / logout
//   /health             – liveness & readiness probes (no PII, no DB writes)
//   /billing/webhook    – Stripe webhook (verified by signature, not session) [future]
//   /public             – tokenized read-only inventory shares (resolved by token)
//   /internal/scan-jobs – Cloud Tasks push target (verified by Google OIDC
//                         token, not session — see routes/internal/scanJobs.js)
const PUBLIC_PREFIXES = ['/auth', '/health', '/billing/webhook', '/public', '/internal/scan-jobs'];

// Exact public paths (the Jade landing page + favicon).
const PUBLIC_EXACT = new Set(['/', '/favicon.ico']);

function isPublic(req) {
  // CORS preflight never carries an Authorization header.
  if (req.method === 'OPTIONS') return true;

  const path = req.path;
  if (PUBLIC_EXACT.has(path)) return true;

  return PUBLIC_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix + '/')
  );
}

/**
 * Global default-deny gate. Public paths pass through untouched; everything else
 * must authenticate.
 */
function requireAuth(req, res, next) {
  if (isPublic(req)) return next();
  return authenticate(req, res, next);
}

/**
 * Admin gate. Must run AFTER authentication has populated req.user.
 */
function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, isPublic };
