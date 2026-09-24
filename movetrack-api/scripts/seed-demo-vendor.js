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
 * Idempotent: re-running updates the company/trust block in place and only
 * inserts rate-card v1 if no card exists yet (cards are immutable once
 * quoted against — bump the version by hand for pricing changes).
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
    const company = (await client.query(
      `INSERT INTO companies (name, contact_email, token, is_active, trust_block)
       VALUES ($1, $2, $3, TRUE, $4)
       ON CONFLICT (token) DO UPDATE
         SET name = EXCLUDED.name,
             contact_email = EXCLUDED.contact_email,
             is_active = TRUE,
             trust_block = EXCLUDED.trust_block
       RETURNING id, name, token`,
      [NAME, contactEmail, TOKEN, JSON.stringify(TRUST_BLOCK)]
    )).rows[0];

    const existingCard = await client.query(
      `SELECT version FROM rate_cards WHERE company_id = $1 ORDER BY version DESC LIMIT 1`,
      [company.id]
    );
    if (existingCard.rows.length === 0) {
      await client.query(
        `INSERT INTO rate_cards (company_id, version, active, data) VALUES ($1, 1, TRUE, $2)`,
        [company.id, JSON.stringify(RATE_CARD)]
      );
      console.log(`Rate card v1 inserted for ${company.name}.`);
    } else {
      console.log(`Rate card v${existingCard.rows[0].version} already present — left untouched (bump the version for pricing changes).`);
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
