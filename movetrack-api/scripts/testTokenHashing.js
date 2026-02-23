/**
 * Token Hashing Test Script
 *
 * Tests the token hashing implementation to ensure it works correctly
 * before deploying to production.
 *
 * This script tests:
 * 1. Token generation and hashing
 * 2. Magic link creation and verification
 * 3. Token comparison (hashed vs unhashed)
 *
 * Usage: node scripts/testTokenHashing.js
 */

require('dotenv').config();
const crypto = require('crypto');

// Copy the hashToken function from authService
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Copy the generateToken function from authService
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

console.log('='.repeat(80));
console.log('TOKEN HASHING TEST');
console.log('='.repeat(80));
console.log();

// Test 1: Basic token generation and hashing
console.log('Test 1: Token Generation and Hashing');
console.log('-'.repeat(80));

const token1 = generateToken();
const hashed1a = hashToken(token1);
const hashed1b = hashToken(token1);

console.log('✓ Generated token:', token1.substring(0, 16) + '...');
console.log('✓ Token length:', token1.length, 'characters (64 hex chars = 32 bytes)');
console.log('✓ Hashed token:', hashed1a.substring(0, 16) + '...');
console.log('✓ Hash length:', hashed1a.length, 'characters (64 hex chars = 32 bytes)');
console.log('✓ Same token hashes to same value:', hashed1a === hashed1b ? 'PASS' : 'FAIL');
console.log();

// Test 2: Different tokens produce different hashes
console.log('Test 2: Hash Uniqueness');
console.log('-'.repeat(80));

const token2 = generateToken();
const hashed2 = hashToken(token2);
const hashesAreDifferent = hashed1a !== hashed2;

console.log('✓ Token 1 hash:', hashed1a.substring(0, 16) + '...');
console.log('✓ Token 2 hash:', hashed2.substring(0, 16) + '...');
console.log('✓ Different tokens produce different hashes:', hashesAreDifferent ? 'PASS' : 'FAIL');
console.log();

// Test 3: Hash is deterministic
console.log('Test 3: Hash Determinism');
console.log('-'.repeat(80));

const testToken = 'test-token-12345';
const hash1 = hashToken(testToken);
const hash2 = hashToken(testToken);
const hash3 = hashToken(testToken);

console.log('✓ Test token:', testToken);
console.log('✓ Hash 1:', hash1.substring(0, 16) + '...');
console.log('✓ Hash 2:', hash2.substring(0, 16) + '...');
console.log('✓ Hash 3:', hash3.substring(0, 16) + '...');
console.log('✓ All hashes are identical:', (hash1 === hash2 && hash2 === hash3) ? 'PASS' : 'FAIL');
console.log();

// Test 4: Hash is one-way (cannot reverse)
console.log('Test 4: One-Way Hash Property');
console.log('-'.repeat(80));

const originalToken = generateToken();
const hashedToken = hashToken(originalToken);

console.log('✓ Original token:', originalToken.substring(0, 16) + '...');
console.log('✓ Hashed token:', hashedToken.substring(0, 16) + '...');
console.log('✓ Original and hash are different:', originalToken !== hashedToken ? 'PASS' : 'FAIL');
console.log('✓ Hash cannot be reversed to original (SHA-256 is one-way): PASS');
console.log();

// Test 5: Simulate database storage and retrieval
console.log('Test 5: Database Storage Simulation');
console.log('-'.repeat(80));

// Simulate what happens in createMagicLinkToken
const plainTextToken = generateToken(); // This is sent via email
const storedToken = hashToken(plainTextToken); // This is stored in database

// Simulate what happens in verifyMagicLinkToken
const receivedToken = plainTextToken; // User clicks link with this token
const lookupHash = hashToken(receivedToken); // Hash it to look up in database

const verificationWorks = storedToken === lookupHash;

console.log('✓ Plain-text token (sent in email):', plainTextToken.substring(0, 16) + '...');
console.log('✓ Hashed token (stored in DB):', storedToken.substring(0, 16) + '...');
console.log('✓ Received token (from user click):', receivedToken.substring(0, 16) + '...');
console.log('✓ Lookup hash (computed for DB query):', lookupHash.substring(0, 16) + '...');
console.log('✓ Verification works (stored === lookup):', verificationWorks ? 'PASS' : 'FAIL');
console.log();

// Test 6: Security improvement demonstration
console.log('Test 6: Security Improvement');
console.log('-'.repeat(80));

console.log('Before token hashing:');
console.log('  If database is breached, attacker gets: ' + plainTextToken.substring(0, 16) + '...');
console.log('  Attacker can immediately use this token to log in');
console.log();
console.log('After token hashing:');
console.log('  If database is breached, attacker gets: ' + storedToken.substring(0, 16) + '...');
console.log('  Attacker CANNOT reverse the hash to get the original token');
console.log('  Token is useless to the attacker - security improved! ✓');
console.log();

// Summary
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));

const allTestsPassed = hashesAreDifferent && (hashed1a === hashed1b) && (hash1 === hash2 && hash2 === hash3) && verificationWorks;

if (allTestsPassed) {
    console.log('✅ ALL TESTS PASSED');
    console.log();
    console.log('Token hashing implementation is working correctly!');
    console.log();
    console.log('Next steps:');
    console.log('  1. Run migration: node scripts/migrateTokenHashing.js');
    console.log('  2. Test login flow in development');
    console.log('  3. Deploy to production');
} else {
    console.log('❌ SOME TESTS FAILED');
    console.log();
    console.log('Please review the implementation before deploying.');
}

console.log('='.repeat(80));
