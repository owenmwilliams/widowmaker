'use strict';

/**
 * routes/api/vendorAgentConverse.js
 *
 * POST /api/agent/:companyToken/converse — the widget chat's conversation
 * endpoint (W1c, #117). Where /:companyToken/mcp is the bring-your-own-brain
 * tool layer (any MCP client), THIS endpoint ships the brain: one POST per
 * customer turn, the Gemini tool-loop agent (vendorIntakeAgent) runs the
 * conversation, and the reply comes back with structured extras the widget
 * renders as data:
 *
 *   → { conversationId, message? }        (no/empty message on a brand-new
 *                                          conversation ⇒ the deterministic
 *                                          greeting, no model call)
 *   ← { conversationId, reply, chips?, event?, turns, known, company? }
 *       event   — {type:'quote'|'reservation'|'availability', payload} with
 *                 the RAW tool payload: the quote card, date chips and
 *                 reservation card render from DATA, never model prose (R34).
 *       known   — the answers gathered so far, so the widget can fall back
 *                 to the deterministic battery MID-conversation without
 *                 re-asking anything (its knownAnswers seed).
 *       company — {name, paymentsMode} on the greeting turn only (the widget
 *                 needs paymentsMode for the simulated-deposit sheet).
 *
 * Degradation contract: no GOOGLE_AI_API_KEY ⇒ 503 {fallback:true} and the
 * widget drops to the #114 deterministic battery. Same on any turn the brain
 * cannot even start. The endpoint is PUBLIC (mounted under /api/agent like
 * the MCP server, allowlisted in middleware/auth.js) and bounded three ways:
 * the per-(token, IP) limiter, a 2000-char message cap, and a hard
 * TURN_CAP(40)-turns-per-conversation cap after which the agent hands off
 * politely with the company's contact email instead of burning tokens.
 *
 * Leak-proofing matches the MCP server: unknown and inactive tokens are one
 * indistinguishable 404; a conversationId from another company is
 * indistinguishable from a missing one.
 */

const express = require('express');
const { db } = require('../../services/infra/db');
const rateLimits = require('../../config/rateLimits');
const vendorAgent = require('../../services/quote/vendorIntakeAgent');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_CHARS = 2000; // ≈2KB — a chat bubble, not a document

// Same reasoning as the MCP endpoint: the widget runs on movers' own sites.
function permissiveCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
  next();
}

router.options('/:companyToken/converse', permissiveCors, (req, res) => res.sendStatus(204));

router.post(
  '/:companyToken/converse',
  permissiveCors,
  rateLimits.agentConverseLimiter,
  async (req, res) => {
    // ── Company (leak-proof: unknown ≡ inactive) ──────────────────────────
    let company;
    try {
      const token = String(req.params.companyToken || '');
      company = token && token.length <= 80
        ? await db.oneOrNone(
          `SELECT id, name, contact_email, trust_block, payments_mode,
                  capacity_per_day, blackout_days, intake_specs
           FROM companies WHERE token = $1 AND is_active = TRUE`,
          [token]
        )
        : null;
    } catch (err) {
      console.error('[vendorAgentConverse] company lookup failed:', err.message);
      return res.status(503).json({ error: 'Service temporarily unavailable — please retry.', fallback: true });
    }
    if (!company) {
      return res.status(404).json({ error: 'This agent link is not active. Check with the moving company for a fresh one.' });
    }

    // ── Brain availability — the widget's fallback switch ─────────────────
    if (!vendorAgent.isConfigured()) {
      return res.status(503).json({ error: 'The assistant is offline right now.', fallback: true });
    }

    // ── Input bounds ──────────────────────────────────────────────────────
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawMessage = typeof body.message === 'string' ? body.message : '';
    const message = rawMessage.replace(/\s+/g, ' ').trim();
    if (rawMessage.length > MAX_MESSAGE_CHARS) {
      return res.status(413).json({ error: `Messages are capped at ${MAX_MESSAGE_CHARS} characters — try a shorter one.` });
    }

    // ── Load or create the conversation ──────────────────────────────────
    let conversation = null;
    try {
      if (body.conversationId !== undefined && body.conversationId !== null) {
        const id = String(body.conversationId);
        if (!UUID_RE.test(id)) {
          return res.status(404).json({ error: 'No conversation with that id — start a new one.' });
        }
        conversation = await db.oneOrNone(
          `SELECT id, company_id, customer_email, state, transcript, turns, status
           FROM agent_conversations WHERE id = $1`,
          [id]
        );
        // Another company's conversation is indistinguishable from a missing one.
        if (!conversation || conversation.company_id !== company.id) {
          return res.status(404).json({ error: 'No conversation with that id — start a new one.' });
        }
      }

      if (!conversation) {
        conversation = await db.one(
          `INSERT INTO agent_conversations (company_id, state, transcript, turns, status)
           VALUES ($1, '{}', '[]', 0, 'active')
           RETURNING id, company_id, customer_email, state, transcript, turns, status`,
          [company.id]
        );
      }
    } catch (err) {
      console.error('[vendorAgentConverse] conversation load failed:', err.message);
      return res.status(503).json({ error: 'Service temporarily unavailable — please retry.', fallback: true });
    }

    const state = conversation.state && typeof conversation.state === 'object' ? conversation.state : {};
    state.known = state.known && typeof state.known === 'object' ? state.known : {};
    const transcript = Array.isArray(conversation.transcript) ? conversation.transcript : [];
    const now = new Date().toISOString();

    const respond = ({ reply, chips, event, turns, greeting = false }) => {
      const out = { conversationId: conversation.id, reply, turns, known: state.known || {} };
      if (chips && chips.length) out.chips = chips;
      if (event) out.event = event;
      if (state.customerEmail) out.customerEmail = state.customerEmail;
      if (greeting) out.company = { name: company.name, paymentsMode: company.payments_mode || 'none' };
      return res.json(out);
    };

    const persist = async ({ reply, chips, event, turns, status }) => {
      const entryUser = message ? [{ role: 'user', text: message, at: now }] : [];
      const entryBot = [{
        role: 'assistant',
        text: reply,
        ...(chips && chips.length ? { chips } : {}),
        ...(event ? { event } : {}),
        at: now,
      }];
      await db.none(
        `UPDATE agent_conversations
         SET state = $2, transcript = $3, turns = $4, status = $5,
             customer_email = $6, updated_at = NOW()
         WHERE id = $1`,
        [
          conversation.id,
          JSON.stringify(state),
          JSON.stringify([...transcript, ...entryUser, ...entryBot]),
          turns,
          status,
          state.customerEmail || conversation.customer_email || null,
        ]
      );
    };

    try {
      // ── Turn zero: deterministic greeting, no model call ────────────────
      if (!message) {
        if (transcript.length > 0) {
          // An empty message mid-conversation is a no-op resume: hand back
          // where things stand without burning a turn or a model call.
          return respond({ reply: '', turns: conversation.turns, greeting: true });
        }
        const g = vendorAgent.buildGreeting(company);
        await persist({ reply: g.reply, chips: g.chips, turns: conversation.turns, status: 'active' });
        return respond({ reply: g.reply, chips: g.chips, turns: conversation.turns, greeting: true });
      }

      // ── Turn cap: polite handoff, never a wall of silence ───────────────
      if (conversation.turns >= vendorAgent.TURN_CAP || conversation.status === 'capped') {
        const reply = `We've covered a lot here — let me hand this off so nothing gets lost. `
          + `Email ${company.name} directly at ${company.contact_email} and they'll pick it up from this conversation. `
          + (state.quote ? `Your quote is saved${state.customerEmail ? ` and a copy went to ${state.customerEmail}` : ''}.` : `Thanks for your patience.`);
        const turns = conversation.turns + 1;
        await persist({ reply, turns, status: 'capped' });
        return respond({ reply, turns });
      }

      // ── The brain ────────────────────────────────────────────────────────
      const turnResult = await vendorAgent.runTurn({
        company,
        state,
        transcript,
        message,
      });

      const turns = conversation.turns + 1;
      await persist({
        reply: turnResult.reply,
        chips: turnResult.chips,
        event: turnResult.event,
        turns,
        status: 'active',
      });
      return respond({ reply: turnResult.reply, chips: turnResult.chips, event: turnResult.event, turns });
    } catch (err) {
      console.error('[vendorAgentConverse] turn failed:', err.message);
      // The widget treats 503 {fallback:true} as "switch to the
      // deterministic battery" — carrying `known` so nothing is re-asked.
      return res.status(503).json({
        error: 'The assistant hit a snag — continuing without it.',
        fallback: true,
        known: state.known || {},
      });
    }
  }
);

module.exports = router;
