'use strict';

/**
 * Route-level tests for the quote-shopping lead endpoints (#90). Proves:
 *   • A valid POST persists the lead and returns 200 — even when the owner
 *     notification email throws (best-effort: the row is the source of truth).
 *   • Missing tier / missing or malformed contact_email → 400, nothing persisted.
 *   • GET is admin-only: non-admin (even Pro) gets 403; admin gets the rows.
 *
 * The router is mounted in isolation with db + auth + nodemailer mocked, so
 * this runs DB-free and SMTP-free in CI (rescanRecommit.test.js pattern).
 */

jest.mock('../../services/infra/db', () => ({
  db: { any: jest.fn(), one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn() },
}));

let mockUser; // reassigned per test; the authenticate mock closes over it
jest.mock('../../services/infra/authService', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const request = require('supertest');
const express = require('express');
const { db } = require('../../services/infra/db');
const router = require('../../routes/api/move/quoteLeads');

const BASE = '/api/move/quote-leads';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(BASE, router);
  return app;
}

const LEAD_ROW = { id: 'lead-1', tier: 'premium', status: 'new', created_at: '2026-07-06T00:00:00Z' };

beforeEach(() => {
  mockUser = { user_id: 'user-1', email: 'mover@example.com', is_admin: false };
  db.one.mockReset().mockResolvedValue(LEAD_ROW);
  db.any.mockReset();
  mockSendMail.mockReset().mockResolvedValue({ accepted: ['support@we3kings.dev'] });
  // SMTP creds present → the route builds a (mocked) transporter
  process.env.SMTP_USER = 'apikey';
  process.env.SMTP_PASS = 'test-smtp-pass';
});

afterAll(() => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

describe('POST /api/move/quote-leads', () => {
  test('valid lead persists and returns 200', async () => {
    const res = await request(makeApp()).post(BASE).send({
      tier: 'Premium',
      contact_email: 'mover@example.com',
      move_summary: { origin: 'Austin, TX', destination: 'Denver, CO', itemCount: 42 },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'lead-1', tier: 'premium', status: 'new' });
    expect(db.one).toHaveBeenCalledTimes(1);
    const params = db.one.mock.calls[0][1];
    expect(params[0]).toBe('user-1');                 // user_id from auth, not body
    expect(params[2]).toBe('premium');                // tier normalized to lowercase
    expect(params[3]).toBe('mover@example.com');
    expect(JSON.parse(params[5])).toMatchObject({ itemCount: 42 });
    expect(mockSendMail).toHaveBeenCalledTimes(1);    // owner notified
  });

  test('email failure NEVER fails the request — lead already persisted', async () => {
    mockSendMail.mockRejectedValue(new Error('smtp down'));

    const res = await request(makeApp()).post(BASE).send({
      tier: 'basic',
      contact_email: 'mover@example.com',
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('lead-1');
    expect(db.one).toHaveBeenCalledTimes(1);
  });

  test('missing tier → 400, nothing persisted', async () => {
    const res = await request(makeApp()).post(BASE).send({
      contact_email: 'mover@example.com',
    });
    expect(res.status).toBe(400);
    expect(db.one).not.toHaveBeenCalled();
  });

  test('missing contact_email → 400, nothing persisted', async () => {
    const res = await request(makeApp()).post(BASE).send({ tier: 'basic' });
    expect(res.status).toBe(400);
    expect(db.one).not.toHaveBeenCalled();
  });

  test('malformed contact_email → 400', async () => {
    const res = await request(makeApp()).post(BASE).send({
      tier: 'basic',
      contact_email: 'not-an-email',
    });
    expect(res.status).toBe(400);
    expect(db.one).not.toHaveBeenCalled();
  });

  test('db failure surfaces as 500 (no fake success)', async () => {
    db.one.mockRejectedValue(new Error('insert failed'));
    const res = await request(makeApp()).post(BASE).send({
      tier: 'basic',
      contact_email: 'mover@example.com',
    });
    expect(res.status).toBe(500);
    expect(mockSendMail).not.toHaveBeenCalled(); // no notification for a lead that didn't land
  });
});

describe('GET /api/move/quote-leads — admin gate', () => {
  test('non-admin (even Pro) is rejected with 403', async () => {
    mockUser = { user_id: 'user-1', email: 'pro@example.com', plan: 'pro', is_admin: false };
    const res = await request(makeApp()).get(BASE);
    expect(res.status).toBe(403);
    expect(db.any).not.toHaveBeenCalled();
  });

  test('admin gets the lead rows', async () => {
    mockUser = { user_id: 'admin-1', email: 'owen@we3kings.dev', is_admin: true };
    const rows = [
      { id: 'lead-2', tier: 'white glove', contact_email: 'a@b.co', status: 'new' },
      { id: 'lead-1', tier: 'premium', contact_email: 'c@d.co', status: 'new' },
    ];
    db.any.mockResolvedValue(rows);

    const res = await request(makeApp()).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(db.any).toHaveBeenCalledTimes(1);
  });
});
