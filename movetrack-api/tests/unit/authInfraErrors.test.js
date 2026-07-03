'use strict';

/**
 * 401 must mean "your token is bad" — never "our database hiccuped".
 * The old catch-all mapped deploy-time DB blips to 401, and the iPhone
 * (correctly trusting 401) logged the user out on every deploy.
 */

const jwt = require('jsonwebtoken');

const dbOneOrNone = jest.fn();
jest.doMock('../../services/infra/db', () => ({
  db: { oneOrNone: (...a) => dbOneOrNone(...a), any: jest.fn().mockResolvedValue([]), one: jest.fn(), none: jest.fn() },
}));

const auth = require('../../services/infra/authService');

// Matches authService's dev fallback secret (JWT_SECRET unset under jest).
const SECRET = process.env.JWT_SECRET || 'development-secret-key';
const goodToken = jwt.sign({ userId: '11111111-1111-4111-8111-111111111111', email: 'o@x.com', jti: 'j1' }, SECRET, { expiresIn: '30d' });

function run(token) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const next = jest.fn();
  return auth.authenticate(req, res, next).then(() => ({ req, res, next }));
}

beforeEach(() => dbOneOrNone.mockReset());

test('a garbage token is a real 401', async () => {
  const { res, next } = await run('not-a-jwt');
  expect(res.statusCode).toBe(401);
  expect(next).not.toHaveBeenCalled();
});

test('a valid token with no live session row is a real 401 (revoked/expired)', async () => {
  dbOneOrNone.mockResolvedValue(null); // session-row lookup finds nothing
  const { res } = await run(goodToken);
  expect(res.statusCode).toBe(401);
});

test('a DB failure during the session check is 503, NOT 401 — the session survives', async () => {
  dbOneOrNone.mockRejectedValue(new Error('connect ECONNREFUSED (pool cold after deploy)'));
  const { res, next } = await run(goodToken);
  expect(res.statusCode).toBe(503);
  expect(next).not.toHaveBeenCalled();
});
