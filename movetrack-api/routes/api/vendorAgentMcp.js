'use strict';

/**
 * routes/api/vendorAgentMcp.js
 *
 * THE PER-VENDOR MCP SERVER (W1a, #111). Owner decision, taken literally:
 * every moving company on Nexus gets "their own MCP agent" — a real Model
 * Context Protocol server at
 *
 *     POST /api/agent/:companyToken/mcp
 *
 * speaking streamable-HTTP JSON-RPC via the official
 * @modelcontextprotocol/sdk. The website chat widget (#112) is client #1;
 * Claude, ChatGPT connectors, or any other MCP client can quote and reserve
 * against the same vendor with zero extra server work — being quotable by
 * any AI client is the point, so the mount is PUBLIC (allowlisted in
 * middleware/auth.js like /api/capture) and rate-limited per (token, IP).
 *
 * Transport: STATELESS + JSON-response mode. Every POST builds a fresh
 * McpServer bound to the token's company and tears it down when the
 * response closes: no session ids, no SSE streams to hold open, safe on
 * Cloud Run with N instances. Clients MAY send `initialize` first (spec-
 * compliant handshake, and what the SDK client does) but a bare
 * `tools/call` also works — handy for the widget's plain fetch bridge (see
 * docs/vendor-agent-mcp.md for the exact browser contract). GETs get a 405:
 * there is no server-push stream in stateless mode.
 *
 * Tools (all results are JSON text content):
 *   get_company_info     → name, trustBlock, paymentsMode
 *   get_intake_questions → estimator battery minus knownAnswers
 *   price_quote          → the full quote payload INCLUDING the trust block.
 *                          The #108 invariant is enforced identically by the
 *                          shared service layer: an incomplete trust block
 *                          is a TOOL ERROR — this server never returns a
 *                          bare price. Quotes priced here live WITHOUT a
 *                          capture session (capture_session_id NULL): the
 *                          guest-user pathway (users+locations+permissions
 *                          rows) exists to receive scanned videos, which an
 *                          MCP conversation doesn't have, so the customer's
 *                          email is stored in the quote's inputs instead.
 *   reserve_booking      → reserve-pending-confirmation with a SIMULATED
 *                          deposit (no real charge exists anywhere in this
 *                          build) and a 24h vendor confirm window.
 *
 * What can never leak here: unknown and inactive tokens are answered with
 * the same JSON-RPC error (no existence oracle, no company data); raw rate
 * cards are never exposed — only computed quotes; no contact emails, ids,
 * or tokens ride on any tool result.
 *
 * All the actual logic lives in services/quote/intakeAgentService.js,
 * shared with the /api/capture REST routes — zero duplication.
 */

const express = require('express');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { db } = require('../../services/infra/db');
const rateLimits = require('../../config/rateLimits');
const intakeAgent = require('../../services/quote/intakeAgentService');

const router = express.Router();

// The widget runs on moving companies' OWN websites, so this endpoint must
// be callable from any origin (same reasoning as the capture landing GET,
// #98). It serves computed quotes and the public trust block — nothing that
// needs an origin wall; abuse is bounded by the per-(token, IP) limiter.
function permissiveCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id');
  next();
}

router.options('/:companyToken/mcp', permissiveCors, (req, res) => res.sendStatus(204));

/** JSON-RPC error body — the ONLY thing an unknown/inactive token ever sees. */
function rpcError(res, httpStatus, code, message, id = null) {
  res.status(httpStatus).json({ jsonrpc: '2.0', error: { code, message }, id });
}

/** A tool result: pretty JSON text content (every MCP client renders text). */
function toolJson(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/**
 * A tool ERROR: isError + honest copy. IntakeAgentError carries user-facing
 * copy and a stable code; anything else is an infra failure and says only
 * that (no stack traces or SQL to the public internet).
 */
function toolError(err, logTag) {
  if (err instanceof intakeAgent.IntakeAgentError) {
    const detail = { error: err.message, code: err.code };
    if (err.missing) detail.missing = err.missing;
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }] };
  }
  console.error(`[vendorAgentMcp] ${logTag} failed:`, err.message);
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: 'Something went wrong on our side. Please try again.' }, null, 2) }],
  };
}

/**
 * Build the McpServer for ONE company. Fresh per request (stateless), so a
 * tool closure can never see another vendor's — or another customer's — data.
 */
function buildServer(company) {
  const server = new McpServer({
    name: `${company.name} — moving agent (Nexus Moves)`,
    version: '1.0.0',
  });

  server.registerTool(
    'get_company_info',
    {
      title: 'Get company info',
      description:
        `Who you are talking to: ${company.name}'s public profile — display name, the trust block `
        + '(legal name, state license, US DOT number, statutory liability with a worked example, '
        + 'deposit/refund rule, clock rules), and paymentsMode. paymentsMode "simulated" means '
        + 'deposits in this demo are PRETEND — no real charge is ever made; "none" means no deposit '
        + 'step at all. Call this first and show the customer the licensing facts with any price.',
      inputSchema: {},
    },
    async () => {
      try {
        return toolJson({
          name: company.name,
          trustBlock: company.trust_block || null,
          paymentsMode: company.payments_mode || 'none',
        });
      } catch (err) {
        return toolError(err, 'get_company_info');
      }
    }
  );

  server.registerTool(
    'get_intake_questions',
    {
      title: 'Get intake questions',
      description:
        'The estimator question battery a quote needs (home size, addresses, stairs, parking, '
        + 'packing, special items, move date). Pass knownAnswers — {questionId: value} for anything '
        + 'the conversation already established — and only the still-open questions come back, so '
        + 'the customer is never asked twice.',
      inputSchema: {
        knownAnswers: z
          .record(z.string())
          .optional()
          .describe('Answers already known, keyed by question id (e.g. {"bedrooms":"2","originAddress":"Oakland, CA"}). String values only.'),
      },
    },
    async ({ knownAnswers }) => {
      try {
        return toolJson(intakeAgent.questionBattery({ knownAnswers }));
      } catch (err) {
        return toolError(err, 'get_intake_questions');
      }
    }
  );

  server.registerTool(
    'price_quote',
    {
      title: 'Price the move',
      description:
        `Compute ${company.name}'s instant quote, deterministically, from the vendor's own rate card `
        + '— no guessing, no negotiation. Takes the estimator answers plus the customer\'s email '
        + '(required: it is how the vendor follows up, and how a reservation is later tied to a '
        + 'person). Returns a price RANGE with itemized line items, a not-to-exceed cap, deposit '
        + 'terms, review flags when an estimator must confirm (pianos, big moves, long distance), '
        + 'and the company\'s trust block — always present the licensing facts alongside the price. '
        + 'Fails (rather than quoting) if the company\'s trust block is incomplete. Save the '
        + 'returned quoteId: reserve_booking needs it.',
      inputSchema: {
        answers: z
          .record(z.string())
          .describe('Estimator answers keyed by question id from get_intake_questions (e.g. {"bedrooms":"2","stairsOrigin":"1","destinationAddress":"San Jose, CA","moveDate":"2026-10-15"}).'),
        customerEmail: z.string().describe("The customer's real email address."),
      },
    },
    async ({ answers, customerEmail }) => {
      try {
        const email = typeof customerEmail === 'string' ? customerEmail.trim().toLowerCase() : '';
        if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new intakeAgent.IntakeAgentError('invalid_input', 'A valid customerEmail is required to price the move.', { statusCode: 400 });
        }
        const result = await intakeAgent.priceQuote({
          companyId: company.id,
          companyName: company.name,
          companyContactEmail: company.contact_email,
          captureSessionId: null, // MCP quotes live without a capture session — see file header
          customerEmail: email,
          userId: null,
          answers,
        });
        return toolJson(result.payload);
      } catch (err) {
        return toolError(err, 'price_quote');
      }
    }
  );

  server.registerTool(
    'reserve_booking',
    {
      title: 'Reserve a move date',
      description:
        `Reserve a move date against a quote from price_quote. This is reserve-PENDING-confirmation: `
        + `${company.name} has 24 hours to confirm or the reservation expires automatically, and the `
        + 'customer is emailed either way. The deposit is SIMULATED in this demo — no real charge is '
        + 'ever made, and you must tell the customer that plainly. Returns the reservation summary '
        + 'including the confirm deadline.',
      inputSchema: {
        quoteId: z.string().describe('The quoteId returned by price_quote.'),
        requestedDate: z.string().describe('The move date the customer wants, YYYY-MM-DD.'),
        customerEmail: z.string().describe("The customer's real email address (confirmation goes here)."),
      },
    },
    async ({ quoteId, requestedDate, customerEmail }) => {
      try {
        const reservation = await intakeAgent.reserveBooking({
          companyId: company.id,
          quoteId,
          requestedDate,
          customerEmail,
        });
        return toolJson(reservation);
      } catch (err) {
        return toolError(err, 'reserve_booking');
      }
    }
  );

  return server;
}

// ── POST /api/agent/:companyToken/mcp — the MCP endpoint ────────────────────
router.post('/:companyToken/mcp', permissiveCors, rateLimits.agentMcpLimiter, express.json({ limit: '256kb' }), async (req, res) => {
  const bodyId = req.body && !Array.isArray(req.body) && req.body.id !== undefined ? req.body.id : null;

  let company;
  try {
    const token = String(req.params.companyToken || '');
    company = token && token.length <= 80
      ? await db.oneOrNone(
        `SELECT id, name, contact_email, trust_block, payments_mode
         FROM companies WHERE token = $1 AND is_active = TRUE`,
        [token]
      )
      : null;
  } catch (err) {
    console.error('[vendorAgentMcp] company lookup failed:', err.message);
    return rpcError(res, 503, -32000, 'Service temporarily unavailable — please retry.', bodyId);
  }
  // Unknown and inactive tokens are indistinguishable, and nothing about the
  // company (existence included) leaks.
  if (!company) {
    return rpcError(res, 404, -32001, 'This agent link is not active. Check with the moving company for a fresh one.', bodyId);
  }

  const server = buildServer(company);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — see file header
    enableJsonResponse: true,      // plain JSON responses (browser-fetch friendly)
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[vendorAgentMcp] request handling failed:', err.message);
    if (!res.headersSent) {
      rpcError(res, 500, -32603, 'Internal error.', bodyId);
    }
  }
});

// Stateless mode has no server-push stream and no session to delete.
router.get('/:companyToken/mcp', permissiveCors, rateLimits.agentMcpLimiter, (req, res) => {
  rpcError(res, 405, -32000, 'Method not allowed: this MCP server is stateless — POST JSON-RPC messages.', null);
});
router.delete('/:companyToken/mcp', permissiveCors, rateLimits.agentMcpLimiter, (req, res) => {
  rpcError(res, 405, -32000, 'Method not allowed: this MCP server is stateless — there is no session to delete.', null);
});

module.exports = router;
