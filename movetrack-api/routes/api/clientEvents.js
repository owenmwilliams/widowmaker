'use strict';

/**
 * POST /api/client-events
 *
 * Lightweight batched event log for the iOS client. The scan/chat pipeline had
 * zero client-side visibility before this — a failed upload, an SSE timeout, or
 * a discarded review card left no trace anywhere (see
 * docs/notes/beta-scan-reliability-investigation.md Section 5.3 #10). This is
 * NOT a crash reporter — see
 * MoveTrack-iOS/widowmaker/MoveTrack/Services/ClientEventLogger.swift for the
 * follow-up note on full crash/error reporting (vendor choice left to Owen).
 *
 * Deliberately outside the /api/agents router: client events are not AI calls
 * and must still record (e.g. turn_failed) when a user is over their AI budget.
 *
 * Retention: no cleanup job exists yet — this table grows unbounded like
 * beta_interaction_logs. Fine for the beta's data volume; revisit (a TTL
 * index or a periodic delete-older-than job) before this is on by default
 * for the whole user base.
 */

const express = require('express');
const conn = require('../../services/infra/db');
const db = conn.db;
const { authenticate } = require('../../services/infra/authService');
const { createLogger } = require('../../services/infra/logger');

const log = createLogger({ component: 'client-events' });

const router = express.Router();

const EVENT_TYPES = new Set([
  'upload_started', 'upload_succeeded', 'upload_failed',
  'sse_timeout', 'turn_failed',
  'review_card_shown', 'review_card_committed',
]);

// Metadata is client-supplied freeform JSON — cap it so one malformed/abusive
// batch can't bloat a row (or the query) unboundedly.
const MAX_METADATA_BYTES = 2000;

router.use(authenticate);

router.post('/', express.json(), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  if (events.length === 0) return res.status(400).json({ error: 'events required' });
  if (events.length > 100) return res.status(400).json({ error: 'Too many events in one batch (max 100)' });

  const appVersion = typeof req.body?.appVersion === 'string' ? req.body.appVersion.slice(0, 40) : null;
  const osVersion = typeof req.body?.osVersion === 'string' ? req.body.osVersion.slice(0, 40) : null;

  const rows = [];
  for (const evt of events) {
    if (!evt || typeof evt !== 'object') continue;
    const eventType = String(evt.type || '');
    if (!EVENT_TYPES.has(eventType)) continue;

    const clientAt = evt.clientAt ? new Date(evt.clientAt) : null;
    const sessionId = typeof evt.sessionId === 'string' ? evt.sessionId.slice(0, 200) : null;

    let metadataJson = null;
    if (evt.metadata) {
      const serialized = JSON.stringify(evt.metadata);
      if (Buffer.byteLength(serialized, 'utf8') <= MAX_METADATA_BYTES) {
        metadataJson = serialized;
      } else {
        log.warn('Dropping oversized client-event metadata', { userId, eventType, bytes: Buffer.byteLength(serialized, 'utf8') });
      }
    }

    rows.push([
      userId, sessionId, eventType,
      clientAt && !Number.isNaN(clientAt.getTime()) ? clientAt.toISOString() : null,
      metadataJson, appVersion, osVersion,
    ]);
  }

  if (rows.length === 0) return res.json({ success: true, inserted: 0 });

  // One multi-row INSERT instead of up to 100 sequential round-trips.
  const COLUMNS_PER_ROW = 7;
  const valuePlaceholders = rows.map((_, rowIdx) => {
    const base = rowIdx * COLUMNS_PER_ROW;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7})`;
  }).join(', ');

  try {
    await db.none(
      `INSERT INTO client_events (user_id, session_id, event_type, client_at, metadata, app_version, os_version)
       VALUES ${valuePlaceholders}`,
      rows.flat()
    );
    res.json({ success: true, inserted: rows.length });
  } catch (err) {
    log.error('Failed to insert client events batch', { userId, count: rows.length, error: err.message });
    res.status(500).json({ error: 'Failed to record events' });
  }
});

module.exports = router;
