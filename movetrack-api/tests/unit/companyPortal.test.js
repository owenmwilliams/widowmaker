'use strict';

/**
 * Route-level tests for the mover dashboard (F2, #99): company magic-link
 * auth (routes/api/companyAuth.js + services/infra/companyAuthService.js)
 * and the portal endpoints (routes/api/companyPortal.js). Proves:
 *
 *   • request-link ALWAYS answers a neutral 200 — registered and unknown
 *     emails are indistinguishable (no account enumeration) — and the real
 *     per-(email, IP) rate limiter fires.
 *   • Tokens are hashed at rest; verify is single-use (atomic claim) and
 *     expiry/used are enforced in the claim SQL; garbage shapes never touch
 *     the DB.
 *   • AUTH ISOLATION, both directions: a user session JWT and a guest
 *     capture JWT are rejected by the company portal, and a company session
 *     token is rejected by an existing user-authed route (quote-leads,
 *     running the REAL authenticate()) — plus a guest JWT against the same
 *     user route for good measure.
 *   • overview / walkthroughs / settings shapes; the honest v1 leads note.
 *
 * Routers are mounted in isolation with db + nodemailer mocked and the REAL
 * authService/companyAuthService, so the isolation tests exercise real
 * verification, not a stub's opinion (companyCapture.test.js pattern).
 */

jest.mock('../../services/infra/db', () => ({
  db: { any: jest.fn(), one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn() },
}));

// Pass-through limiters for route tests; the real ones are exercised
// separately via jest.requireActual below.
jest.mock('../../config/rateLimits', () => ({
  companyAuthRequestLimiter: (req, res, next) => next(),
  companyAuthVerifyLimiter: (req, res, next) => next(),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const crypto = require('crypto');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { db } = require('../../services/infra/db');
const companyAuthService = require('../../services/infra/companyAuthService');
const companyAuthRouter = require('../../routes/api/companyAuth');
const companyPortalRouter = require('../../routes/api/companyPortal');
// An EXISTING user-authed route, running the REAL authenticate() — the
// counterparty for the isolation tests.
const quoteLeadsRouter = require('../../routes/api/move/quoteLeads');

// Matches authService's dev fallback secret (JWT_SECRET unset under jest) —
// the same secret user session JWTs and guest capture JWTs are signed with.
const SECRET = process.env.JWT_SECRET || 'development-secret-key';

const COMPANY_ID = 'c0c0c0c0-1111-2222-3333-444444444444';
const COMPANY_ROW = {
  id: COMPANY_ID,
  name: 'Acme Movers',
  contact_email: 'ops@acme.test',
  token: 'acmecompanycapturetoken',
  is_active: true,
  created_at: '2026-07-01T00:00:00Z',
};

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/company/auth', companyAuthRouter);
  app.use('/api/company', companyPortalRouter);
  app.use('/api/move/quote-leads', quoteLeadsRouter);
  return app;
}

/** A valid company session: authenticateCompany's join finds COMPANY_ROW. */
function wireCompanySession(extra = {}) {
  db.oneOrNone.mockImplementation(async (sql) => {
    if (/FROM company_auth_tokens t/.test(sql)) return { ...COMPANY_ROW, ...extra };
    return null;
  });
}

const companySessionToken = () => companyAuthService.generateCompanyToken();

beforeEach(() => {
  jest.clearAllMocks();
  db.none.mockResolvedValue(undefined);
  // Overview now also lists invite-attached docs (#100) via db.any; default
  // to none so pre-existing shape tests stay focused.
  db.any.mockResolvedValue([]);
  mockSendMail.mockResolvedValue({ accepted: ['x'] });
  process.env.SMTP_USER = 'apikey';
  process.env.SMTP_PASS = 'test-smtp-pass';
});

afterAll(() => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

// ── request-link ─────────────────────────────────────────────────────────────

describe('POST /api/company/auth/request-link', () => {
  test('unknown email → neutral 200, no token row, no mail', async () => {
    db.oneOrNone.mockResolvedValue(null); // no company matches
    const res = await request(makeApp())
      .post('/api/company/auth/request-link')
      .send({ email: 'stranger@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email/i);
    expect(db.none).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('registered email → IDENTICAL neutral 200, hashed token stored, link mailed', async () => {
    db.oneOrNone.mockResolvedValue({ id: COMPANY_ID, name: 'Acme Movers', contact_email: 'ops@acme.test' });

    const res = await request(makeApp())
      .post('/api/company/auth/request-link')
      .send({ email: 'Ops@Acme.test' }); // case-insensitive match

    expect(res.status).toBe(200);

    // Same body as the unknown-email case — nothing to enumerate on.
    const unknownRes = await (async () => {
      db.oneOrNone.mockResolvedValue(null);
      return request(makeApp()).post('/api/company/auth/request-link').send({ email: 'stranger@example.com' });
    })();
    expect(res.body).toEqual(unknownRes.body);

    // The mailed link carries the RAW token; the DB got only its SHA-256.
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('ops@acme.test');
    const m = mail.text.match(/\/mover\/login\?token=(cmp_[0-9a-f]{64})/);
    expect(m).toBeTruthy();
    const rawToken = m[1];

    const insert = db.none.mock.calls.find(([sql]) => /INSERT INTO company_auth_tokens/.test(sql));
    expect(insert).toBeTruthy();
    expect(insert[0]).toContain("'magic_link'");
    expect(insert[1][1]).toBe(sha256(rawToken));
    expect(insert[1][1]).not.toBe(rawToken);
  });

  test('mail transport failure still answers the neutral 200 (no leak via errors)', async () => {
    db.oneOrNone.mockResolvedValue({ id: COMPANY_ID, name: 'Acme Movers', contact_email: 'ops@acme.test' });
    mockSendMail.mockRejectedValue(new Error('smtp down'));
    const res = await request(makeApp())
      .post('/api/company/auth/request-link')
      .send({ email: 'ops@acme.test' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email/i);
  });

  test('malformed email → 400 (format is public knowledge, not enumeration)', async () => {
    const res = await request(makeApp())
      .post('/api/company/auth/request-link')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(db.oneOrNone).not.toHaveBeenCalled();
  });

  test('the REAL rate limiter is per (email, IP): 11th request for one email → 429, other emails unaffected', async () => {
    const { companyAuthRequestLimiter } = jest.requireActual('../../config/rateLimits');
    const app = express();
    app.use(express.json());
    app.post('/rl', companyAuthRequestLimiter, (req, res) => res.json({ ok: true }));

    for (let i = 0; i < 10; i++) {
      const ok = await request(app).post('/rl').send({ email: 'ops@acme.test' });
      expect(ok.status).toBe(200);
    }
    const blocked = await request(app).post('/rl').send({ email: 'ops@acme.test' });
    expect(blocked.status).toBe(429);
    // A different email from the same IP still passes — the key is email+IP.
    const other = await request(app).post('/rl').send({ email: 'other@acme.test' });
    expect(other.status).toBe(200);
  });
});

// ── verify ───────────────────────────────────────────────────────────────────

describe('POST /api/company/auth/verify', () => {
  test('valid link → single-use claim, 30-day session minted hashed, company returned', async () => {
    const magic = companyAuthService.generateCompanyToken();
    db.oneOrNone.mockImplementation(async (sql, params) => {
      if (/UPDATE company_auth_tokens/.test(sql)) {
        // Atomic single-use claim: only unused, unexpired magic links win.
        expect(sql).toContain('used_at IS NULL');
        expect(sql).toContain('expires_at > NOW()');
        expect(sql).toContain("purpose = 'magic_link'");
        expect(params[0]).toBe(sha256(magic)); // looked up by HASH, never raw
        return { company_id: COMPANY_ID };
      }
      if (/FROM companies/.test(sql)) return { id: COMPANY_ID, name: 'Acme Movers', contact_email: 'ops@acme.test' };
      return null;
    });

    const res = await request(makeApp()).post('/api/company/auth/verify').send({ token: magic });

    expect(res.status).toBe(200);
    expect(res.body.sessionToken).toMatch(/^cmp_[0-9a-f]{64}$/);
    expect(res.body.company).toEqual({ id: COMPANY_ID, name: 'Acme Movers', contactEmail: 'ops@acme.test' });

    const insert = db.none.mock.calls.find(([sql]) => /INSERT INTO company_auth_tokens/.test(sql));
    expect(insert[0]).toContain("'session'");
    expect(insert[1][1]).toBe(sha256(res.body.sessionToken)); // hashed at rest
  });

  test('used or expired link (claim loses) → 401', async () => {
    db.oneOrNone.mockResolvedValue(null); // UPDATE…RETURNING matched nothing
    const res = await request(makeApp())
      .post('/api/company/auth/verify')
      .send({ token: companyAuthService.generateCompanyToken() });
    expect(res.status).toBe(401);
    expect(db.none).not.toHaveBeenCalled(); // no session minted
  });

  test('garbage token shape → 401 without touching the DB', async () => {
    const res = await request(makeApp()).post('/api/company/auth/verify').send({ token: 'cmp_nothexatall' });
    expect(res.status).toBe(401);
    expect(db.oneOrNone).not.toHaveBeenCalled();
  });
});

// ── AUTH ISOLATION (the critical property) ───────────────────────────────────

describe('auth isolation between company sessions and user/guest auth', () => {
  const userJwt = () =>
    jwt.sign({ userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', email: 'user@example.com', jti: 'j1' }, SECRET, { expiresIn: '30d' });
  const guestJwt = () =>
    jwt.sign({ captureSessionId: '11111111-2222-3333-4444-555555555555', userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', guest: true }, SECRET, { expiresIn: '30d' });

  test('a USER session JWT is rejected by the company portal — before any DB lookup', async () => {
    const res = await request(makeApp())
      .get('/api/company/overview')
      .set('Authorization', `Bearer ${userJwt()}`);
    expect(res.status).toBe(401);
    expect(db.oneOrNone).not.toHaveBeenCalled(); // shape check, no roundtrip
  });

  test('a GUEST capture JWT is rejected by the company portal', async () => {
    const res = await request(makeApp())
      .get('/api/company/walkthroughs')
      .set('Authorization', `Bearer ${guestJwt()}`);
    expect(res.status).toBe(401);
    expect(db.oneOrNone).not.toHaveBeenCalled();
  });

  test('a COMPANY session token is rejected by a user-authed route (real authenticate())', async () => {
    // cmp_… is not a JWT: jwt.verify fails before any DB/session lookup, so
    // a company session can never impersonate a user.
    const res = await request(makeApp())
      .post('/api/move/quote-leads')
      .set('Authorization', `Bearer ${companySessionToken()}`)
      .send({ tier: 'full-service', contact_email: 'ops@acme.test' });
    expect(res.status).toBe(401);
  });

  test('a GUEST capture JWT is rejected by the same user-authed route (no auth_tokens row)', async () => {
    db.oneOrNone.mockResolvedValue(null); // guest JWTs have no auth_tokens session row
    const res = await request(makeApp())
      .post('/api/move/quote-leads')
      .set('Authorization', `Bearer ${guestJwt()}`)
      .send({ tier: 'full-service', contact_email: 'x@y.zz' });
    expect(res.status).toBe(401);
  });

  test('a COMPANY session token IS accepted by the portal (control)', async () => {
    wireCompanySession();
    db.one.mockResolvedValue({ sessions_total: 0, sessions_completed: 0, from_widget: 0 });
    const res = await request(makeApp())
      .get('/api/company/overview')
      .set('Authorization', `Bearer ${companySessionToken()}`);
    expect(res.status).toBe(200);
  });

  test('a revoked/expired company session (no live row) → 401', async () => {
    db.oneOrNone.mockResolvedValue(null);
    const res = await request(makeApp())
      .get('/api/company/overview')
      .set('Authorization', `Bearer ${companySessionToken()}`);
    expect(res.status).toBe(401);
  });

  test('a DB failure during the session check is 503, NOT 401 — the session survives', async () => {
    db.oneOrNone.mockRejectedValue(new Error('pool cold after deploy'));
    const res = await request(makeApp())
      .get('/api/company/overview')
      .set('Authorization', `Bearer ${companySessionToken()}`);
    expect(res.status).toBe(503);
  });
});

// ── overview ─────────────────────────────────────────────────────────────────

describe('GET /api/company/overview', () => {
  test('profile + capture link + embed snippet + counters', async () => {
    wireCompanySession();
    db.one.mockImplementation(async (sql, params) => {
      expect(sql).toContain('FROM company_capture_sessions');
      expect(params[0]).toBe(COMPANY_ID); // scoped to the session's company
      return { sessions_total: 7, sessions_completed: 4, from_widget: 2 };
    });

    const res = await request(makeApp())
      .get('/api/company/overview')
      .set('Authorization', `Bearer ${companySessionToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.company).toEqual({
      id: COMPANY_ID,
      name: 'Acme Movers',
      contactEmail: 'ops@acme.test',
      isActive: true,
      createdAt: '2026-07-01T00:00:00Z',
    });
    expect(res.body.captureUrl).toMatch(/\/c\/acmecompanycapturetoken$/);
    const appOrigin = res.body.captureUrl.replace(/\/c\/.*$/, '');
    expect(res.body.embedSnippet).toBe(
      `<script src="${appOrigin}/widget.js" data-nexus-token="acmecompanycapturetoken" async></script>`
    );
    expect(res.body.counters).toEqual({ sessionsTotal: 7, sessionsCompleted: 4, fromWidget: 2 });
  });

  test('zero-walkthrough company still gets its link + snippet (day-one dashboard)', async () => {
    wireCompanySession();
    db.one.mockResolvedValue({ sessions_total: 0, sessions_completed: 0, from_widget: 0 });
    const res = await request(makeApp())
      .get('/api/company/overview')
      .set('Authorization', `Bearer ${companySessionToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.captureUrl).toBeTruthy();
    expect(res.body.embedSnippet).toContain('widget.js');
    expect(res.body.counters).toEqual({ sessionsTotal: 0, sessionsCompleted: 0, fromWidget: 0 });
  });
});

// ── walkthroughs ─────────────────────────────────────────────────────────────

describe('GET /api/company/walkthroughs', () => {
  test('sessions newest first with item counts; shareUrl only once completed', async () => {
    wireCompanySession();
    db.any.mockImplementation(async (sql, params) => {
      expect(params[0]).toBe(COMPANY_ID);
      expect(sql).toContain('ORDER BY s.created_at DESC');
      return [
        {
          id: 's-2', customer_email: 'new@example.com', status: 'active', source: 'widget',
          videos_count: 2, created_at: '2026-08-18T10:00:00Z', completed_at: null,
          items_count: 9, share_token: null,
        },
        {
          id: 's-1', customer_email: 'done@example.com', status: 'completed', source: 'link',
          videos_count: 5, created_at: '2026-08-10T10:00:00Z', completed_at: '2026-08-10T11:00:00Z',
          items_count: 42, share_token: 'sh-abc',
        },
      ];
    });

    const res = await request(makeApp())
      .get('/api/company/walkthroughs')
      .set('Authorization', `Bearer ${companySessionToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.walkthroughs).toHaveLength(2);
    expect(res.body.walkthroughs[0]).toEqual({
      id: 's-2', customerEmail: 'new@example.com', status: 'active', source: 'widget',
      videosCount: 2, itemsCount: 9, createdAt: '2026-08-18T10:00:00Z', completedAt: null,
      shareUrl: null,
    });
    expect(res.body.walkthroughs[1]).toMatchObject({
      id: 's-1', customerEmail: 'done@example.com', status: 'completed',
      itemsCount: 42, completedAt: '2026-08-10T11:00:00Z',
    });
    expect(res.body.walkthroughs[1].shareUrl).toMatch(/\/share\/sh-abc$/);
  });

  test('empty list for a brand-new company', async () => {
    wireCompanySession();
    db.any.mockResolvedValue([]);
    const res = await request(makeApp())
      .get('/api/company/walkthroughs')
      .set('Authorization', `Bearer ${companySessionToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.walkthroughs).toEqual([]);
  });
});

// ── leads (v1 honest empty state) ────────────────────────────────────────────

describe('GET /api/company/leads', () => {
  test('returns [] with the documented v1 note (quote_leads has no company_id)', async () => {
    wireCompanySession();
    const res = await request(makeApp())
      .get('/api/company/leads')
      .set('Authorization', `Bearer ${companySessionToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.leads).toEqual([]);
    expect(typeof res.body.note).toBe('string');
    expect(res.body.note.length).toBeGreaterThan(0);
  });
});

// ── settings ─────────────────────────────────────────────────────────────────

describe('PATCH /api/company/settings', () => {
  test('updates name + contact_email + is_active, scoped to the session company', async () => {
    wireCompanySession();
    db.one.mockImplementation(async (sql, params) => {
      expect(sql).toContain('UPDATE companies');
      expect(params[0]).toBe(COMPANY_ID);
      expect(params).toContain('Acme Van Lines');
      expect(params).toContain('dispatch@acme.test');
      expect(params).toContain(false);
      return { id: COMPANY_ID, name: 'Acme Van Lines', contact_email: 'dispatch@acme.test', is_active: false, created_at: '2026-07-01T00:00:00Z' };
    });

    const res = await request(makeApp())
      .patch('/api/company/settings')
      .set('Authorization', `Bearer ${companySessionToken()}`)
      .send({ name: 'Acme Van Lines', contact_email: 'Dispatch@Acme.test', is_active: false });

    expect(res.status).toBe(200);
    expect(res.body.company).toEqual({
      id: COMPANY_ID, name: 'Acme Van Lines', contactEmail: 'dispatch@acme.test',
      isActive: false, createdAt: '2026-07-01T00:00:00Z',
    });
  });

  test('malformed contact_email → 400, nothing written', async () => {
    wireCompanySession();
    const res = await request(makeApp())
      .patch('/api/company/settings')
      .set('Authorization', `Bearer ${companySessionToken()}`)
      .send({ contact_email: 'nope' });
    expect(res.status).toBe(400);
    expect(db.one).not.toHaveBeenCalled();
  });

  test('empty body → 400', async () => {
    wireCompanySession();
    const res = await request(makeApp())
      .patch('/api/company/settings')
      .set('Authorization', `Bearer ${companySessionToken()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('non-boolean is_active → 400', async () => {
    wireCompanySession();
    const res = await request(makeApp())
      .patch('/api/company/settings')
      .set('Authorization', `Bearer ${companySessionToken()}`)
      .send({ is_active: 'yes' });
    expect(res.status).toBe(400);
  });
});
