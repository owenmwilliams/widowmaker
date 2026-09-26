#!/usr/bin/env node
'use strict';

/**
 * scripts/seed-demo-vendor.js
 *
 * Seeds the demo vendor for the agentic-intake demo (#107): upserts the
 * "Acme Van Lines" company on the fixed capture token `demo` (the same token
 * the /widget-demo page embeds, so the widget → /c/demo → questions → price
 * flow is fully live end to end), a realistic California rate card, and a
 * complete trust block (fictional-but-realistic placeholders, clearly marked
 * in the legal name).
 *
 * Idempotent: re-running updates the company/trust block/payments_mode in
 * place and only inserts rate-card v1 if no card exists yet (cards are
 * IMMUTABLE once quoted against — the newest active version prices new
 * quotes, so pricing changes ship as a NEW version, never an UPDATE).
 *
 * --bump-card (#111): inserts the NEXT rate-card version carrying the
 * current RATE_CARD below (which now includes depositPct: 10 — deposits are
 * 10% of the quote's low end, computed by the engine). A database seeded
 * before #111 has a v1 card WITHOUT depositPct that a plain re-run leaves
 * untouched, so to turn on percentage deposits for the demo vendor Owen
 * runs, exactly once:
 *
 *   node scripts/seed-demo-vendor.js --bump-card
 *
 * (A fresh database needs only the plain run — v1 already carries
 * depositPct. Re-running --bump-card inserts another version each time;
 * harmless but pointless, so don't script it.)
 *
 * How Owen runs it:
 *   # local docker-compose DB:
 *   DATABASE_URL=postgres://user:pass@localhost:5432/movetrack \
 *     node scripts/seed-demo-vendor.js
 *   # or with the app's usual MT_DATALAYER_* env already exported:
 *   node scripts/seed-demo-vendor.js
 *   # optional: route quote/walkthrough emails to yourself for the demo:
 *   DEMO_CONTACT_EMAIL=you@example.com node scripts/seed-demo-vendor.js
 *
 * Then screen-record: /widget-demo → click the widget → /c/demo →
 * "Answer a few questions" → price card → /mover (log in as the demo
 * company's contact email) → the priced lead row.
 */

const { Client } = require('pg');

const TOKEN = 'demo';
const NAME = 'Acme Van Lines';

// Fictional-but-realistic California licensing placeholders — clearly marked.
const TRUST_BLOCK = {
  legalName: 'Acme Van Lines, Inc. (demo — fictional company)',
  dba: 'Acme Van Lines',
  stateLicense: 'CAL-T-0123456',
  usDot: 'US DOT 1234567',
  liabilityPerLb: 0.6,
  workedExample: 'a 50 lb TV = $30 statutory coverage',
  fullValueOption: 'Full-value protection available on request before move day.',
  depositRule: '$200 deposit, fully refundable up to 72 hours before your move.',
  clockRules: 'The clock starts when the crew arrives at your door, in 30-minute increments after the 4-hour minimum.',
  regulatorUrl: 'https://www.cpuc.ca.gov/consumer-support/transportation-carriers',
};

// A realistic CA hourly rate card (double drive time is the CPUC rule).
const RATE_CARD = {
  hourlyByCrew: { 2: 169, 3: 229, 4: 289 },
  minHours: 4,
  billingIncrementMin: 30,
  travelRule: { type: 'double_drive_time', flatFee: 0 },
  truckFee: 45,
  surcharges: { stairsPerFlight: 75, longCarry: 100, heavyItem: 150 },
  packingAddon: 350,
  // depositPct WINS over depositAmount when both are present (#111): the
  // demo deposit is 10% of the quote's low end, rounded to whole dollars.
  // depositAmount stays as the documented flat-fee fallback shape.
  depositPct: 10,
  depositAmount: 200,
  refundWindowDays: 3, // 72 hours
  nteMarginPct: 15,
  maxQuoteWithoutReview: 4000,
  reviewFlagItems: ['piano', 'safe', 'pool table', 'gun safe'],
};

function connectionConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.MT_DATALAYER_HOSTNAME || '127.0.0.1',
    port: process.env.MT_DATALAYER_PORT ? Number(process.env.MT_DATALAYER_PORT) : 5432,
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE,
  };
}

async function main() {
  const contactEmail = process.env.DEMO_CONTACT_EMAIL || 'demo-mover@nexusmoves.invalid';
  const client = new Client(connectionConfig());
  await client.connect();

  try {
    // payments_mode 'simulated' (#111): the demo vendor's MCP agent takes a
    // PRETEND deposit during reserve_booking. No real charge exists anywhere.
    const company = (await client.query(
      `INSERT INTO companies (name, contact_email, token, is_active, trust_block, payments_mode)
       VALUES ($1, $2, $3, TRUE, $4, 'simulated')
       ON CONFLICT (token) DO UPDATE
         SET name = EXCLUDED.name,
             contact_email = EXCLUDED.contact_email,
             is_active = TRUE,
             trust_block = EXCLUDED.trust_block,
             payments_mode = 'simulated'
       RETURNING id, name, token`,
      [NAME, contactEmail, TOKEN, JSON.stringify(TRUST_BLOCK)]
    )).rows[0];

    const bumpCard = process.argv.includes('--bump-card');
    const existingCard = await client.query(
      `SELECT version, data FROM rate_cards WHERE company_id = $1 ORDER BY version DESC LIMIT 1`,
      [company.id]
    );
    if (existingCard.rows.length === 0) {
      await client.query(
        `INSERT INTO rate_cards (company_id, version, active, data) VALUES ($1, 1, TRUE, $2)`,
        [company.id, JSON.stringify(RATE_CARD)]
      );
      console.log(`Rate card v1 inserted for ${company.name} (depositPct: ${RATE_CARD.depositPct}).`);
    } else if (bumpCard) {
      const nextVersion = existingCard.rows[0].version + 1;
      await client.query(
        `INSERT INTO rate_cards (company_id, version, active, data) VALUES ($1, $2, TRUE, $3)`,
        [company.id, nextVersion, JSON.stringify(RATE_CARD)]
      );
      console.log(`Rate card v${nextVersion} inserted (was v${existingCard.rows[0].version}; newest active version prices new quotes; old versions stay for quote reproducibility).`);
    } else {
      const hasPct = Number(existingCard.rows[0].data?.depositPct) > 0;
      console.log(`Rate card v${existingCard.rows[0].version} already present — left untouched (cards are immutable once quoted against).`);
      if (!hasPct) {
        console.log(`  ⚠ this card has no depositPct — run \`node scripts/seed-demo-vendor.js --bump-card\` to insert the next version with depositPct: ${RATE_CARD.depositPct}.`);
      }
    }

    const appBase = (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
    console.log(`\nSeeded "${company.name}" (company ${company.id})`);
    console.log(`  contact email : ${contactEmail}`);
    console.log(`  capture link  : ${appBase}/c/${company.token}`);
    console.log(`  widget demo   : ${appBase}/widget-demo  (its widget already points at /c/${company.token})`);
    console.log(`  mover login   : ${appBase}/mover/login  (magic link goes to the contact email)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('seed-demo-vendor failed:', err.message);
  process.exit(1);
});
