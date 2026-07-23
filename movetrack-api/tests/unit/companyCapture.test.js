'use strict';

/**
 * Route-level tests for the company capture-link endpoints (#96). Proves:
 *   • Landing lookup returns the display name ONLY; unknown/inactive → 404.
 *   • /start validates email + consent, creates a guest user flagged
 *     source='company_link' with a SYNTHETIC email (never the typed-in one —
 *     no-OTP account takeover guard), and returns a working guest JWT.
 *   • Guest endpoints reject missing/garbage/expired tokens and expired
 *     sessions; caps come back as 403 with human copy.
 *   • Scan jobs are delegated with the guest userId, the typed room as
 *     roomHint, and a 'capture:{sessionId}:' idempotency key; a completed
 *     job auto-commits its items exactly once (markConsumed latch).
 *   • /complete creates the share, marks the session, emails the company —
 *     and tolerates email failure (share is the source of truth).
 *   • Admin company mint/list is is_admin-gated.
 *
 * Router mounted in isolation with db/auth/services/nodemailer mocked, so it
 * runs DB-free and SMTP-free in CI (quoteLeads/rescanRecommit pattern).
 */

jest.mock('../../services/infra/db', () => ({
  db: { any: jest.fn(), one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn(), result: jest.fn() },
}));

let mockUser; // for the admin endpoints' authenticate
jest.mock('../../services/infra/authService', () => {
  const jwt = require('jsonwebtoken');
  const SECRET = 'test-capture-secret';
  return {
    authenticate: (req, res, next) => {
      if (!mockUser) return res.status(401).json({ error: 'Unauthorized' });
      req.user = mockUser;
      next();
    },
    // Mirror the real implementations (same claim shape + guest gate) so the
    // guest-auth tests exercise real JWT verification, not a stub's opinion.
    signGuestCaptureToken: ({ captureSessionId, userId }, opts = {}) =>
      jwt.sign({ captureSessionId, userId, guest: true }, SECRET, { expiresIn: opts.expiresIn || '30d' }),
    verifyGuestCaptureToken: (token) => {
      try {
        const d = jwt.verify(token, SECRET);
        return d && d.guest === true && d.captureSessionId && d.userId ? d : null;
      } catch {
        return null;
      }
    },
    __SECRET: SECRET,
  };
});

// No 429s / timer state in unit tests — the limiter configs are exercised in prod.
jest.mock('../../config/rateLimits', () => ({
  captureLimiter: (req, res, next) => next(),
  captureStartLimiter: (req, res, next) => next(),
}));

jest.mock('../../services/infra/mediaAssetService', () => ({
  reserveUpload: jest.fn(),
}));

jest.mock('../../services/inventory/scanJobService', () => ({
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  isAllowedMediaUrl: jest.fn(),
  createJob: jest.fn(),
  getJob: jest.fn(),
  markConsumed: jest.fn(),
  toDTO: jest.fn((row) => ({ id: row.id, status: row.status, result: row.result || null, roomHint: row.room_hint || null })),
}));

jest.mock('../../services/inventory/inventoryMutationService', () => ({
  addItem: jest.fn(),
}));

jest.mock('../../services/inventory/shareService', () => ({
  createShare: jest.fn(),
  shareUrl: jest.fn((t) => `https://app.example/share/${t}`),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { db } = require('../../services/infra/db');
const authService = require('../../services/infra/authService');
const mediaAssetService = require('../../services/infra/mediaAssetService');
const scanJobs = require('../../services/inventory/scanJobService');
const inventoryMutation = require('../../services/inventory/inventoryMutationService');
const shareService = require('../../services/inventory/shareService');
const router = require('../../routes/api/companyCapture');

const BASE = '/api/capture';
const TOKEN = 'abc123companytoken';
const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const GUEST_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const JOB_ID = '99999999-8888-7777-6666-555555555555';

const COMPANY_ROW = { id: 'co-1', name: 'Acme Movers', contact_email: 'ops@acme.test', token: TOKEN };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(BASE, router);
  return app;
}

/** The joined session+company row guestAuth loads. */
function sessionRow(overrides = {}) {
  return {
    id: SESSION_ID,
    company_id: 'co-1',
    customer_email: 'customer@example.com',
    user_id: GUEST_ID,
    status: 'active',
    consent: true,
    videos_count: 2,
    bytes_total: 1000,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    company_name: 'Acme Movers',
    company_contact_email: 'ops@acme.test',
    company_token: TOKEN,
    company_is_active: true,
    ...overrides,
  };
}

/** Route db.oneOrNone by SQL shape; individual tests override pieces. */
function wireDb({ session = sessionRow(), company = COMPANY_ROW, captureUpdate = { videos_count: 3, bytes_total: 2000 }, existingShare = null } = {}) {
  db.oneOrNone.mockImplementation(async (sql) => {
    if (/FROM company_capture_sessions s/.test(sql)) return session;
    if (/^UPDATE company_capture_sessions/.test(sql.trim())) return captureUpdate;
    if (/FROM company_capture_sessions WHERE id/.test(sql)) return session;
    if (/FROM companies/.test(sql)) return company;
    if (/FROM inventory_shares/.test(sql)) return existingShare;
    throw new Error(`unexpected oneOrNone: ${sql}`);
  });
}

function guestToken(claims = {}) {
  return authService.signGuestCaptureToken({ captureSessionId: SESSION_ID, userId: GUEST_ID, ...claims });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  db.none.mockResolvedValue(undefined);
  mockSendMail.mockResolvedValue({ accepted: ['x'] });
  process.env.SMTP_USER = 'apikey';
  process.env.SMTP_PASS = 'test-smtp-pass';
});

afterAll(() => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

// ── Landing ───────────────────────────────────────────────────────────────────

describe('GET /api/capture/:companyToken', () => {
  test('active company → display name only, nothing else leaks', async () => {
    wireDb();
    const res = await request(makeApp()).get(`${BASE}/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Acme Movers' }); // exact — no contact_email/id
  });

  test('unknown or inactive token → 404', async () => {
    wireDb({ company: null });
    const res = await request(makeApp()).get(`${BASE}/nope`);
    expect(res.status).toBe(404);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

describe('POST /api/capture/:companyToken/start', () => {
  test('malformed email → 400, nothing created', async () => {
    wireDb();
    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/start`).send({ email: 'not-an-email', consent: true });
    expect(res.status).toBe(400);
    expect(db.one).not.toHaveBeenCalled();
  });

  test('missing consent → 400', async () => {
    wireDb();
    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/start`).send({ email: 'a@b.co' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/consent/i);
  });

  test('valid start → guest user (synthetic email, company_link source), session, working JWT', async () => {
    wireDb();
    db.one.mockImplementation(async (sql, params) => {
      if (/INSERT INTO users/.test(sql)) {
        expect(sql).toContain("'company_link'");
        // NEVER the typed-in email — synthetic guest address.
        expect(params[0]).toMatch(/^capture\+.+@guest\.invalid$/);
        return { user_id: GUEST_ID };
      }
      if (/INSERT INTO locations/.test(sql)) return { id: 42 };
      if (/INSERT INTO company_capture_sessions/.test(sql)) {
        expect(params[1]).toBe('customer@example.com'); // real email on the session row
        expect(params[2]).toBe(GUEST_ID);
        return { id: SESSION_ID, status: 'active', videos_count: 0, bytes_total: 0, expires_at: '2026-08-22T00:00:00Z', created_at: '2026-07-23T00:00:00Z' };
      }
      throw new Error(`unexpected one: ${sql}`);
    });

    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/start`)
      .send({ email: 'Customer@Example.com', consent: true });

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBe(SESSION_ID);
    expect(res.body.company).toEqual({ name: 'Acme Movers' });
    const decoded = authService.verifyGuestCaptureToken(res.body.token);
    expect(decoded).toMatchObject({ captureSessionId: SESSION_ID, userId: GUEST_ID, guest: true });
    // Guest home location + owner permission created
    expect(db.none).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO permissions'), [GUEST_ID, 42]);
  });

  test('unknown company → 404', async () => {
    wireDb({ company: null });
    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/start`).send({ email: 'a@b.co', consent: true });
    expect(res.status).toBe(404);
  });
});

// ── Guest auth ────────────────────────────────────────────────────────────────

describe('guest authentication', () => {
  test('no token → 401', async () => {
    wireDb();
    const res = await request(makeApp()).get(`${BASE}/${TOKEN}/session`);
    expect(res.status).toBe(401);
  });

  test('garbage token → 401', async () => {
    wireDb();
    const res = await request(makeApp()).get(`${BASE}/${TOKEN}/session`)
      .set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  test('expired JWT → 401', async () => {
    wireDb();
    const expired = jwt.sign(
      { captureSessionId: SESSION_ID, userId: GUEST_ID, guest: true },
      authService.__SECRET,
      { expiresIn: '-1h' }
    );
    const res = await request(makeApp()).get(`${BASE}/${TOKEN}/session`)
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  test('a normal (non-guest) JWT shape is rejected', async () => {
    wireDb();
    const normal = jwt.sign({ userId: GUEST_ID, email: 'x@y.z' }, authService.__SECRET, { expiresIn: '1h' });
    const res = await request(makeApp()).get(`${BASE}/${TOKEN}/session`)
      .set('Authorization', `Bearer ${normal}`);
    expect(res.status).toBe(401);
  });

  test('token whose session belongs to another company link → 401', async () => {
    wireDb({ session: sessionRow({ company_token: 'someothertoken' }) });
    const res = await request(makeApp()).get(`${BASE}/${TOKEN}/session`)
      .set('Authorization', `Bearer ${guestToken()}`);
    expect(res.status).toBe(401);
  });

  test('expired session row → 410', async () => {
    wireDb({ session: sessionRow({ expires_at: new Date(Date.now() - 1000).toISOString() }) });
    const res = await request(makeApp()).get(`${BASE}/${TOKEN}/session`)
      .set('Authorization', `Bearer ${guestToken()}`);
    expect(res.status).toBe(410);
  });

  test('valid token → session snapshot for resume', async () => {
    wireDb();
    const res = await request(makeApp()).get(`${BASE}/${TOKEN}/session`)
      .set('Authorization', `Bearer ${guestToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionId: SESSION_ID, status: 'active', company: { name: 'Acme Movers' } });
  });
});

// ── Upload URL + caps ─────────────────────────────────────────────────────────

describe('POST /api/capture/:companyToken/upload-url', () => {
  const good = { mimeType: 'video/mp4', filename: 'kitchen.mp4', byteLength: 10 * 1024 * 1024 };

  test('non-video mime → 400', async () => {
    wireDb();
    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/upload-url`)
      .set('Authorization', `Bearer ${guestToken()}`).send({ ...good, mimeType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  test('video cap exhausted → 403 with human copy', async () => {
    wireDb({ captureUpdate: null, session: sessionRow() });
    // conditional UPDATE misses; the re-read shows the video cap is the reason
    db.oneOrNone.mockImplementation(async (sql) => {
      if (/FROM company_capture_sessions s/.test(sql)) return sessionRow();
      if (/^UPDATE company_capture_sessions/.test(sql.trim())) return null;
      if (/SELECT videos_count/.test(sql)) return { videos_count: 20, bytes_total: 1000 };
      return null;
    });
    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/upload-url`)
      .set('Authorization', `Bearer ${guestToken()}`).send(good);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/20-video/);
    expect(mediaAssetService.reserveUpload).not.toHaveBeenCalled();
  });

  test('single file over 500MB → 403 without touching counters', async () => {
    wireDb();
    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/upload-url`)
      .set('Authorization', `Bearer ${guestToken()}`)
      .send({ ...good, byteLength: 501 * 1024 * 1024 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/500MB/);
  });

  test('happy path → signed PUT from mediaAssetService under the guest user', async () => {
    wireDb();
    mediaAssetService.reserveUpload.mockResolvedValue({
      uploadUrl: 'https://storage.googleapis.com/signed-put',
      url: `https://storage.googleapis.com/movetrack-item-photos/users/${GUEST_ID}/company-capture/x.mp4`,
      gcsPath: `users/${GUEST_ID}/company-capture/x.mp4`,
      mimeType: 'video/mp4',
    });
    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/upload-url`)
      .set('Authorization', `Bearer ${guestToken()}`).send(good);
    expect(res.status).toBe(200);
    expect(res.body.uploadUrl).toBe('https://storage.googleapis.com/signed-put');
    expect(mediaAssetService.reserveUpload).toHaveBeenCalledWith(expect.objectContaining({
      userId: GUEST_ID,
      source: 'company_capture',
      mimeType: 'video/mp4',
    }));
  });

  test('completed session → 403', async () => {
    wireDb({ session: sessionRow({ status: 'completed' }) });
    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/upload-url`)
      .set('Authorization', `Bearer ${guestToken()}`).send(good);
    expect(res.status).toBe(403);
  });
});

// ── Scan jobs ─────────────────────────────────────────────────────────────────

describe('scan jobs (guest)', () => {
  const MEDIA_URL = `https://storage.googleapis.com/movetrack-item-photos/users/${GUEST_ID}/company-capture/x.mp4`;

  test('mediaUrl outside the guest prefix → 400', async () => {
    wireDb();
    scanJobs.isAllowedMediaUrl.mockReturnValue(false);
    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/scan-jobs`)
      .set('Authorization', `Bearer ${guestToken()}`)
      .send({ mediaUrl: 'https://evil.example/x.mp4', mimeType: 'video/mp4', roomHint: 'Kitchen' });
    expect(res.status).toBe(400);
    expect(scanJobs.createJob).not.toHaveBeenCalled();
  });

  test('create delegates with guest userId, roomHint, capture idempotency key', async () => {
    wireDb();
    scanJobs.isAllowedMediaUrl.mockReturnValue(true);
    scanJobs.createJob.mockResolvedValue({ job: { id: JOB_ID, status: 'queued', room_hint: 'Kitchen' }, created: true });

    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/scan-jobs`)
      .set('Authorization', `Bearer ${guestToken()}`)
      .send({ mediaUrl: MEDIA_URL, mimeType: 'video/mp4', roomHint: 'Kitchen', idempotencyKey: 'room-kitchen-1' });

    expect(res.status).toBe(201);
    expect(scanJobs.createJob).toHaveBeenCalledWith(GUEST_ID, expect.objectContaining({
      mediaUrl: MEDIA_URL,
      roomHint: 'Kitchen',
      idempotencyKey: `capture:${SESSION_ID}:room-kitchen-1`,
      plan: 'basic',
    }));
  });

  test('missing roomHint → 400 (guests name the room they filmed)', async () => {
    wireDb();
    scanJobs.isAllowedMediaUrl.mockReturnValue(true);
    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/scan-jobs`)
      .set('Authorization', `Bearer ${guestToken()}`)
      .send({ mediaUrl: MEDIA_URL, mimeType: 'video/mp4' });
    expect(res.status).toBe(400);
  });

  test('poll of a freshly completed job auto-commits items exactly once', async () => {
    wireDb();
    const items = [
      { name: 'Sofa', quantity: 1, room: 'Living Room', weightLbs: 120 },
      { name: 'Lamp', quantity: 2, room: null },
    ];
    scanJobs.getJob.mockResolvedValue({ id: JOB_ID, status: 'completed', consumed_at: null, room_hint: 'Living Room', result: { items } });
    scanJobs.markConsumed.mockResolvedValue(true); // this poll wins the latch
    inventoryMutation.addItem.mockResolvedValue({ success: true });

    const res = await request(makeApp()).get(`${BASE}/${TOKEN}/scan-jobs/${JOB_ID}`)
      .set('Authorization', `Bearer ${guestToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.committedCount).toBe(2);
    expect(inventoryMutation.addItem).toHaveBeenCalledTimes(2);
    expect(inventoryMutation.addItem).toHaveBeenCalledWith(GUEST_ID, expect.objectContaining({
      name: 'Lamp', room_name: 'Living Room', // falls back to the job's roomHint
    }));
  });

  test('poll of an already-consumed job commits nothing', async () => {
    wireDb();
    scanJobs.getJob.mockResolvedValue({ id: JOB_ID, status: 'completed', consumed_at: '2026-07-23T00:00:00Z', result: { items: [{ name: 'Sofa' }] } });
    const res = await request(makeApp()).get(`${BASE}/${TOKEN}/scan-jobs/${JOB_ID}`)
      .set('Authorization', `Bearer ${guestToken()}`);
    expect(res.status).toBe(200);
    expect(scanJobs.markConsumed).not.toHaveBeenCalled();
    expect(inventoryMutation.addItem).not.toHaveBeenCalled();
  });

  test('malformed job id → 400', async () => {
    wireDb();
    const res = await request(makeApp()).get(`${BASE}/${TOKEN}/scan-jobs/not-a-uuid`)
      .set('Authorization', `Bearer ${guestToken()}`);
    expect(res.status).toBe(400);
  });
});

// ── Complete ──────────────────────────────────────────────────────────────────

describe('POST /api/capture/:companyToken/complete', () => {
  test('creates share, marks session completed, emails company + customer', async () => {
    wireDb();
    shareService.createShare.mockResolvedValue({ token: 'sh-tok', url: 'https://app.example/share/sh-tok' });

    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/complete`)
      .set('Authorization', `Bearer ${guestToken()}`).send({});

    expect(res.status).toBe(200);
    expect(res.body.shareUrl).toBe('https://app.example/share/sh-tok');
    expect(shareService.createShare).toHaveBeenCalledWith(GUEST_ID, expect.any(Object));
    expect(db.none).toHaveBeenCalledWith(expect.stringContaining("status = 'completed'"), [SESSION_ID]);

    expect(mockSendMail).toHaveBeenCalledTimes(2);
    const companyMail = mockSendMail.mock.calls.find(([m]) => m.to === 'ops@acme.test')[0];
    expect(companyMail.subject).toContain('customer@example.com');
    expect(companyMail.text).toContain('https://app.example/share/sh-tok');
    const customerMail = mockSendMail.mock.calls.find(([m]) => m.to === 'customer@example.com')[0];
    expect(customerMail.text).toContain('https://app.example/share/sh-tok');
  });

  test('email failure NEVER fails the request — share already created', async () => {
    wireDb();
    shareService.createShare.mockResolvedValue({ token: 'sh-tok', url: 'https://app.example/share/sh-tok' });
    mockSendMail.mockRejectedValue(new Error('smtp down'));

    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/complete`)
      .set('Authorization', `Bearer ${guestToken()}`).send({});

    expect(res.status).toBe(200);
    expect(res.body.shareUrl).toBe('https://app.example/share/sh-tok');
  });

  test('already-completed session returns the existing share without re-emailing', async () => {
    wireDb({ session: sessionRow({ status: 'completed' }), existingShare: { token: 'old-tok' } });

    const res = await request(makeApp()).post(`${BASE}/${TOKEN}/complete`)
      .set('Authorization', `Bearer ${guestToken()}`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ shareUrl: 'https://app.example/share/old-tok', alreadyCompleted: true });
    expect(shareService.createShare).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

// ── Admin ─────────────────────────────────────────────────────────────────────

describe('admin company endpoints', () => {
  test('POST /companies without admin → 403', async () => {
    mockUser = { user_id: 'u-1', email: 'pro@example.com', is_admin: false };
    const res = await request(makeApp()).post(`${BASE}/companies`)
      .send({ name: 'Acme Movers', contact_email: 'ops@acme.test' });
    expect(res.status).toBe(403);
  });

  test('POST /companies as admin → 201 with a url-safe token + capture URL', async () => {
    mockUser = { user_id: 'u-admin', email: 'owen@we3kings.dev', is_admin: true };
    db.one.mockImplementation(async (sql, params) => {
      expect(sql).toContain('INSERT INTO companies');
      expect(params[2]).toMatch(/^[a-f0-9]{32}$/); // uuid, dashes stripped
      return { id: 'co-9', name: params[0], contact_email: params[1], token: params[2], is_active: true, created_at: '2026-07-23T00:00:00Z' };
    });

    const res = await request(makeApp()).post(`${BASE}/companies`)
      .send({ name: 'Acme Movers', contact_email: 'ops@acme.test' });

    expect(res.status).toBe(201);
    expect(res.body.captureUrl).toMatch(new RegExp(`/c/${res.body.token}$`));
  });

  test('POST /companies validates contact_email', async () => {
    mockUser = { user_id: 'u-admin', email: 'owen@we3kings.dev', is_admin: true };
    const res = await request(makeApp()).post(`${BASE}/companies`)
      .send({ name: 'Acme Movers', contact_email: 'nope' });
    expect(res.status).toBe(400);
  });

  test('GET /companies is admin-only', async () => {
    mockUser = { user_id: 'u-1', email: 'user@example.com', is_admin: false };
    const res = await request(makeApp()).get(`${BASE}/companies`);
    expect(res.status).toBe(403);

    mockUser = { user_id: 'u-admin', email: 'owen@we3kings.dev', is_admin: true };
    db.any.mockResolvedValue([{ id: 'co-1', name: 'Acme', contact_email: 'a@b.co', token: 'tok', is_active: true, created_at: 'x', session_count: 3 }]);
    const ok = await request(makeApp()).get(`${BASE}/companies`);
    expect(ok.status).toBe(200);
    expect(ok.body[0]).toMatchObject({ name: 'Acme', sessionCount: 3 });
  });
});
