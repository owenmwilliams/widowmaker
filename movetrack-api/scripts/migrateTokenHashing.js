/**
 * Token Hashing Migration Script
 *
 * This script invalidates all existing tokens in the database.
 * After this migration, all new tokens will be stored hashed using SHA-256.
 *
 * This is a one-time security migration to implement token hashing.
 * Users will need to re-login after this migration runs.
 *
 * Usage: node scripts/migrateTokenHashing.js
 */

require('dotenv').config();
const { db } = require('../services/infra/db');

async function migrateTokenHashing() {
    console.log('='.repeat(80));
    console.log('TOKEN HASHING MIGRATION');
    console.log('='.repeat(80));
    console.log();

    try {
        // Count existing tokens
        const tokenStats = await db.one(
            `SELECT
                COUNT(*) as total_tokens,
                COUNT(CASE WHEN token_type = 'magic_link' THEN 1 END) as magic_links,
                COUNT(CASE WHEN token_type = 'session' THEN 1 END) as sessions,
                COUNT(CASE WHEN used_at IS NULL AND expires_at > NOW() THEN 1 END) as active_tokens
             FROM auth_tokens`
        );

        console.log('Current token statistics:');
        console.log(`  Total tokens in database: ${tokenStats.total_tokens}`);
        console.log(`  Magic link tokens: ${tokenStats.magic_links}`);
        console.log(`  Session tokens: ${tokenStats.sessions}`);
        console.log(`  Active (unused, not expired): ${tokenStats.active_tokens}`);
        console.log();

        // Warn about what's about to happen
        console.log('⚠️  WARNING: This migration will invalidate ALL existing tokens');
        console.log('   Users will need to request new magic links to log in');
        console.log('   This is necessary to implement token hashing for security');
        console.log();

        // Mark all tokens as used (invalidate them)
        const result = await db.result(
            `UPDATE auth_tokens
             SET used_at = NOW()
             WHERE used_at IS NULL`
        );

        console.log('✅ Migration completed successfully');
        console.log(`   Invalidated ${result.rowCount} tokens`);
        console.log();
        console.log('Next steps:');
        console.log('  1. All new tokens will be stored as SHA-256 hashes');
        console.log('  2. Users will need to log in again using magic links');
        console.log('  3. Database breaches will no longer expose active sessions');
        console.log();
        console.log('='.repeat(80));

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migration
migrateTokenHashing();
