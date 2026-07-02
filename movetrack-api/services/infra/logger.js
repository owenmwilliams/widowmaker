'use strict';

/**
 * services/infra/logger.js
 *
 * Minimal structured JSON logger for the scan/agent path. Cloud Logging parses
 * single-line JSON from stdout/stderr automatically (severity, message, and any
 * extra fields become filterable jsonPayload keys) — no APM dependency needed.
 *
 * Replaces bare `console.log('[census] ...')` lines, which carry no user/session/
 * request id and can't be filtered to a single user's scan in Cloud Logging.
 */

function write(severity, message, fields) {
  const entry = {
    severity,
    message,
    time: new Date().toISOString(),
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (severity === 'ERROR') console.error(line);
  else if (severity === 'WARNING') console.warn(line);
  else console.log(line);
}

/**
 * Create a logger pre-bound to a set of fields (e.g. component, userId,
 * sessionId, requestId). `.child()` layers on additional fields once they
 * become known (e.g. sessionId, resolved after the session lookup).
 */
function createLogger(fields = {}) {
  return {
    info: (message, extra = {}) => write('INFO', message, { ...fields, ...extra }),
    warn: (message, extra = {}) => write('WARNING', message, { ...fields, ...extra }),
    error: (message, extra = {}) => write('ERROR', message, { ...fields, ...extra }),
    child: (extra = {}) => createLogger({ ...fields, ...extra }),
  };
}

module.exports = { createLogger };
