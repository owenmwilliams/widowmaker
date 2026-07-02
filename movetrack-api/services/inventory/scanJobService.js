'use strict';

/**
 * scanJobService.js
 *
 * Durable scan jobs (issue #42 Phase 2). A photo/video scan used to live
 * entirely inside one SSE HTTP request; a dropped connection, app
 * backgrounding, or an API restart lost it. Here each scan is a scan_jobs row
 * created when the client registers its uploaded media, processed via a
 * Cloud Tasks push queue, and read back by the client, which materializes the
 * review card from `result` (poll or reconnect).
 *
 * Execution model (arbiter decision on #49): Cloud Tasks POSTs the job id to
 * an OIDC-verified internal endpoint, so ALL processing runs inside request
 * context — no Cloud Run CPU-throttling of background work, no always-warm
 * instance. Without a configured queue (local dev) jobs process inline.
 *
 * Idempotent processing per attempt (Cloud Tasks redelivers until 2xx):
 *  - claims are atomic: `queued`, or `processing` with a lease older than
 *    LEASE_SECONDS (a live attempt heartbeats updated_at every minute, so a
 *    stale lease means the attempt died);
 *  - terminal updates are guarded with `WHERE status = 'processing'` so a
 *    late loser can never flip a completed/failed job;
 *  - a retryable failure re-queues the row and returns 'retry' (the endpoint
 *    maps it to HTTP 500 so Cloud Tasks redelivers); at MAX_ATTEMPTS the job
 *    fails explicitly.
 */

const conn = require('../infra/db');
const db = conn.db;
const gcs = require('../infra/gcsService');
const workflow = require('./mediaInventoryWorkflowService');
const metrics = require('../infra/metricsService');

const MAX_ATTEMPTS = 2;
const LEASE_SECONDS = 300;        // silence this long = the attempt is dead
const LEASE_TOUCH_MS = 60_000;    // live attempts heartbeat once a minute

const numOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Scan media must live in this app's bucket under the requesting user's
 * prefix — rejects cross-user reads and SSRF-style arbitrary URLs.
 * TODO(#42 final rebase): delegate to Pathway A's mediaDownloadService once
 * #51 is on main, which owns URL validation + authenticated GCS reads.
 */
function isAllowedMediaUrl(url, userId) {
  return typeof url === 'string'
    && url.startsWith(`https://storage.googleapis.com/${gcs.BUCKET}/users/${userId}/`);
}

/**
 * Derive a room hint from the user's caption when no explicit hint was sent.
 * Captions in the scan flow are usually the room ("dining room", "Garage") —
 * accept only short, name-shaped captions so a chatty sentence never becomes
 * a room label. The hint feeds the vision prompt ("These frames are the
 * "<room>"") and the review card's default room, which is what keeps scanned
 * items out of "Unsorted".
 */
function roomFromCaption(caption) {
  const text = String(caption || '').trim();
  if (!text || text.length > 40) return null;
  if (/[.?!,;:]/.test(text)) return null;
  if (text.split(/\s+/).length > 4) return null;
  return text;
}

/**
 * Map raw workflow items into the camelCase review-card shape — the same
 * mapping censusAgent uses for its `detected_items` SSE event, so the client
 * decodes a job result and a live event identically.
 */
function toReviewResult(rawItems, mediaKind, roomHint) {
  const items = (Array.isArray(rawItems) ? rawItems : []).map((it) => ({
    name: it.name || 'Item',
    quantity: Number.isFinite(it.quantity) && it.quantity > 0 ? Math.floor(it.quantity) : 1,
    room: it.room || roomHint || null,
    pictureUrl: it.picture_url || null,
    weightLbs: numOrNull(it.weight_lbs),
    lengthIn: numOrNull(it.length_in),
    widthIn: numOrNull(it.width_in),
    heightIn: numOrNull(it.height_in),
    material: it.material || null,
    fragile: !!it.fragile,
    confidence: numOrNull(it.confidence),
  }));
  return { mediaKind, room: roomHint || null, items };
}

/** The subset of a job row the client sees. */
function toDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    mediaKind: row.media_kind,
    mediaUrl: row.media_url,
    roomHint: row.room_hint,
    caption: row.caption,
    result: row.result || null,
    error: row.error || null,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    consumedAt: row.consumed_at,
  };
}

// ── Cloud Tasks enqueue ───────────────────────────────────────────────────────

let tasksClient = null;

function tasksConfig() {
  const queue = process.env.SCAN_TASKS_QUEUE;                 // projects/…/locations/…/queues/scan-jobs
  const baseUrl = process.env.SCAN_TASKS_TARGET_BASE_URL;     // this API's own public URL
  const serviceAccount = process.env.SCAN_TASKS_SERVICE_ACCOUNT;
  if (!queue || !baseUrl || !serviceAccount) return null;
  const url = `${baseUrl.replace(/\/+$/, '')}/internal/scan-jobs/process`;
  return { queue, url, serviceAccount };
}

/**
 * Enqueue processing for a job. With Cloud Tasks configured, creates an HTTP
 * task carrying an OIDC token (verified by the internal endpoint). Without it
 * (local dev), processes inline on the next tick so the flow still works —
 * in production a missing config is logged loudly since inline processing
 * reintroduces the CPU-throttling failure this design removes.
 */
async function enqueueProcessing(jobId) {
  const cfg = tasksConfig();
  if (!cfg) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[scanJobs] SCAN_TASKS_* env not configured — processing inline (NOT durable under CPU throttling)');
    }
    setImmediate(() => {
      processJob(jobId).catch((err) => console.error(`[scanJobs] inline processing failed for ${jobId}:`, err.message));
    });
    return 'inline';
  }
  if (!tasksClient) {
    const { CloudTasksClient } = require('@google-cloud/tasks');
    tasksClient = new CloudTasksClient();
  }
  await tasksClient.createTask({
    parent: cfg.queue,
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: cfg.url,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
        oidcToken: { serviceAccountEmail: cfg.serviceAccount, audience: cfg.url },
      },
      // Match the Cloud Run request timeout so an attempt is never cut off
      // by the queue before the server gives up on it.
      dispatchDeadline: { seconds: 600 },
    },
  });
  return 'queued';
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Resolve which conversation a scan belongs to: the client-supplied session
 * (ownership-checked), else the user's active nexus session, else a fresh
 * one — so the scan is never orphaned from the transcript.
 */
async function resolveSessionId(userId, sessionId) {
  if (sessionId && UUID_RE.test(String(sessionId))) {
    const owned = await db.oneOrNone(
      `SELECT id FROM nexus_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    if (owned) return owned.id;
  }
  const active = await db.oneOrNone(
    `SELECT id FROM nexus_sessions
     WHERE user_id = $1 AND is_active = TRUE AND session_type = 'nexus'
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );
  if (active) return active.id;
  const fresh = await db.one(
    `INSERT INTO nexus_sessions (user_id, session_type) VALUES ($1, 'nexus') RETURNING id`,
    [userId]
  );
  return fresh.id;
}

/**
 * Create a queued scan job and enqueue its processing. Idempotent per
 * (user, idempotencyKey) among unconsumed jobs: a retry after a timeout or
 * relaunch returns the in-flight/unseen job instead of scanning twice, while
 * a deliberate rescan after the previous result was acknowledged (consumed)
 * creates a fresh job.
 */
async function createJob(userId, { mediaUrl, mimeType = null, sessionId = null, roomHint = null, caption = null, idempotencyKey = null, plan = 'basic' }) {
  if (!userId || !mediaUrl) throw new Error('userId and mediaUrl are required');
  const mediaKind = String(mimeType || '').startsWith('video') ? 'video' : 'photo';

  let resolvedSessionId = null;
  try {
    resolvedSessionId = await resolveSessionId(userId, sessionId);
  } catch (err) {
    console.error('[scanJobs] session resolution failed (job proceeds unlinked):', err.message);
  }

  const row = await db.one(
    `INSERT INTO scan_jobs (user_id, session_id, idempotency_key, media_url, mime_type, media_kind, room_hint, caption, plan)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND consumed_at IS NULL
       DO UPDATE SET updated_at = NOW()
     RETURNING *, (xmax = 0) AS _inserted`,
    [userId, resolvedSessionId, idempotencyKey, mediaUrl, mimeType, mediaKind, roomHint, caption, plan]
  );
  const created = row._inserted === true;
  delete row._inserted;

  if (created) {
    // The scan is part of the conversation: persist the user's media message
    // so the transcript (and later the agent) can see the scan happened —
    // same shape as the orchestrator's user rows.
    if (row.session_id) {
      try {
        await db.none(
          `INSERT INTO nexus_messages (session_id, role, content, attachments)
           VALUES ($1, 'user', $2, $3)`,
          [row.session_id, caption || '', JSON.stringify([{ url: mediaUrl, mimeType }])]
        );
      } catch (err) {
        console.error(`[scanJobs] transcript row failed for ${row.id}:`, err.message);
      }
    }
    try {
      await enqueueProcessing(row.id);
    } catch (err) {
      // The job row is durable; the stale-queued sweep in recoverStaleJobs
      // will re-enqueue it, so surface but don't fail the create.
      console.error(`[scanJobs] enqueue failed for ${row.id}:`, err.message);
    }
  }
  return { job: row, created };
}

async function getJob(userId, jobId) {
  return db.oneOrNone(
    `SELECT * FROM scan_jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId]
  );
}

/**
 * Jobs the client hasn't acknowledged yet — completed-or-failed within the
 * last 24h and not consumed. Used on reconnect/app-relaunch so scans that
 * finished while the app was gone still surface their review cards.
 */
async function listUnconsumed(userId) {
  return db.manyOrNone(
    `SELECT * FROM scan_jobs
     WHERE user_id = $1 AND consumed_at IS NULL
       AND status IN ('completed', 'failed')
       AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at ASC`,
    [userId]
  );
}

async function markConsumed(userId, jobId) {
  const result = await db.result(
    `UPDATE scan_jobs SET consumed_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND consumed_at IS NULL`,
    [jobId, userId]
  );
  return result.rowCount > 0;
}

// ── Processing (invoked from the internal endpoint / dev inline) ──────────────

/**
 * Atomically claim a job for this attempt: it must be queued, or processing
 * with a dead lease. Returns null when the job is terminal or a live attempt
 * holds it — the caller acks without work (idempotent redelivery).
 */
async function claimJob(jobId) {
  return db.oneOrNone(
    `UPDATE scan_jobs
     SET status = 'processing', attempts = attempts + 1,
         started_at = COALESCE(started_at, NOW()), updated_at = NOW()
     WHERE id = $1 AND (
       status = 'queued'
       OR (status = 'processing' AND updated_at < NOW() - INTERVAL '${LEASE_SECONDS} seconds')
     )
     RETURNING *`,
    [jobId]
  );
}

async function setStage(jobId, stage) {
  await db.none(
    `UPDATE scan_jobs SET stage = $2, updated_at = NOW() WHERE id = $1 AND status = 'processing'`,
    [jobId, stage]
  );
}

/**
 * Run one claimed job. Returns 'completed', 'failed' (terminal, ack the
 * task), or 'retry' (re-queued; the endpoint returns 500 so Cloud Tasks
 * redelivers). Heartbeats the lease while running so siblings can tell a
 * live attempt from a dead one.
 */
async function runClaimedJob(job) {
  const lease = setInterval(() => {
    db.none(
      `UPDATE scan_jobs SET updated_at = NOW() WHERE id = $1 AND status = 'processing'`,
      [job.id]
    ).catch(() => {});
  }, LEASE_TOUCH_MS);
  lease.unref?.();

  try {
    await setStage(job.id, 'analyzing');
    // Caption flows into the analysis as the room hint when it's name-shaped
    // and no explicit hint was sent (#49 review finding 6).
    const roomHint = job.room_hint || roomFromCaption(job.caption);
    const args = { file_url: job.media_url, mime_type: job.mime_type, room_hint: roomHint };
    const analysis = job.media_kind === 'video'
      ? await workflow.analyzeVideoForInventory(args, job.user_id, job.plan)
      : await workflow.analyzePhotoForInventory({ ...args, mode: 'multi_item' }, job.user_id, job.plan);

    if (!analysis || analysis.success === false) {
      throw new Error(analysis?.error || 'Scan analysis failed');
    }
    // A parse error with nothing recovered is a failure, not "0 items found" —
    // a wrong-but-confident empty result costs more trust than an honest error.
    const rawItems = analysis.items || (analysis.item ? [analysis.item] : []);
    if (rawItems.length === 0 && analysis.parseError) {
      throw new Error(`Scan output could not be parsed: ${analysis.parseError}`);
    }

    const result = toReviewResult(rawItems, job.media_kind, roomHint);
    const updated = await db.result(
      `UPDATE scan_jobs SET status = 'completed', stage = 'done', result = $2,
         error = NULL, finished_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'processing'`,
      [job.id, JSON.stringify(result)]
    );
    if (updated.rowCount === 0) {
      // A sibling finished (or recovery re-ran) this job first — never
      // overwrite a terminal state.
      console.warn(`[scanJobs] job ${job.id} finished elsewhere; discarding this attempt's result`);
      return 'skipped';
    }
    console.log(`[scanJobs] job ${job.id} completed: ${result.items.length} items (${job.media_kind})`);
    // Telemetry parity with the agent path: one interaction row per finished
    // scan (logInteraction is non-fatal by design).
    await metrics.logInteraction({
      userId: job.user_id,
      sessionId: job.session_id,
      timing: { totalMs: Date.now() - new Date(job.started_at || job.created_at).getTime(), visionMs: analysis._visionMs || null },
      context: {
        hadAttachments: true,
        attachmentCount: 1,
        attachmentTypes: [job.mime_type || job.media_kind],
        toolCalls: [`scan_job:${job.media_kind}`],
      },
      vision: {
        detectedItemCount: analysis._detectedItemCount ?? result.items.length,
        avgConfidence: analysis._avgConfidence || null,
        minConfidence: analysis._minConfidence || null,
        provider: analysis._visionProvider || null,
      },
      error: { hadError: false },
    });
    return 'completed';
  } catch (err) {
    console.error(`[scanJobs] job ${job.id} attempt ${job.attempts}/${MAX_ATTEMPTS} failed:`, err.message);
    if (job.attempts < MAX_ATTEMPTS) {
      const requeued = await db.result(
        `UPDATE scan_jobs SET status = 'queued', stage = NULL, error = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'processing'`,
        [job.id, err.message]
      );
      return requeued.rowCount > 0 ? 'retry' : 'skipped';
    }
    const failed = await db.result(
      `UPDATE scan_jobs SET status = 'failed', error = $2, finished_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'processing'`,
      [job.id, err.message]
    );
    if (failed.rowCount > 0) {
      // A hard-failed scan writes a telemetry row — the beta's silent-failure
      // gap was exactly this path never being recorded.
      await metrics.logInteraction({
        userId: job.user_id,
        sessionId: job.session_id,
        timing: { totalMs: Date.now() - new Date(job.started_at || job.created_at).getTime() },
        context: {
          hadAttachments: true,
          attachmentCount: 1,
          attachmentTypes: [job.mime_type || job.media_kind],
          toolCalls: [`scan_job:${job.media_kind}`],
        },
        error: { hadError: true, message: err.message },
      });
      return 'failed';
    }
    return 'skipped';
  } finally {
    clearInterval(lease);
  }
}

/** Claim + run one job by id. 'skipped' = nothing to do (idempotent ack). */
async function processJob(jobId) {
  const job = await claimJob(jobId);
  if (!job) return 'skipped';
  return runClaimedJob(job);
}

/**
 * Safety-net sweep, run opportunistically from the job routes (always inside
 * request context): re-queues processing jobs whose lease died under the
 * attempt cap (and fails the rest explicitly), and re-enqueues queued jobs
 * that have sat unclaimed long enough that their task was likely lost.
 * Duplicate tasks are harmless — claiming is atomic.
 */
async function recoverStaleJobs() {
  const requeued = await db.manyOrNone(
    `UPDATE scan_jobs SET status = 'queued', stage = NULL, updated_at = NOW()
     WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '${LEASE_SECONDS} seconds'
       AND attempts < $1
     RETURNING id`,
    [MAX_ATTEMPTS]
  );
  const failed = await db.result(
    `UPDATE scan_jobs SET status = 'failed',
       error = COALESCE(error, 'Scan was interrupted and exceeded retry attempts'),
       finished_at = NOW(), updated_at = NOW()
     WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '${LEASE_SECONDS} seconds'
       AND attempts >= $1`,
    [MAX_ATTEMPTS]
  );
  const stalled = await db.manyOrNone(
    `SELECT id FROM scan_jobs
     WHERE status = 'queued' AND updated_at < NOW() - INTERVAL '120 seconds'`
  );
  if (requeued.length || failed.rowCount || stalled.length) {
    console.log(`[scanJobs] recovery: requeued ${requeued.length}, failed ${failed.rowCount}, re-enqueued ${stalled.length} stalled`);
  }
  for (const row of [...requeued, ...stalled]) {
    try {
      await enqueueProcessing(row.id);
    } catch (err) {
      console.error(`[scanJobs] recovery enqueue failed for ${row.id}:`, err.message);
    }
  }
}

module.exports = {
  createJob,
  getJob,
  listUnconsumed,
  markConsumed,
  toDTO,
  toReviewResult,
  roomFromCaption,
  isAllowedMediaUrl,
  processJob,
  recoverStaleJobs,
  UUID_RE,
  MAX_ATTEMPTS,
  LEASE_SECONDS,
};
