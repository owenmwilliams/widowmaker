'use strict';

/**
 * services/quote/intakeAgentService.js
 *
 * THE vendor-agent service layer (W1a, #111): every brain the vendor's
 * configured agent has, callable from any surface. Two clients today, zero
 * logic duplication between them:
 *
 *   - the capture-link REST routes (routes/api/companyCapture.js, #108) —
 *     guest-JWT sessions, scanned-inventory-aware;
 *   - the per-vendor MCP server (routes/api/vendorAgentMcp.js) — the
 *     website chat widget is MCP client #1, any other AI client speaks the
 *     same protocol.
 *
 * What lives here:
 *   getIntakeQuestions   — estimator battery minus what the SESSION knows
 *                          (scanned rooms, origin on file) — capture path.
 *   questionBattery      — the same battery minus caller-supplied
 *                          knownAnswers — session-less MCP path.
 *   priceQuote           — trust-block invariant → active rate card →
 *                          inventory snapshot → distance → the DETERMINISTIC
 *                          engine (intakeQuoteEngine) → persist reproducible
 *                          inputs/outputs → best-effort vendor email.
 *   reserveBooking       — reserve-pending-confirmation against a quote:
 *                          24h vendor confirm window, SIMULATED deposit
 *                          (no real charge exists anywhere in this build),
 *                          honest emails both ways.
 *   listReservations / confirmReservation / declineReservation — the vendor
 *                          side, company-scoped. Expiry is LAZY: any read
 *                          that meets a past-due pending row flips it to
 *                          'expired' (the conditional UPDATE is the atomic
 *                          once-only latch, so the customer's expiry email
 *                          sends exactly once). No cron.
 *
 * INVARIANT carried over from #108, enforced HERE so no surface can skip it:
 * no quote without a complete trust block. An incomplete block throws
 * `trust_block_incomplete` (REST → 409, MCP → tool error) — never a bare
 * price.
 *
 * Failures the caller must map (REST status / MCP tool error) are thrown as
 * IntakeAgentError with a stable `code`; anything else is a plain Error
 * (infra, 500). All email is best-effort: a mail failure never fails the
 * request — the DB row is the durable record.
 */

const nodemailer = require('nodemailer');
const { db } = require('../infra/db');
const intakeEngine = require('./intakeQuoteEngine');
const { calculateDrivingDistance } = require('../move/distanceService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CONFIRM_WINDOW_HOURS = 24;

function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://movetrack-app-7hwn7ggbiq-uc.a.run.app').replace(/\/$/, '');
}

const fmt = (n) => `$${Number(n).toLocaleString('en-US')}`;

/** Typed, caller-mappable failure. `code` is stable API; message is honest copy. */
class IntakeAgentError extends Error {
  constructor(code, message, { statusCode = 400, missing } = {}) {
    super(message);
    this.name = 'IntakeAgentError';
    this.code = code;
    this.statusCode = statusCode;
    if (missing) this.missing = missing;
  }
}

// ── Email (same SendGrid-SMTP pattern as quoteLeads/companyCapture, #92) ─────

function buildTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass || pass === 'your-sendgrid-api-key') return null;

  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/** Best-effort mail. Throws are caught by callers; never fails a request. */
async function sendMail({ to, subject, text }) {
  const transporter = buildTransporter();
  if (!transporter) {
    console.warn(`[intakeAgent] NO EMAIL TRANSPORT — would have mailed ${to}: ${subject}\n${text}`);
    return;
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'owen@we3kings.dev',
    to,
    subject,
    text,
  });
}

// ── Intake questions ─────────────────────────────────────────────────────────

/**
 * Capture-session path (PRD R2: never ask what we already know): rooms
 * scanned → home size is known from the inventory; origin address on file →
 * origin question skipped. `userId` is the session's guest user.
 */
async function getIntakeQuestions({ userId }) {
  const [itemsRow, loc] = await Promise.all([
    db.one(`SELECT COUNT(*)::int AS n FROM items WHERE user_id = $1`, [userId]),
    db.oneOrNone(
      `SELECT address, city, state FROM locations
       WHERE user_id = $1 AND location_type = 'primary_residence'
       ORDER BY id ASC LIMIT 1`,
      [userId]
    ),
  ]);

  const originParts = [loc?.address, loc?.city, loc?.state].filter(Boolean);
  const origin = originParts.length ? originParts.join(', ') : null;
  const itemsCount = itemsRow.n;

  return {
    questions: intakeEngine.buildQuestions({
      hasInventory: itemsCount > 0,
      hasOrigin: !!origin,
    }),
    known: { itemsCount, origin },
  };
}

/**
 * Session-less path (MCP): the caller — an AI client mid-conversation —
 * says what it already knows via knownAnswers, and only the still-open
 * questions come back. There's no inventory or address on file here, so R2
 * filtering reduces to "don't re-ask what the conversation already covered".
 */
function questionBattery({ knownAnswers } = {}) {
  const known = intakeEngine.sanitizeAnswers(knownAnswers);
  const questions = intakeEngine
    .buildQuestions({ hasInventory: false, hasOrigin: !!known.originAddress })
    .filter((q) => !(q.id in known));
  return { questions, known };
}

// ── Price quote ──────────────────────────────────────────────────────────────

/**
 * Price a move from the vendor's OWN rate card, deterministically.
 *
 * @param {object} p
 * @param {string} p.companyId
 * @param {string} p.companyName
 * @param {string} p.companyContactEmail   vendor notification target
 * @param {string|null} p.captureSessionId capture path: the session id;
 *                                         MCP path: null (quotes live
 *                                         without a session — see the MCP
 *                                         route header for why)
 * @param {string} p.customerEmail         the customer's REAL email (the
 *                                         session's on the capture path,
 *                                         caller-supplied on MCP)
 * @param {string|null} p.userId           guest user whose scanned inventory
 *                                         prices the scan path; null on MCP
 * @param {object} p.answers               raw estimator answers (sanitized here)
 * @returns {{ quoteId, createdAt, outputs, payload }} payload is the exact
 *          response body the price card renders (quoteId + company +
 *          outputs + trustBlock).
 * @throws {IntakeAgentError} trust_block_incomplete | no_rate_card (both 409)
 */
async function priceQuote({
  companyId,
  companyName,
  companyContactEmail,
  captureSessionId = null,
  customerEmail,
  userId = null,
  answers: rawAnswers,
}) {
  // 1. Trust block — the invariant gate, checked before any pricing work.
  const companyRow = await db.one(
    `SELECT trust_block FROM companies WHERE id = $1`,
    [companyId]
  );
  const missing = intakeEngine.missingTrustFields(companyRow.trust_block);
  if (missing.length > 0) {
    throw new IntakeAgentError(
      'trust_block_incomplete',
      `${companyName} hasn't finished setting up licensing and coverage details, so instant quotes are paused. `
        + `(Admin: complete the trust block — missing ${missing.join(', ')}.)`,
      { statusCode: 409, missing }
    );
  }

  // 2. Active rate card — newest active version prices new quotes.
  const rateCardRow = await db.oneOrNone(
    `SELECT version, data FROM rate_cards
     WHERE company_id = $1 AND active = TRUE
     ORDER BY version DESC LIMIT 1`,
    [companyId]
  );
  if (!rateCardRow) {
    throw new IntakeAgentError(
      'no_rate_card',
      `${companyName} hasn't published a rate card yet, so instant quotes are paused. `
        + `(Admin: seed an active rate card for this company.)`,
      { statusCode: 409 }
    );
  }

  // 3. Scanned inventory snapshot (capture path only; empty on Q&A-only and
  // MCP paths).
  let items = [];
  if (userId) {
    const itemRows = await db.any(
      `SELECT name, quantity, weight_lbs, length_in, width_in, height_in
       FROM items WHERE user_id = $1`,
      [userId]
    );
    items = itemRows.map((it) => ({
      name: String(it.name || ''),
      quantity: Number(it.quantity) > 0 ? Math.floor(Number(it.quantity)) : 1,
      weightLbs: Number(it.weight_lbs) > 0 ? Number(it.weight_lbs) : null,
      lengthIn: Number(it.length_in) > 0 ? Number(it.length_in) : null,
      widthIn: Number(it.width_in) > 0 ? Number(it.width_in) : null,
      heightIn: Number(it.height_in) > 0 ? Number(it.height_in) : null,
    }));
  }

  const answers = intakeEngine.sanitizeAnswers(rawAnswers);

  // 4. Distance — the one nondeterministic step, resolved HERE so the
  // stored inputs freeze it (the engine itself stays pure). Best-effort:
  // no addresses or a lookup failure just means no travel-time component.
  let distance = null;
  if (answers.originAddress && answers.destinationAddress) {
    try {
      const d = await calculateDrivingDistance({
        origin: answers.originAddress,
        destination: answers.destinationAddress,
      });
      if (d && Number(d.distance_miles) >= 0) {
        distance = {
          miles: Number(d.distance_miles),
          driveHours: Math.round(((Number(d.duration_seconds) || 0) / 3600) * 10) / 10,
          source: d.source || null,
        };
      }
    } catch (err) {
      console.warn('[intakeAgent] quote distance lookup failed (continuing without):', err.message);
    }
  }

  // 5. The deterministic engine. `inputs` is EVERYTHING it reads —
  // computeQuote(storedInputs) reproduces storedOutputs exactly (PRD R8).
  // Session-less quotes additionally carry the customer's email in inputs
  // (the engine ignores it) — with no capture-session row to hold it, this
  // is where the lead's contact lives.
  const inputs = {
    answers,
    items,
    distance,
    rateCard: { version: rateCardRow.version, data: rateCardRow.data },
  };
  if (!captureSessionId && customerEmail) inputs.customerEmail = customerEmail;
  const outputs = intakeEngine.computeQuote(inputs);

  const quote = await db.one(
    `INSERT INTO intake_quotes
       (company_id, capture_session_id, rate_card_version, engine_version, inputs, outputs, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at`,
    [companyId, captureSessionId, rateCardRow.version, intakeEngine.ENGINE_VERSION,
      JSON.stringify(inputs), JSON.stringify(outputs), outputs.status]
  );

  // 6. Best-effort company notification — a mail failure never fails the
  // quote; the dashboard row is the durable record.
  try {
    await sendMail({
      to: companyContactEmail,
      subject: `Priced lead: ${fmt(outputs.rangeLow)}–${fmt(outputs.rangeHigh)} — ${customerEmail}`,
      text: `${customerEmail} just got an instant quote through your Nexus Moves intake.\n\n`
        + `Estimate: ${fmt(outputs.rangeLow)}–${fmt(outputs.rangeHigh)} (NTE ${fmt(outputs.nte)})\n`
        + `Crew: ${outputs.crew} movers, ${outputs.hours.low}–${outputs.hours.high} hrs\n`
        + `Status: ${outputs.status === 'review_required' ? 'Estimator review required' : 'Quoted'}\n`
        + (outputs.reviewReasons.length ? `Why: ${outputs.reviewReasons.join(' ')}\n` : '')
        + `\nSee it in your dashboard: ${appBaseUrl()}/mover\n`,
    });
  } catch (err) {
    console.error(`[intakeAgent] quote notification failed for quote ${quote.id} (quote is saved):`, err.message);
  }

  return {
    quoteId: quote.id,
    createdAt: quote.created_at,
    outputs,
    payload: {
      quoteId: quote.id,
      company: { name: companyName },
      ...outputs,
      trustBlock: companyRow.trust_block,
    },
  };
}

// ── Reservations ─────────────────────────────────────────────────────────────

/** The reservation shape every surface returns. Truth-in-copy on the deposit. */
function reservationDTO(row, { companyName, paymentsMode, quote } = {}) {
  const depositAmount = row.deposit_amount === null || row.deposit_amount === undefined
    ? null
    : Math.round(Number(row.deposit_amount));
  return {
    reservationId: row.id,
    status: row.status,
    requestedDate: typeof row.requested_date === 'string'
      ? row.requested_date.slice(0, 10)
      : new Date(row.requested_date).toISOString().slice(0, 10),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || null,
    declinedAt: row.declined_at || null,
    company: companyName ? { name: companyName } : undefined,
    quote: quote || undefined,
    deposit: {
      amount: depositAmount,
      simulated: row.deposit_simulated !== false,
      note: depositAmount > 0
        ? (paymentsMode === 'simulated'
          ? 'Demo mode: this deposit is SIMULATED — no real charge has been made.'
          : 'No charge has been made — deposits are collected off-platform for now.')
        : 'No deposit was collected — nothing has been charged.',
    },
  };
}

function depositLine(row) {
  const amount = Number(row.deposit_amount);
  return amount > 0
    ? `Your ${fmt(Math.round(amount))} deposit is simulated in demo mode — no charge has been made.`
    : 'No deposit was collected — nothing has been charged.';
}

/**
 * Reserve a move date against a priced quote: status pending_confirmation,
 * 24h vendor confirm window, SIMULATED deposit (no real charge anywhere in
 * this build — real rails are W2, and every message here says so).
 *
 * @param {object} p
 * @param {string} p.companyId  the surface's company (MCP token / session) —
 *                              the quote MUST belong to it
 * @param {string} p.quoteId
 * @param {string} p.requestedDate  YYYY-MM-DD
 * @param {string} p.customerEmail
 * @throws {IntakeAgentError} invalid_input (400) | quote_not_found (404)
 */
async function reserveBooking({ companyId, quoteId, requestedDate, customerEmail }) {
  const email = typeof customerEmail === 'string' ? customerEmail.trim().toLowerCase() : '';
  if (!email || email.length > 255 || !EMAIL_RE.test(email)) {
    throw new IntakeAgentError('invalid_input', 'A valid customerEmail is required.', { statusCode: 400 });
  }
  const date = typeof requestedDate === 'string' ? requestedDate.trim() : '';
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new IntakeAgentError('invalid_input', 'requestedDate must be a real date in YYYY-MM-DD form.', { statusCode: 400 });
  }
  if (!UUID_RE.test(String(quoteId || ''))) {
    throw new IntakeAgentError('quote_not_found', 'No quote with that id. Price the move first, then reserve with the quoteId it returns.', { statusCode: 404 });
  }

  const quote = await db.oneOrNone(
    `SELECT q.id, q.company_id, q.capture_session_id, q.outputs,
            c.name AS company_name, c.contact_email AS company_contact_email,
            c.is_active AS company_is_active, c.payments_mode
     FROM intake_quotes q
     JOIN companies c ON c.id = q.company_id
     WHERE q.id = $1`,
    [quoteId]
  );
  // A quote from another company is indistinguishable from a missing one —
  // nothing about other vendors' quotes ever leaks across tokens.
  if (!quote || quote.company_id !== companyId || !quote.company_is_active) {
    throw new IntakeAgentError('quote_not_found', 'No quote with that id. Price the move first, then reserve with the quoteId it returns.', { statusCode: 404 });
  }

  // Deposit = what the quote itself promised (computed deterministically
  // from the pinned rate card at pricing time — depositPct or flat).
  const quotedDeposit = Number(quote.outputs?.deposit?.amount);
  const depositAmount = quotedDeposit > 0 ? Math.round(quotedDeposit) : null;

  const row = await db.one(
    `INSERT INTO booking_reservations
       (company_id, intake_quote_id, capture_session_id, customer_email, requested_date,
        deposit_amount, deposit_simulated, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'pending_confirmation', NOW() + INTERVAL '${CONFIRM_WINDOW_HOURS} hours')
     RETURNING id, status, customer_email, requested_date, deposit_amount, deposit_simulated,
               expires_at, confirmed_at, declined_at, created_at`,
    [companyId, quote.id, quote.capture_session_id, email, date, depositAmount]
  );

  const rangeLow = quote.outputs?.rangeLow;
  const rangeHigh = quote.outputs?.rangeHigh;

  // Best-effort notifications — the reservation row is the source of truth.
  try {
    await sendMail({
      to: quote.company_contact_email,
      subject: `Reservation to confirm: ${fmt(rangeLow)}–${fmt(rangeHigh)}, ${date} — respond within 24 hours`,
      text: `${email} reserved ${date} against their instant quote (${fmt(rangeLow)}–${fmt(rangeHigh)}).\n\n`
        + `You have ${CONFIRM_WINDOW_HOURS} hours to confirm or decline, or the reservation expires automatically.\n`
        + (depositAmount
          ? `Deposit on file: ${fmt(depositAmount)} — SIMULATED (demo mode; no real charge was made).\n`
          : `No deposit was collected.\n`)
        + `\nConfirm or decline in your dashboard: ${appBaseUrl()}/mover\n`,
    });
  } catch (err) {
    console.error(`[intakeAgent] reservation vendor email failed for ${row.id} (reservation is saved):`, err.message);
  }
  try {
    await sendMail({
      to: email,
      subject: `Reserved pending confirmation — ${quote.company_name} has 24 hours to confirm`,
      text: `Your move date (${date}) is reserved with ${quote.company_name}, pending their confirmation.\n\n`
        + `${quote.company_name} has ${CONFIRM_WINDOW_HOURS} hours to confirm; you'll get an email either way. `
        + `If they don't respond in time, the reservation expires automatically.\n\n`
        + (depositAmount
          ? `Deposit: ${fmt(depositAmount)} — simulated in demo mode. NO charge has been made to you.\n`
          : `No deposit was collected — nothing has been charged.\n`)
        + `\nYour quote: ${fmt(rangeLow)}–${fmt(rangeHigh)} (NTE ${fmt(quote.outputs?.nte)})\n`,
    });
  } catch (err) {
    console.error(`[intakeAgent] reservation customer email failed for ${row.id} (reservation is saved):`, err.message);
  }

  return reservationDTO(row, {
    companyName: quote.company_name,
    paymentsMode: quote.payments_mode,
    quote: { id: quote.id, rangeLow, rangeHigh, nte: quote.outputs?.nte },
  });
}

/**
 * LAZY EXPIRY: flip every past-due pending reservation for this company to
 * 'expired' and email each customer once. The conditional UPDATE is the
 * atomic latch — a row can only be flipped once, so the email can only send
 * once; a concurrent reader loses the UPDATE and emails nobody. Called from
 * every reservation read path instead of a cron.
 */
async function expireStaleReservations({ companyId, companyName }) {
  const flipped = await db.any(
    `UPDATE booking_reservations
     SET status = 'expired'
     WHERE company_id = $1 AND status = 'pending_confirmation' AND expires_at <= NOW()
     RETURNING id, customer_email, requested_date, deposit_amount`,
    [companyId]
  );
  for (const r of flipped) {
    try {
      await sendMail({
        to: r.customer_email,
        subject: `Your reservation with ${companyName} expired`,
        text: `${companyName} didn't confirm your reservation within ${CONFIRM_WINDOW_HOURS} hours, so it has expired.\n\n`
          + `${depositLine(r)} When real payments launch, deposits are refunded automatically the moment a reservation expires.\n\n`
          + `You can reach out to the company directly, or get a fresh quote and pick another date.\n`,
      });
    } catch (err) {
      console.error(`[intakeAgent] expiry email failed for reservation ${r.id} (row is flipped):`, err.message);
    }
  }
  return flipped.length;
}

/** Vendor list: pending first (newest within each group), with countdowns. */
async function listReservations({ companyId, companyName }) {
  await expireStaleReservations({ companyId, companyName });

  const rows = await db.any(
    `SELECT br.id, br.intake_quote_id, br.customer_email, br.requested_date,
            br.deposit_amount, br.deposit_simulated, br.status, br.expires_at,
            br.confirmed_at, br.declined_at, br.created_at,
            q.outputs AS quote_outputs
     FROM booking_reservations br
     LEFT JOIN intake_quotes q ON q.id = br.intake_quote_id
     WHERE br.company_id = $1
     ORDER BY (br.status = 'pending_confirmation') DESC, br.created_at DESC
     LIMIT 200`,
    [companyId]
  );

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    quoteId: r.intake_quote_id,
    customerEmail: r.customer_email,
    requestedDate: typeof r.requested_date === 'string'
      ? r.requested_date.slice(0, 10)
      : new Date(r.requested_date).toISOString().slice(0, 10),
    depositAmount: r.deposit_amount === null ? null : Math.round(Number(r.deposit_amount)),
    depositSimulated: r.deposit_simulated !== false,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    confirmedAt: r.confirmed_at,
    declinedAt: r.declined_at,
    // Countdown fields for the dashboard's "respond within Nh" chip.
    expiresInSeconds: r.status === 'pending_confirmation'
      ? Math.max(0, Math.floor((new Date(r.expires_at).getTime() - now) / 1000))
      : null,
    quote: r.quote_outputs ? {
      rangeLow: r.quote_outputs.rangeLow ?? null,
      rangeHigh: r.quote_outputs.rangeHigh ?? null,
      nte: r.quote_outputs.nte ?? null,
    } : null,
  }));
}

/**
 * Shared engine for confirm/decline: atomically move a PENDING, UNEXPIRED,
 * company-scoped reservation to the target status, then email the customer.
 * A past-due pending row is lazily flipped to 'expired' here too (with its
 * once-only customer email) — the vendor clicking "confirm" at hour 25 gets
 * the honest 409, not a silent zombie confirmation.
 */
async function settleReservation({ companyId, companyName, reservationId, action }) {
  if (!UUID_RE.test(String(reservationId || ''))) {
    throw new IntakeAgentError('reservation_not_found', 'No reservation with that id.', { statusCode: 404 });
  }
  const isConfirm = action === 'confirm';

  const row = await db.oneOrNone(
    `UPDATE booking_reservations
     SET status = '${isConfirm ? 'confirmed' : 'declined'}', ${isConfirm ? 'confirmed_at' : 'declined_at'} = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'pending_confirmation' AND expires_at > NOW()
     RETURNING id, status, customer_email, requested_date, deposit_amount, deposit_simulated,
               expires_at, confirmed_at, declined_at, created_at`,
    [reservationId, companyId]
  );

  if (!row) {
    const existing = await db.oneOrNone(
      `SELECT id, status, expires_at FROM booking_reservations WHERE id = $1 AND company_id = $2`,
      [reservationId, companyId]
    );
    if (!existing) {
      throw new IntakeAgentError('reservation_not_found', 'No reservation with that id.', { statusCode: 404 });
    }
    if (existing.status === 'pending_confirmation') {
      // Pending but the conditional UPDATE refused ⇒ past expires_at. Flip
      // it now (lazy expiry; single email via the atomic latch) and say so.
      await expireStaleReservations({ companyId, companyName });
      throw new IntakeAgentError(
        'reservation_expired',
        'This reservation expired before it was confirmed — the 24-hour window has passed. The customer has been notified.',
        { statusCode: 409 }
      );
    }
    throw new IntakeAgentError(
      'reservation_not_pending',
      `This reservation was already ${existing.status}.`,
      { statusCode: 409 }
    );
  }

  try {
    if (isConfirm) {
      await sendMail({
        to: row.customer_email,
        subject: `${companyName} confirmed your move — ${dtoDate(row.requested_date)}`,
        text: `Good news: ${companyName} confirmed your reservation for ${dtoDate(row.requested_date)}.\n\n`
          + `${depositLine(row)}\n\n`
          + `The company will reach out with move-day details. Reply to them directly with any questions.\n`,
      });
    } else {
      await sendMail({
        to: row.customer_email,
        subject: `${companyName} can't take your move on ${dtoDate(row.requested_date)}`,
        text: `${companyName} declined your reservation for ${dtoDate(row.requested_date)}.\n\n`
          + `No charge was ever made, so there is nothing to refund. `
          + `You can get a fresh quote and try another date, or reach out to the company directly.\n`,
      });
    }
  } catch (err) {
    console.error(`[intakeAgent] ${action} email failed for reservation ${row.id} (status is saved):`, err.message);
  }

  return reservationDTO(row, { companyName });
}

function dtoDate(d) {
  return typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
}

const confirmReservation = (p) => settleReservation({ ...p, action: 'confirm' });
const declineReservation = (p) => settleReservation({ ...p, action: 'decline' });

module.exports = {
  IntakeAgentError,
  CONFIRM_WINDOW_HOURS,
  getIntakeQuestions,
  questionBattery,
  priceQuote,
  reserveBooking,
  listReservations,
  confirmReservation,
  declineReservation,
  expireStaleReservations,
};
