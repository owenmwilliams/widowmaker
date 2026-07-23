/**
 * Rate Limiting Configuration for Nexus Moves API
 *
 * Implements multiple rate limiting strategies to protect against:
 * - Brute force attacks
 * - API abuse
 * - DoS attacks
 * - Email spam
 *
 * Created: 2025-12-23
 */

const rateLimit = require('express-rate-limit');
const ipKeyGenerator =
  rateLimit?.ipKeyGenerator ||
  ((req) => req.ip);

/**
 * Global API Rate Limiter
 * Applies to all requests across the application
 *
 * Limits: 100 requests per 15 minutes per IP
 * Purpose: Prevent general API abuse and DoS attacks
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // Keyed by IP and applied before auth, so it must comfortably fit a normal
  // authenticated chat session: each agent message is a /message stream plus a
  // readiness refresh, and room scans add uploads. 100 was far too low and
  // caused silent 429s ("messages went unanswered"). Abuse is still bounded.
  max: 1000, // requests per 15 minutes per IP
  message: {
    error: 'Too many requests from this IP address. Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip successful requests to static files
  skip: (req) => {
    return req.path.startsWith('/public/') || req.path.match(/\.(css|js|jpg|jpeg|png|gif|svg)$/);
  }
});

/**
 * Authentication Rate Limiter
 * Applies to magic link requests and authentication endpoints
 *
 * Limits: 30 requests per hour per email address
 * Purpose: Prevent magic link spam and brute force attacks
 *
 * NOTE: this wraps the ENTIRE /auth router (app.js), so it counts both
 * request-code AND verify-code. 5/hr was far too tight — a normal login (request
 * a code, mistype it once, re-request) could exhaust it and lock the user out
 * for an hour. 30/hr keyed by email still bounds spam comfortably.
 */
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // requests per email per hour (covers request-code + verify-code)
  message: {
    error: 'Too many authentication requests. Please try again in an hour.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Key based on email address for magic link requests
  keyGenerator: (req) => {
    // For magic link requests, use email as key
    if (req.body && req.body.email) {
      return req.body.email.toLowerCase().trim();
    }
    // Fallback to IP if no email provided
    return ipKeyGenerator(req);
  },
  // Custom handler to log rate limit violations
  handler: (req, res) => {
    console.warn(`Rate limit exceeded for auth endpoint: ${req.body?.email || req.ip}`);
    res.status(429).json({
      error: 'Too many authentication requests. Please try again in an hour.',
      retryAfter: '1 hour'
    });
  }
});

/**
 * Strict Authentication Rate Limiter
 * Even more restrictive for sensitive auth operations
 *
 * Limits: 3 requests per hour per IP
 * Purpose: Extra protection for token verification and sensitive auth endpoints
 */
const strictAuthLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Only 3 attempts per hour
  message: {
    error: 'Too many failed authentication attempts. Please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Don't count successful requests
});

/**
 * API Rate Limiter for Authenticated Users
 * More generous limits for logged-in users making API calls
 *
 * Limits: 1000 requests per 15 minutes per user
 * Purpose: Prevent API abuse while allowing normal usage
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes for authenticated users
  message: {
    error: 'API rate limit exceeded. Please slow down your requests.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Key based on authenticated user ID
  keyGenerator: (req) => {
    // If authenticated, use user ID
    if (req.user && req.user.user_id) {
      return `user:${req.user.user_id}`;
    }
    // Fallback to IP for unauthenticated requests
    return `ip:${ipKeyGenerator(req)}`;
  }
});

/**
 * File Upload Rate Limiter
 * Limits for file upload endpoints
 *
 * Limits: 20 uploads per hour per user
 * Purpose: Prevent storage abuse and excessive bandwidth usage
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 uploads per hour
  message: {
    error: 'Upload limit exceeded. Please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user && req.user.user_id) {
      return `upload:${req.user.user_id}`;
    }
    return `upload:${ipKeyGenerator(req)}`;
  }
});

/**
 * Vision API Rate Limiter
 * Limits for AI vision processing endpoints (expensive operations)
 *
 * Limits: 10 requests per hour per user
 * Purpose: Prevent abuse of expensive AI API calls
 */
const visionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 vision API calls per hour
  message: {
    error: 'Vision API limit exceeded. Please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user && req.user.user_id) {
      return `vision:${req.user.user_id}`;
    }
    return `vision:${ipKeyGenerator(req)}`;
  },
  handler: (req, res) => {
    console.warn(`Vision API rate limit exceeded: ${req.user?.user_id || req.ip}`);
    res.status(429).json({
      error: 'Vision API limit exceeded. Please try again later.',
      retryAfter: '1 hour'
    });
  }
});

/**
 * Rescan Rate Limiter
 * Limits for the deterministic /api/agents/nexus/rescan endpoint, which re-runs
 * the most expensive call in the system (video frame extraction + a large
 * multi-image vision call) on demand. globalLimiter is IP-keyed and generous;
 * this bounds the per-user cost of hammering Rescan.
 *
 * Limits: 15 rescans per hour per user
 */
const rescanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15, // 15 rescans per hour per user
  message: {
    error: 'You\'ve rescanned a lot in a short time. Please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user && req.user.user_id) {
      return `rescan:${req.user.user_id}`;
    }
    return `rescan:${ipKeyGenerator(req)}`;
  },
  handler: (req, res) => {
    console.warn(`Rescan rate limit exceeded: ${req.user?.user_id || req.ip}`);
    res.status(429).json({
      error: 'You\'ve rescanned a lot in a short time. Please try again later.',
      retryAfter: '1 hour'
    });
  }
});

/**
 * Email Rate Limiter
 * Limits for email sending endpoints
 *
 * Limits: 10 emails per hour per user
 * Purpose: Prevent email spam
 */
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 emails per hour
  message: {
    error: 'Email sending limit exceeded. Please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user && req.user.user_id) {
      return `email:${req.user.user_id}`;
    }
    return `email:${ipKeyGenerator(req)}`;
  }
});

/**
 * Public Endpoint Rate Limiter
 * More restrictive for public/unauthenticated endpoints
 *
 * Limits: 30 requests per 15 minutes per IP
 * Purpose: Prevent abuse of public endpoints
 */
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per 15 minutes
  message: {
    error: 'Too many requests. Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Company Capture Start Limiter (issue #96)
 * Bounds guest-session creation per company link + IP — the endpoint creates
 * a users row and a capture session with no account wall in front of it.
 *
 * Limits: 20 session starts per hour per (company token, IP)
 */
const captureStartLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // Route middleware on '/:companyToken/…' paths, so req.params is populated.
  keyGenerator: (req) => `capture-start:${req.params?.companyToken || 'none'}:${ipKeyGenerator(req)}`,
  handler: (req, res) => {
    console.warn(`Capture start rate limit exceeded: ${req.params?.companyToken || '?'} ${req.ip}`);
    res.status(429).json({
      error: "You've started a lot of sessions from this link. Please wait an hour and try again.",
      retryAfter: '1 hour'
    });
  }
});

/**
 * Company Capture Limiter (issue #96)
 * General guard for the guest capture endpoints (upload-url, scan jobs,
 * polling, complete). Generous enough for a full home walkthrough — each room
 * is one upload-url + one PUT (not through here) + one scan-job create + a
 * couple dozen status polls — while bounding abuse per link + IP.
 *
 * Limits: 600 requests per 15 minutes per (company token, IP)
 */
const captureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `capture:${req.params?.companyToken || 'none'}:${ipKeyGenerator(req)}`,
  handler: (req, res) => {
    console.warn(`Capture rate limit exceeded: ${req.params?.companyToken || '?'} ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests — give it a few minutes and pick up where you left off.',
      retryAfter: '15 minutes'
    });
  }
});

module.exports = {
  globalLimiter,
  authLimiter,
  strictAuthLimiter,
  apiLimiter,
  uploadLimiter,
  visionLimiter,
  rescanLimiter,
  emailLimiter,
  publicLimiter,
  captureStartLimiter,
  captureLimiter
};
