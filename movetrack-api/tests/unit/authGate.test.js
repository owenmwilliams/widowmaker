/**
 * Unit tests for the global default-deny auth gate (middleware/auth.js).
 *
 * These are intentionally DB-free so they run in CI without a Postgres instance.
 */

const { isPublic } = require('../../middleware/auth');

describe('auth gate — isPublic allowlist', () => {
  const publicCases = [
    ['GET', '/'],
    ['GET', '/favicon.ico'],
    ['GET', '/health'],
    ['GET', '/health/ready'],
    ['POST', '/auth/request-magic-link'],
    ['POST', '/auth/verify-magic-link'],
    ['POST', '/billing/webhook'],
    ['OPTIONS', '/items'], // CORS preflight never carries a token
  ];

  const protectedCases = [
    ['GET', '/items'],
    ['POST', '/api/agents/nexus'],
    ['POST', '/api/vision/analyze-item'],
    ['POST', '/email/send'],
    ['GET', '/admin/analytics/moves'],
    ['GET', '/users'],
    ['GET', '/healthcheck'], // not the health prefix — must NOT be public
    ['GET', '/authorize'], // not the /auth prefix — must NOT be public
  ];

  test.each(publicCases)('%s %s is public', (method, path) => {
    expect(isPublic({ method, path })).toBe(true);
  });

  test.each(protectedCases)('%s %s requires auth', (method, path) => {
    expect(isPublic({ method, path })).toBe(false);
  });
});
