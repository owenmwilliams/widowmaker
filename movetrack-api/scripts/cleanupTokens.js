#!/usr/bin/env node
/**
 * Simple maintenance script to remove expired auth tokens.
 * Usage: `node scripts/cleanupTokens.js`
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { db } = require('../services/infra/db');

async function cleanupTokens() {
  try {
    const result = await db.result(
      `
        DELETE FROM auth_tokens
        WHERE
          (token_type = 'magic_link' AND (expires_at < NOW() - INTERVAL '7 days' OR used_at IS NOT NULL))
          OR
          (token_type = 'session' AND expires_at < NOW())
      `,
      [],
      (r) => r.rowCount
    );

    console.log(`Cleanup complete. Removed ${result} expired token(s).`);
    process.exit(0);
  } catch (error) {
    console.error('Failed to cleanup tokens:', error);
    process.exit(1);
  }
}

cleanupTokens();
