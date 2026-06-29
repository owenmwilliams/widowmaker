'use strict';

/**
 * middleware/validation.js
 *
 * Small, dependency-free input validators. Centralizes the email check that was
 * previously inlined in routes/auth/auth.js and provides a string-cleaning helper
 * for capping user-provided text. A broader schema-based validation rollout across
 * the CRUD routes is tracked separately (needs the integration test DB to verify).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254; // RFC 5321 practical maximum

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= MAX_EMAIL_LEN && EMAIL_RE.test(email);
}

/**
 * Express middleware: require a syntactically valid email in req.body.email.
 */
function requireValidEmail(req, res, next) {
  const email = req.body && req.body.email;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email format' });
  }
  next();
}

/**
 * Trim and cap a string field. Returns null when the value isn't a usable string.
 */
function cleanString(value, maxLen = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

module.exports = { isValidEmail, requireValidEmail, cleanString, EMAIL_RE, MAX_EMAIL_LEN };
