'use strict';

/**
 * Route-level tests for the discover-movers invite loop (F3, #100):
 * routes/api/discover.js, routes/api/companyClaim.js, plus the small
 * additions to companyPortal (overview pendingDocs) and companyCapture
 * (admin invite metrics). Proves:
 *
 *   • GET /api/discover/movers NEVER calls Google in tests (the Places call
 *     is fully mocked), returns the top movers with the onNexus badge, and
 *     answers 503 with honest copy when no Places key is configured — no
 *     faked results, ever.
 *   • onNexus matching is CONSERVATIVE: a claimed place_ref always matches;
 *     a normalized-name match only counts when exactly one company carries
 *     that name; ambiguity and short/generic names never badge.
 *   • Search results are cached per (user, move) — a second request makes no
 *     second Places call.
 *   • POST /api/discover/invite caps at 5 selections/request and 10
 *     invites/rolling-day (counted in SQL), emails Nexus companies directly,
 *     and hands the customer claim-link + copy text for everyone else
 *     (Places has no business emails — the response says forward).
 *   • POST /api/company/claim is single-use ATOMIC (transaction + FOR
 *     UPDATE): a valid token creates the company, links the invite, mints a
 *     hashed magic link, and mails welcome + customer notification; garbage
 *     and used tokens are rejected without touching company creation.
 *   • GET /api/company/overview lists invite-attached share docs
 *     (pendingDocs).
 *   • GET /api/capture/invites is admin-gated research metrics.
 *
 * db + nodemailer + geocodingService are mocked; user auth is stubbed via
 * the authService mock (the real-auth isolation matrix lives in
 * companyPortal.test.js and is not re-proven here).
 */

jest.mock('../../services/infra/db', () => ({
  db: {
    any: jest.fn(),
    one: jest.fn(),
    oneOrNone: jest.fn(),
    none: jest.fn(),
    tx: jest.fn(),
  },
}));

// Pass-through limiters; real limiter mechanics are covered elsewhere.
jest.mock('../../config/rateLimits', () => ({
  discoverSearchLimiter: (req, res, next) => next(),
  companyClaimLimiter: (req, res, next) => next(),
  publicLimiter: (req, res, next) => next(),
  captureLimiter: (req, res, next) => next(),
  captureStartLimiter: (req, res, next) => next(),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

// Places/geocode fully mocked — tests must NEVER hit Google.
jest.mock('../../services/infra/geocodingService', () => ({
  searchNearbyMovingCompanies: jest.fn(),
  forwardGeocode: jest.fn(),
}));

// Mutable Google key config: present by default, absent for the 503 test.
jest.mock('../../config/google', () => ({
  GOOGLE_API_KEY: 'test-places-key',
  GOOGLE_MAPS_API_KEY: 'test-places-key',
  isGoogleMapsConfigured: () => true,
}));

// Stub user auth: mockCurrentUser is swapped per test (admin gate, identity).
let mockCurrentUser;
jest.mock('../../services/infra/authService', () => ({
  authenticate: (req, res, next) => {
    if (!mockCurrentUser) return res.status(401).json({ error: 'Unauthorized' });
    req.user = mockCurrentUser;
    next();
  },
  // companyCapture.js imports these; unused in the routes under test here.
  signGuestCaptureToken: jest.fn(),
  verifyGuestCaptureToken: jest.fn(),
}));

const crypto = require('crypto');
const request = require('supertest');
const express = require('express');
const { db } = require('../../services/infra/db');
const geocoding = require('../../services/infra/geocodingService');
const googleConfig = require('../../config/google');
const discoverRouter = require('../../routes/api/discover');
const companyClaimRouter = require('../../routes/api/companyClaim');
const companyPortalRouter = require('../../routes/api/companyPortal');
const companyCaptureRouter = require('../../routes/api/companyCapture');
const companyAuthService = require('../../services/infra/companyAuthService');

const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const COMPANY_ID = 'c0c0c0c0-1111-2222-3333-444444444444';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/discover', discoverRouter);
  app.use('/api/company/claim', companyClaimRouter);
  app.use('/api/company', companyPortalRouter);
  app.use('/api/capture', companyCaptureRouter);
  return app;
}

const ORIGIN_ROW = {
  id: 42, name: 'My Home', address: '123 Main St', city: 'Dallas', state: 'TX',
  zip: '75211', lat: '32.7357', lng: '-96.9000',
};

function placesResult(overrides = {}) {
  return {
    status: 'OK',
    results: [
      {
        place_id: 'place-acme', name: 'Acme Movers LLC',
        vicinity: '500 Elm St, Dallas', rating: 4.8, user_ratings_total: 120,
        geometry: { location: { lat: 32.74, lng: -96.91 } },
      },
      {
        place_id: 'place-lone', name: 'Lone Star Moving Co',
        vicinity: '12 Oak Ave, Dallas', rating: 4.2, user_ratings_total: 51,
        geometry: { location: { lat: 32.70, lng: -96.85 } },
      },
    ],
    ...overrides,
  };
}

/** Default db wiring for a movers search: origin row + no Nexus matches. */
function wireSearchDb({ claimedRefs = [], companies = [] } = {}) {
  db.oneOrNone.mockImplementation(async (sql) => {
    if (/FROM saved_moves sm/.test(sql)) return ORIGIN_ROW;
    if (/location_type = 'primary_residence'/.test(sql)) return ORIGIN_ROW;
    return null;
  });
  db.any.mockImplementation(async (sql) => {
    if (/FROM mover_invites mi\s+JOIN companies c/.test(sql)) return claimedRefs;
    if (/FROM companies WHERE is_active/.test(sql)) return companies;
    return [];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  discoverRouter.__resetDiscoverCache();
  mockCurrentUser = { user_id: USER_ID, email: 'customer@example.com', is_admin: false };
  googleConfig.GOOGLE_API_KEY = 'test-places-key';
  db.none.mockResolvedValue(undefined);
  mockSendMail.mockResolvedValue({ accepted: ['x'] });
  process.env.SMTP_USER = 'apikey';
  process.env.SMTP_PASS = 'test-smtp-pass';
});

afterAll(() => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

// ── GET /api/discover/movers ──────────────────────────────────────────────────

describe('GET /api/discover/movers', () => {
  test('returns nearby movers from the (mocked) Places search with distance and no false badges', async () => {
    wireSearchDb();
    geocoding.searchNearbyMovingCompanies.mockResolvedValue(placesResult());

    const res = await request(makeApp()).get('/api/discover/movers?moveId=7');

    expect(res.status).toBe(200);
    expect(res.body.origin).toEqual({ name: 'My Home', city: 'Dallas', state: 'TX' });
    expect(res.body.movers).toHaveLength(2);
    expect(res.body.movers[0]).toMatchObject({
      placeId: 'place-acme',
      name: 'Acme Movers LLC',
      address: '500 Elm St, Dallas',
      rating: 4.8,
      userRatingCount: 120,
      onNexus: false,
      companyId: null,
    });
    expect(res.body.movers[0].distanceKm).toBeGreaterThan(0);
    expect(res.body.movers[0].distanceKm).toBeLessThan(5);

    // Search used the stored lat/lng — no geocode call needed.
    expect(geocoding.searchNearbyMovingCompanies).toHaveBeenCalledWith(
      32.7357, -96.9, expect.objectContaining({ radiusMeters: 50000 })
    );
    expect(geocoding.forwardGeocode).not.toHaveBeenCalled();
  });

  test('503 with honest copy when the Places key is not configured — never fake results', async () => {
    googleConfig.GOOGLE_API_KEY = undefined;
    const res = await request(makeApp()).get('/api/discover/movers?moveId=7');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not available|not configured/i);
    expect(geocoding.searchNearbyMovingCompanies).not.toHaveBeenCalled();
  });

  test('503 when Google answers an error status (REQUEST_DENIED) — degrade, never invent', async () => {
    wireSearchDb();
    geocoding.searchNearbyMovingCompanies.mockResolvedValue({ status: 'REQUEST_DENIED', results: [] });
    const res = await request(makeApp()).get('/api/discover/movers?moveId=7');
    expect(res.status).toBe(503);
  });

  test('caches per (user, move): the second request makes NO second Places call', async () => {
    wireSearchDb();
    geocoding.searchNearbyMovingCompanies.mockResolvedValue(placesResult());
    const app = makeApp();

    const first = await request(app).get('/api/discover/movers?moveId=7');
    const second = await request(app).get('/api/discover/movers?moveId=7');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.movers).toEqual(first.body.movers);
    expect(geocoding.searchNearbyMovingCompanies).toHaveBeenCalledTimes(1);
  });

  test('404 when the move does not belong to the user (scoped query found nothing)', async () => {
    db.oneOrNone.mockResolvedValue(null);
    const res = await request(makeApp()).get('/api/discover/movers?moveId=99999');
    expect(res.status).toBe(404);
    expect(geocoding.searchNearbyMovingCompanies).not.toHaveBeenCalled();
  });

  describe('onNexus matching stays conservative', () => {
    test('a CLAIMED place_ref badges its company', async () => {
      wireSearchDb({
        claimedRefs: [{ place_ref: 'place-acme', id: COMPANY_ID, name: 'Acme Movers LLC', contact_email: 'ops@acme.test' }],
      });
      geocoding.searchNearbyMovingCompanies.mockResolvedValue(placesResult());

      const res = await request(makeApp()).get('/api/discover/movers?moveId=7');
      const acme = res.body.movers.find((m) => m.placeId === 'place-acme');
      const lone = res.body.movers.find((m) => m.placeId === 'place-lone');
      expect(acme.onNexus).toBe(true);
      expect(acme.companyId).toBe(COMPANY_ID);
      expect(lone.onNexus).toBe(false);
    });

    test('an unambiguous normalized-name match badges (punctuation/suffix/case-insensitive)', async () => {
      wireSearchDb({
        companies: [{ id: COMPANY_ID, name: 'ACME MOVERS, L.L.C.', contact_email: 'ops@acme.test' }],
      });
      geocoding.searchNearbyMovingCompanies.mockResolvedValue(placesResult());

      const res = await request(makeApp()).get('/api/discover/movers?moveId=7');
      const acme = res.body.movers.find((m) => m.placeId === 'place-acme');
      expect(acme.onNexus).toBe(true);
      expect(acme.companyId).toBe(COMPANY_ID);
    });

    test('an AMBIGUOUS name (two companies share it) never badges — false positives are worse than misses', async () => {
      wireSearchDb({
        companies: [
          { id: COMPANY_ID, name: 'Acme Movers', contact_email: 'ops@acme.test' },
          { id: 'c1c1c1c1-2222-3333-4444-555555555555', name: 'Acme Movers LLC', contact_email: 'other@acme.test' },
        ],
      });
      geocoding.searchNearbyMovingCompanies.mockResolvedValue(placesResult());

      const res = await request(makeApp()).get('/api/discover/movers?moveId=7');
      const acme = res.body.movers.find((m) => m.placeId === 'place-acme');
      expect(acme.onNexus).toBe(false);
      expect(acme.companyId).toBeNull();
    });

    test('a too-short/generic normalized name never badges', async () => {
      wireSearchDb({ companies: [{ id: COMPANY_ID, name: 'Ace', contact_email: 'ops@ace.test' }] });
      geocoding.searchNearbyMovingCompanies.mockResolvedValue({
        status: 'OK',
        results: [{
          place_id: 'place-ace', name: 'Ace!', vicinity: 'Dallas', rating: 5, user_ratings_total: 2,
          geometry: { location: { lat: 32.74, lng: -96.91 } },
        }],
      });

      const res = await request(makeApp()).get('/api/discover/movers?moveId=7');
      expect(res.body.movers[0].onNexus).toBe(false);
    });
  });
});

// ── POST /api/discover/invite ─────────────────────────────────────────────────

describe('POST /api/discover/invite', () => {
  const SHARE_ROW = { token: 'sh-tok-123' };

  /** Wire db for an invite run: daily count, share reuse, invite inserts. */
  function wireInviteDb({ dailyCount = 0, claimedRefs = [], companies = [] } = {}) {
    db.one.mockImplementation(async (sql) => {
      if (/COUNT\(\*\)::int AS count FROM mover_invites/.test(sql)) return { count: dailyCount };
      if (/INSERT INTO mover_invites/.test(sql)) return { id: crypto.randomUUID() };
      throw new Error(`unexpected db.one: ${sql}`);
    });
    db.oneOrNone.mockImplementation(async (sql) => {
      if (/FROM inventory_shares/.test(sql)) return SHARE_ROW;
      return null;
    });
    db.any.mockImplementation(async (sql) => {
      if (/FROM mover_invites mi\s+JOIN companies c/.test(sql)) return claimedRefs;
      if (/FROM companies WHERE is_active/.test(sql)) return companies;
      return [];
    });
  }

  test('more than 5 selections → 400, nothing inserted', async () => {
    wireInviteDb();
    const selections = Array.from({ length: 6 }, (_, i) => ({ place_id: `p${i}`, name: `Mover ${i}` }));
    const res = await request(makeApp()).post('/api/discover/invite').send({ selections });
    expect(res.status).toBe(400);
    expect(db.one).not.toHaveBeenCalled();
  });

  test('empty selections → 400', async () => {
    const res = await request(makeApp()).post('/api/discover/invite').send({ selections: [] });
    expect(res.status).toBe(400);
  });

  test('the rolling 10/day cap is enforced from SQL — 429 with remaining count, nothing inserted', async () => {
    wireInviteDb({ dailyCount: 8 });
    const selections = [
      { place_id: 'p1', name: 'Mover One' },
      { place_id: 'p2', name: 'Mover Two' },
      { place_id: 'p3', name: 'Mover Three' },
    ];
    const res = await request(makeApp()).post('/api/discover/invite').send({ selections });
    expect(res.status).toBe(429);
    expect(res.body.remainingToday).toBe(2);
    const inserts = db.one.mock.calls.filter(([sql]) => /INSERT INTO mover_invites/.test(sql));
    expect(inserts).toHaveLength(0);
  });

  test('non-Nexus company: claim link + copy text + mailto, recorded as sent — honest about Places having no emails', async () => {
    wireInviteDb();
    const res = await request(makeApp())
      .post('/api/discover/invite')
      .send({ moveId: 7, selections: [{ place_id: 'place-lone', name: 'Lone Star Moving Co' }] });

    expect(res.status).toBe(200);
    expect(res.body.shareUrl).toMatch(/\/share\/sh-tok-123$/);
    const r = res.body.results[0];
    expect(r).toMatchObject({ placeId: 'place-lone', onNexus: false, delivery: 'forward', status: 'sent' });
    expect(r.claimUrl).toMatch(/\/mover\/claim\/[0-9a-f]{32}$/);
    expect(r.copyText).toContain(res.body.shareUrl);
    expect(r.copyText).toContain(r.claimUrl);
    expect(r.mailto).toMatch(/^mailto:\?subject=/);

    // The invite row carries the token from the claim URL and the share URL.
    const insert = db.one.mock.calls.find(([sql]) => /INSERT INTO mover_invites/.test(sql));
    const token = r.claimUrl.split('/').pop();
    expect(insert[1]).toEqual([USER_ID, 'place-lone', 'Lone Star Moving Co', res.body.shareUrl, token]);

    // Nobody to email — Places gave us no address.
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('Nexus company: emailed directly with share link + dashboard link, no claim URL needed', async () => {
    wireInviteDb({
      claimedRefs: [{ place_ref: 'place-acme', id: COMPANY_ID, name: 'Acme Movers LLC', contact_email: 'ops@acme.test' }],
    });
    const res = await request(makeApp())
      .post('/api/discover/invite')
      .send({ selections: [{ place_id: 'place-acme', name: 'Acme Movers LLC' }], message: 'Moving June 3rd!' });

    expect(res.status).toBe(200);
    const r = res.body.results[0];
    expect(r).toMatchObject({ onNexus: true, delivery: 'emailed', status: 'sent' });
    expect(r.claimUrl).toBeUndefined();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('ops@acme.test');
    expect(mail.subject).toMatch(/customer sent you their inventory/i);
    expect(mail.text).toContain('/share/sh-tok-123');
    expect(mail.text).toContain('/mover/login');
    expect(mail.text).toContain('Moving June 3rd!');
  });

  test('Nexus company email failure → invite marked failed, customer gets the mailto fallback', async () => {
    wireInviteDb({
      claimedRefs: [{ place_ref: 'place-acme', id: COMPANY_ID, name: 'Acme Movers LLC', contact_email: 'ops@acme.test' }],
    });
    mockSendMail.mockRejectedValue(new Error('smtp down'));

    const res = await request(makeApp())
      .post('/api/discover/invite')
      .send({ selections: [{ place_id: 'place-acme', name: 'Acme Movers LLC' }] });

    expect(res.status).toBe(200);
    const r = res.body.results[0];
    expect(r.status).toBe('failed');
    expect(r.mailto).toContain('mailto:ops@acme.test');
    const failUpdate = db.none.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
    expect(failUpdate).toBeTruthy();
  });

  test('mints a share when the customer has none yet', async () => {
    wireInviteDb();
    db.oneOrNone.mockResolvedValue(null); // no live share
    const shareServiceModule = require('../../services/inventory/shareService');
    const createSpy = jest.spyOn(shareServiceModule, 'createShare')
      .mockResolvedValue({ url: 'https://app.test/share/new-tok' });

    const res = await request(makeApp())
      .post('/api/discover/invite')
      .send({ selections: [{ place_id: 'p1', name: 'Fresh Mover Co' }] });

    expect(res.status).toBe(200);
    expect(createSpy).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ title: 'Moving inventory' }));
    expect(res.body.shareUrl).toBe('https://app.test/share/new-tok');
    createSpy.mockRestore();
  });
});

// ── POST /api/company/claim ───────────────────────────────────────────────────

describe('mover claim (GET lookup + POST claim)', () => {
  const INVITE_TOKEN = 'a'.repeat(32);
  const INVITE_ROW = {
    id: 'i0i0i0i0-1111-2222-3333-444444444444',
    user_id: USER_ID,
    business_name: 'Lone Star Moving Co',
    share_token_or_url: 'https://app.test/share/sh-tok-123',
  };

  /** db.tx executes its callback against the same mocked db handle. */
  function wireTx() {
    db.tx.mockImplementation(async (cb) => cb(db));
  }

  test('GET lookup returns the business name for a live invite', async () => {
    db.oneOrNone.mockResolvedValue({ business_name: 'Lone Star Moving Co', status: 'sent', claimed_at: null });
    const res = await request(makeApp()).get(`/api/company/claim/${INVITE_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ businessName: 'Lone Star Moving Co', status: 'sent' });
  });

  test('GET lookup: garbage token shape → 404 without touching the DB', async () => {
    const res = await request(makeApp()).get('/api/company/claim/not-a-token');
    expect(res.status).toBe(404);
    expect(db.oneOrNone).not.toHaveBeenCalled();
  });

  test('valid claim: company created, invite linked+claimed atomically, hashed magic link minted, both emails sent', async () => {
    wireTx();
    db.oneOrNone.mockImplementation(async (sql) => {
      if (/FROM mover_invites/.test(sql)) {
        // The atomic claim runs inside the transaction with a row lock.
        expect(sql).toContain("status = 'sent'");
        expect(sql).toContain('claimed_at IS NULL');
        expect(sql).toContain('FOR UPDATE');
        return INVITE_ROW;
      }
      if (/SELECT email FROM users/.test(sql)) return { email: 'customer@example.com' };
      return null;
    });
    db.one.mockImplementation(async (sql, params) => {
      if (/INSERT INTO companies/.test(sql)) {
        expect(params[0]).toBe('Lone Star Moving Co');
        expect(params[1]).toBe('dispatch@lonestar.test');
        expect(params[2]).toMatch(/^[0-9a-f]{32}$/); // fresh capture token
        return { id: COMPANY_ID, name: 'Lone Star Moving Co', contact_email: 'dispatch@lonestar.test', token: params[2] };
      }
      throw new Error(`unexpected db.one: ${sql}`);
    });

    const res = await request(makeApp())
      .post('/api/company/claim')
      .send({ inviteToken: INVITE_TOKEN, name: 'Lone Star Moving Co', contact_email: 'Dispatch@LoneStar.test' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.company).toEqual({ name: 'Lone Star Moving Co' });

    // Invite linked + claimed in the same transaction.
    expect(db.tx).toHaveBeenCalledTimes(1);
    const linkUpdate = db.none.mock.calls.find(([sql]) => /UPDATE mover_invites/.test(sql));
    expect(linkUpdate[0]).toContain("status = 'claimed'");
    expect(linkUpdate[1]).toEqual([INVITE_ROW.id, COMPANY_ID, 'dispatch@lonestar.test']);

    // Magic link stored HASHED, and the raw token only in the welcome email.
    const tokenInsert = db.none.mock.calls.find(([sql]) => /INSERT INTO company_auth_tokens/.test(sql));
    expect(tokenInsert[0]).toContain("'magic_link'");
    const welcome = mockSendMail.mock.calls.find(([m]) => m.to === 'dispatch@lonestar.test')[0];
    const raw = welcome.text.match(/\/mover\/login\?token=(cmp_[0-9a-f]{64})/)[1];
    expect(tokenInsert[1][1]).toBe(sha256(raw));
    expect(welcome.text).toContain(INVITE_ROW.share_token_or_url); // pending doc rides along

    // The inviting customer hears their invite landed.
    const notify = mockSendMail.mock.calls.find(([m]) => m.to === 'customer@example.com')[0];
    expect(notify.subject).toBe('Lone Star Moving Co joined Nexus Moves');
  });

  test('used/unknown token (atomic claim loses) → 410, NO company created', async () => {
    wireTx();
    db.oneOrNone.mockResolvedValue(null); // FOR UPDATE select found nothing claimable
    const res = await request(makeApp())
      .post('/api/company/claim')
      .send({ inviteToken: INVITE_TOKEN, name: 'Lone Star Moving Co', contact_email: 'dispatch@lonestar.test' });
    expect(res.status).toBe(410);
    expect(db.one).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('garbage token shape → 400 without touching the DB', async () => {
    const res = await request(makeApp())
      .post('/api/company/claim')
      .send({ inviteToken: 'cmp_wrong-kind-of-token', name: 'X Movers', contact_email: 'x@y.zz' });
    expect(res.status).toBe(400);
    expect(db.tx).not.toHaveBeenCalled();
  });

  test('missing name / bad email → 400 without claiming anything', async () => {
    const noName = await request(makeApp())
      .post('/api/company/claim')
      .send({ inviteToken: INVITE_TOKEN, name: '', contact_email: 'x@y.zz' });
    expect(noName.status).toBe(400);

    const badEmail = await request(makeApp())
      .post('/api/company/claim')
      .send({ inviteToken: INVITE_TOKEN, name: 'X Movers', contact_email: 'nope' });
    expect(badEmail.status).toBe(400);
    expect(db.tx).not.toHaveBeenCalled();
  });
});

// ── overview pendingDocs ──────────────────────────────────────────────────────

describe('GET /api/company/overview pendingDocs (#100 addition)', () => {
  test('lists invite-attached share docs for the company; guest emails are hidden', async () => {
    // Company session: authenticateCompany joins company_auth_tokens.
    db.oneOrNone.mockImplementation(async (sql) => {
      if (/FROM company_auth_tokens t/.test(sql)) {
        return {
          id: COMPANY_ID, name: 'Acme Movers', contact_email: 'ops@acme.test',
          token: 'acmetoken', is_active: true, created_at: '2026-07-01T00:00:00Z',
        };
      }
      return null;
    });
    db.one.mockResolvedValue({ sessions_total: 0, sessions_completed: 0, from_widget: 0 });
    db.any.mockImplementation(async (sql, params) => {
      if (/FROM mover_invites mi/.test(sql)) {
        expect(params[0]).toBe(COMPANY_ID); // scoped to the session company
        return [
          { share_token_or_url: 'https://app.test/share/sh-1', created_at: '2026-08-18T10:00:00Z', customer_email: 'customer@example.com' },
          { share_token_or_url: 'https://app.test/share/sh-2', created_at: '2026-08-10T10:00:00Z', customer_email: 'capture+x@guest.invalid' },
        ];
      }
      return [];
    });

    const res = await request(makeApp())
      .get('/api/company/overview')
      .set('Authorization', `Bearer ${companyAuthService.generateCompanyToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.pendingDocs).toEqual([
      { shareUrl: 'https://app.test/share/sh-1', customerEmail: 'customer@example.com', receivedAt: '2026-08-18T10:00:00Z' },
      { shareUrl: 'https://app.test/share/sh-2', customerEmail: null, receivedAt: '2026-08-10T10:00:00Z' },
    ]);
  });
});

// ── admin invite metrics ──────────────────────────────────────────────────────

describe('GET /api/capture/invites (research metrics)', () => {
  test('non-admin user → 403, no data touched', async () => {
    mockCurrentUser = { user_id: USER_ID, email: 'customer@example.com', is_admin: false };
    const res = await request(makeApp()).get('/api/capture/invites');
    expect(res.status).toBe(403);
    expect(db.one).not.toHaveBeenCalled();
  });

  test('admin gets counts by status + recent invites', async () => {
    mockCurrentUser = { user_id: USER_ID, email: 'owen@example.com', is_admin: true };
    db.one.mockResolvedValue({ total: 3, sent: 1, claimed: 1, failed: 1 });
    db.any.mockResolvedValue([
      {
        id: 'i-1', business_name: 'Lone Star Moving Co', place_ref: 'place-lone',
        status: 'claimed', company_id: COMPANY_ID, company_name: 'Lone Star Moving Co',
        created_at: '2026-08-18T10:00:00Z', claimed_at: '2026-08-18T12:00:00Z',
      },
    ]);

    const res = await request(makeApp()).get('/api/capture/invites');
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ total: 3, sent: 1, claimed: 1, failed: 1 });
    expect(res.body.invites[0]).toEqual({
      id: 'i-1', businessName: 'Lone Star Moving Co', placeRef: 'place-lone',
      status: 'claimed', companyId: COMPANY_ID, companyName: 'Lone Star Moving Co',
      createdAt: '2026-08-18T10:00:00Z', claimedAt: '2026-08-18T12:00:00Z',
    });
  });
});
