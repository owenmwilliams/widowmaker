'use strict';

/**
 * Arbiter review on #52: /api/client-events did up to 100 sequential INSERTs
 * per batch instead of one multi-row insert, and had no cap on client-
 * supplied metadata size.
 */

const express = require('express');
const request = require('supertest');

describe('POST /api/client-events', () => {
  let dbNone;
  let app;

  beforeEach(() => {
    jest.resetModules();
    dbNone = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../services/infra/db', () => ({ db: { none: dbNone } }));

    const router = require('../../routes/api/clientEvents');
    app = express();
    // authenticate() short-circuits when req.user is already set — bypasses
    // the DB-backed token lookup entirely, so no auth mocking needed beyond this.
    app.use((req, _res, next) => { req.user = { user_id: 'user-1' }; next(); });
    app.use('/api/client-events', router);
  });

  afterEach(() => {
    jest.dontMock('../../services/infra/db');
  });

  test('sends one multi-row INSERT for a batch of events, not one per event', async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({ type: 'upload_started', sessionId: `s${i}` }));
    const res = await request(app).post('/api/client-events').send({ events });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, inserted: 5 });
    expect(dbNone).toHaveBeenCalledTimes(1); // one round-trip, not 5
    const [sql, params] = dbNone.mock.calls[0];
    expect(sql).toMatch(/VALUES \(\$1,.*\), \(\$8,/); // 7 params/row, second row starts at $8
    expect(params).toHaveLength(5 * 7);
  });

  test('drops unknown event types silently (no insert for them)', async () => {
    const res = await request(app).post('/api/client-events').send({
      events: [{ type: 'not_a_real_event' }, { type: 'upload_started' }],
    });
    expect(res.body.inserted).toBe(1);
  });

  test('caps oversized metadata instead of inserting it', async () => {
    const hugeMetadata = { blob: 'x'.repeat(5000) };
    await request(app).post('/api/client-events').send({
      events: [{ type: 'turn_failed', metadata: hugeMetadata }],
    });
    const [, params] = dbNone.mock.calls[0];
    // metadata is the 5th column of the single row: user, session, type, clientAt, metadata, ...
    expect(params[4]).toBeNull();
  });

  test('keeps metadata under the cap', async () => {
    await request(app).post('/api/client-events').send({
      events: [{ type: 'turn_failed', metadata: { error: 'small' } }],
    });
    const [, params] = dbNone.mock.calls[0];
    expect(params[4]).toBe(JSON.stringify({ error: 'small' }));
  });

  test('rejects a batch with no events', async () => {
    const res = await request(app).post('/api/client-events').send({ events: [] });
    expect(res.status).toBe(400);
  });

  test('rejects a batch over 100 events', async () => {
    const events = Array.from({ length: 101 }, () => ({ type: 'upload_started' }));
    const res = await request(app).post('/api/client-events').send({ events });
    expect(res.status).toBe(400);
  });

  test('returns inserted: 0 without touching the DB when every event is invalid', async () => {
    const res = await request(app).post('/api/client-events').send({ events: [{ type: 'bogus' }] });
    expect(res.body).toEqual({ success: true, inserted: 0 });
    expect(dbNone).not.toHaveBeenCalled();
  });
});
