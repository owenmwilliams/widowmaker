'use strict';

/**
 * First-turn hardening (2026-07 beta): a brand-new user's FIRST message —
 * just their name ("Greg") in reply to the seeded greeting ("First — What's
 * your name?") — got "Sorry — I didn't quite catch that."
 *
 * Root cause (two layers):
 *  1. The /active-session greeting seed inserted the session with
 *     session_type='general' while the orchestrator resolves/creates
 *     session_type='nexus' — so the first user turn ran against a brand-new
 *     EMPTY session and the model never saw the name-ask it was replying to.
 *  2. Every orchestrator fallback (empty candidate, round exhaustion,
 *     exception) was context-blind: on the one turn where the intended action
 *     is fully known (name → set_user_profile → step 2), it apologized.
 *
 * These tests pin both fixes:
 *  (a) reproduce the failure — empty model candidate on turn one now recovers
 *      deterministically instead of apologizing (pre-fix this suite fails),
 *  (b) seeded greeting + "Greg" → reply contains "Greg" and asks where
 *      they're moving from — never "didn't catch",
 *  (c) a non-name first message gets a gentle name re-ask, not the scripted
 *      name flow,
 *  (d) FIRST_TURN_FALLBACK forensics fire on every first-turn fallback,
 *  plus: the greeting seed and the orchestrator now share session_type='nexus'.
 */

const GREETING =
  "\u{1F44B} Hi! I'm Nexus, your moving assistant. Tell me about your move and I'll build an inventory you can share with movers — in three quick steps:\n\n" +
  "1. \u{1F3E0} Tell me about your current home\n2. \u{1F3A5} Add a photo or video walkthrough of each room\n3. \u{1F4E4} Share your inventory with movers\n\nFirst — **What's your name?**";

function emptyCandidateResult(finishReason = 'MAX_TOKENS') {
  return { response: { candidates: [{ content: { parts: [] }, finishReason }] } };
}

function functionCallResult(name, args = {}) {
  return { response: { candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] } };
}

function textResult(text) {
  return { response: { candidates: [{ content: { parts: [{ text }] } }] } };
}

describe('nexus orchestrator — first turn never falls through', () => {
  let processMessage;
  let mainGenerate;       // the tool-equipped orchestrator model
  let setProfileMock;
  let mockState;
  let inserts;
  let errorSpy;

  beforeEach(() => {
    jest.resetModules();
    process.env.GOOGLE_AI_API_KEY = 'test-key';

    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    mainGenerate = jest.fn();
    setProfileMock = jest.fn().mockResolvedValue({ success: true, first_name: 'Greg' });
    inserts = [];
    mockState = {
      session: { id: 'sess-1', title: null, context_summary: null, summary_through_id: null },
      user: { first_name: null, last_name: null, email: 'g@x.com', onboarding_completed: false },
      // Seeded greeting is the ONLY transcript row before the first user turn.
      history: [
        { id: 1, role: 'model', content: GREETING, tool_name: null, tool_args: null, tool_response: null, attachments: null },
      ],
    };

    jest.doMock('@google/generative-ai', () => ({
      GoogleGenerativeAI: class {
        getGenerativeModel(cfg) {
          if (cfg && cfg.tools) {
            return { generateContent: (...a) => mainGenerate(...a) };
          }
          // Aux models (intent detection / decision engine / summary)
          return {
            generateContent: async () => ({
              response: { text: () => '{"hasDirectUserRequest": false, "intentConfidence": 0.4, "intentType": null}' },
            }),
          };
        }
      },
      SchemaType: { OBJECT: 'object', STRING: 'string', BOOLEAN: 'boolean', INTEGER: 'integer', NUMBER: 'number', ARRAY: 'array' },
    }));

    jest.doMock('../../services/infra/db', () => ({
      db: {
        oneOrNone: jest.fn(async (sql) => {
          if (/FROM nexus_sessions WHERE user_id/.test(sql)) return mockState.session;
          if (/FROM users WHERE user_id/.test(sql)) return mockState.user;
          return null; // lastUserMsg OFFSET 1, summary lookups, etc.
        }),
        one: jest.fn(async () => mockState.session),
        any: jest.fn(async (sql) => (/FROM nexus_messages/.test(sql) ? [...mockState.history] : [])),
        none: jest.fn(async (sql, params) => { inserts.push({ sql, params }); }),
      },
    }));

    jest.doMock('../../services/inventory/inventorySummaryQueryService', () => ({
      getInventoryTextSummary: jest.fn().mockResolvedValue('No items yet.'),
    }));
    jest.doMock('../../services/infra/promptSafety', () => ({
      sanitizeForPrompt: (s) => String(s),
      fenceUntrusted: (_label, s) => String(s),
    }));
    jest.doMock('../../services/infra/ai/resilientModel', () => ({
      instrumentModel: (m) => m,
      AiUnavailableError: class AiUnavailableError extends Error {},
    }));
    jest.doMock('../../services/workflow/agentDelegationService', () => ({
      buildToolHandlers: () => ({
        set_user_profile: setProfileMock,
        get_user_profile: jest.fn().mockResolvedValue({ success: true }),
      }),
    }));
    jest.doMock('../../agents/schemas/workflowGuidance', () => ({
      buildWorkflowGuidanceContext: jest.fn().mockResolvedValue({}),
      formatGuidanceForPrompt: () => 'none',
    }));

    ({ processMessage } = require('../../agents/nexusOrchestratorAgent'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.GOOGLE_AI_API_KEY;
  });

  function modelRowInserts() {
    return inserts
      .filter(({ sql }) => /INSERT INTO nexus_messages/.test(sql) && /'model'/.test(sql))
      .map(({ params }) => params[1]);
  }

  test('(a) REPRO: empty first-round candidate + "Greg" recovers deterministically — no apology', async () => {
    // The production failure shape: gemini-2.5-flash spends the whole budget
    // thinking and returns an empty candidate. Pre-fix this surfaced as
    // "Sorry — I didn't quite catch that. Could you say it again?".
    mainGenerate.mockResolvedValue(emptyCandidateResult('MAX_TOKENS'));

    const result = await processMessage('user-1', 'Greg', [], 'basic');

    expect(result.reply).not.toMatch(/didn't quite catch/i);
    expect(result.reply).toBe('Nice to meet you, Greg! Where are you moving from? Just a street address is fine.');
    expect(setProfileMock).toHaveBeenCalledWith({ first_name: 'Greg' });
    // The scripted reply is persisted as a real transcript row.
    expect(modelRowInserts()).toContain(result.reply);
  });

  test('(b) seeded greeting + "Greg" → reply contains the name and asks where they are moving from', async () => {
    // Even a functionCall round followed by an empty finalization round (the
    // suspected exhaustion path) must land on the scripted step-2 line.
    mainGenerate
      .mockResolvedValueOnce(functionCallResult('set_user_profile', { first_name: 'Greg' }))
      .mockResolvedValue(emptyCandidateResult('MAX_TOKENS'));

    const result = await processMessage('user-1', 'Greg', [], 'basic');

    expect(result.reply).toContain('Greg');
    expect(result.reply).toMatch(/where are you moving from/i);
    expect(result.reply).not.toMatch(/didn't (quite )?catch/i);
  });

  test('(b2) round exhaustion on turn one recovers too', async () => {
    // Model never produces text: every round is another tool call until the
    // round budget is gone. Pre-fix this fell into "All set! What would you
    // like to do next?" — nonsense as a reply to "Greg".
    mainGenerate.mockResolvedValue(functionCallResult('get_user_profile'));

    const result = await processMessage('user-1', 'Greg', [], 'basic');

    expect(result.reply).toBe('Nice to meet you, Greg! Where are you moving from? Just a street address is fine.');
    const log = errorSpy.mock.calls.map(c => String(c[0])).find(s => s.includes('FIRST_TURN_FALLBACK'));
    expect(log).toBeTruthy();
    expect(log).toContain('tool_round_exhaustion');
  });

  test('(b3) a thrown model call on turn one recovers instead of surfacing a 500', async () => {
    mainGenerate.mockRejectedValue(new Error('fetch failed'));

    const result = await processMessage('user-1', 'Greg', [], 'basic');

    expect(result.reply).toBe('Nice to meet you, Greg! Where are you moving from? Just a street address is fine.');
    const log = errorSpy.mock.calls.map(c => String(c[0])).find(s => s.includes('FIRST_TURN_FALLBACK'));
    expect(log).toContain('exception');
    expect(log).toContain('fetch failed');
  });

  test('(c) non-name first message ("asdf!!!") → gentle re-ask, never the scripted name flow', async () => {
    mainGenerate.mockResolvedValue(emptyCandidateResult());

    const result = await processMessage('user-1', 'asdf!!!', [], 'basic');

    expect(result.reply).not.toMatch(/didn't (quite )?catch/i);
    expect(result.reply).not.toMatch(/nice to meet you/i);
    expect(result.reply).not.toContain('asdf'); // junk is never echoed as a name
    expect(result.reply).toMatch(/first name/i); // warm re-ask for the name
    expect(setProfileMock).not.toHaveBeenCalled();
  });

  test('(c2) a long sentence first message → gentle re-ask, not "Nice to meet you"', async () => {
    mainGenerate.mockResolvedValue(emptyCandidateResult());

    const result = await processMessage(
      'user-1', 'I have a big house with lots of stuff, what should I do first?', [], 'basic'
    );

    expect(result.reply).not.toMatch(/didn't (quite )?catch/i);
    expect(result.reply).not.toMatch(/nice to meet you/i);
    expect(result.reply).toMatch(/first name/i);
    expect(setProfileMock).not.toHaveBeenCalled();
  });

  test('(d) FIRST_TURN_FALLBACK forensics fire with the raw reason', async () => {
    mainGenerate.mockResolvedValue(emptyCandidateResult('SAFETY'));

    await processMessage('user-1', 'Greg', [], 'basic');

    const log = errorSpy.mock.calls.map(c => String(c[0])).find(s => s.includes('[orchestrator] FIRST_TURN_FALLBACK'));
    expect(log).toBeTruthy();
    expect(log).toContain('empty_model_reply');
    expect(log).toContain('SAFETY');
    expect(log).toContain('"Greg"'); // raw user message captured for forensics
  });

  test('a NORMAL first turn (model answers with text) is untouched by the recovery path', async () => {
    mainGenerate
      .mockResolvedValueOnce(functionCallResult('set_user_profile', { first_name: 'Greg' }))
      .mockResolvedValueOnce(textResult('Nice to meet you, Greg! Where are you moving from? Just a street address is fine.'));

    const result = await processMessage('user-1', 'Greg', [], 'basic');

    expect(result.reply).toMatch(/Nice to meet you, Greg/);
    expect(errorSpy.mock.calls.map(c => String(c[0])).join('\n')).not.toContain('FIRST_TURN_FALLBACK');
  });

  test('later-turn empty replies keep the legacy generic fallback for onboarded users (no regression)', async () => {
    mockState.user = { first_name: 'Greg', last_name: null, email: 'g@x.com', onboarding_completed: true };
    mockState.history = [
      { id: 1, role: 'model', content: 'Welcome back! Want to keep building your inventory?', tool_name: null, tool_args: null, tool_response: null, attachments: null },
      { id: 2, role: 'user', content: 'yes', tool_name: null, tool_args: null, tool_response: null, attachments: null },
      { id: 3, role: 'model', content: 'Great — which room?', tool_name: null, tool_args: null, tool_response: null, attachments: null },
    ];
    mainGenerate.mockResolvedValue(emptyCandidateResult());

    const result = await processMessage('user-1', 'kitchen', [], 'basic');

    expect(result.reply).toMatch(/didn't quite catch/i);
    expect(errorSpy.mock.calls.map(c => String(c[0])).join('\n')).not.toContain('FIRST_TURN_FALLBACK');
  });

  test('an onboarding user later in the flow gets a warm re-ask, never "didn\'t catch"', async () => {
    // Not the first turn (a prior user row exists) but onboarding is pending:
    // the generic string is context-aware as a last resort.
    mockState.history = [
      { id: 1, role: 'model', content: GREETING, tool_name: null, tool_args: null, tool_response: null, attachments: null },
      { id: 2, role: 'user', content: 'Greg', tool_name: null, tool_args: null, tool_response: null, attachments: null },
      { id: 3, role: 'model', content: 'Nice to meet you, Greg! Where are you moving from?', tool_name: null, tool_args: null, tool_response: null, attachments: null },
    ];
    mainGenerate.mockResolvedValue(emptyCandidateResult());

    const result = await processMessage('user-1', '12 Elm Street', [], 'basic');

    expect(result.reply).not.toMatch(/didn't quite catch/i);
    expect(result.reply).toMatch(/once more|say that again|tell me that/i);
  });
});

// ── Name-shape detector ───────────────────────────────────────────────────────

describe('extractNameCandidate — only name-shaped replies enter the scripted flow', () => {
  const { extractNameCandidate } = require('../../agents/nexusOrchestratorAgent');

  test.each([
    ['Greg', 'Greg', null],
    ['greg', 'Greg', null],
    ['Greg.', 'Greg', null],
    ['Owen Williams', 'Owen', 'Williams'],
    ["my name is Greg", 'Greg', null],
    ["Hi, I'm Greg", 'Greg', null],
    ["It's Mary-Jane O'Brien", 'Mary-Jane', "O'Brien"],
    ['call me Sarah', 'Sarah', null],
  ])('%p → first=%p last=%p', (input, first, last) => {
    expect(extractNameCandidate(input)).toEqual({ firstName: first, lastName: last });
  });

  test.each([
    ['asdf!!!'],
    ['yes'],
    ['ok'],
    ['hello'],
    ['What can you do?'],
    ['add my sofa please'],
    ['I am moving next week and need help with everything in my house'],
    ['12345'],
    ['greg@example.com'],
    [''],
    [null],
    [undefined],
  ])('%p → null (not a name)', (input) => {
    expect(extractNameCandidate(input)).toBeNull();
  });
});

// ── Session-type unification (the root cause) ────────────────────────────────

describe('greeting seed and orchestrator share session_type=nexus', () => {
  test('orchestrator resolves and creates its session as nexus', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../../agents/nexusOrchestratorAgent'), 'utf8');
    expect(src).toMatch(/session_type = 'nexus'/);
  });

  test('the /active-session greeting seed inserts a nexus session (was general — orphaned from the orchestrator)', async () => {
    jest.resetModules();
    const seedInserts = [];

    jest.doMock('../../services/infra/db', () => ({
      db: {
        any: jest.fn().mockResolvedValue([]),
        one: jest.fn(async (sql) => {
          seedInserts.push(sql);
          return { id: 'sess-new', user_id: 'user-1', session_type: 'nexus', title: null };
        }),
        oneOrNone: jest.fn(async (sql) => {
          if (/onboarding_completed/.test(sql)) return { onboarding_completed: false };
          return null;
        }),
        none: jest.fn().mockResolvedValue(undefined),
        tx: jest.fn(),
      },
    }));
    jest.doMock('../../services/infra/authService', () => ({
      authenticate: (req, _res, next) => { req.user = { user_id: 'user-1' }; next(); },
      resolveEffectivePlan: () => 'basic',
    }));
    jest.doMock('../../services/infra/agentSessionService', () => ({
      getActiveSession: jest.fn().mockResolvedValue(null),
      getSessionMessages: jest.fn().mockResolvedValue([]),
      enrichMessagesWithActions: (m) => m,
      getQuickStartChips: jest.fn().mockResolvedValue([]),
    }));
    jest.doMock('../../agents/nexusOrchestratorAgent', () => ({ processMessage: jest.fn() }));
    jest.doMock('../../agents/schemas/workflowGuidance', () => ({
      buildWorkflowGuidanceContext: jest.fn().mockResolvedValue({}),
    }));
    jest.doMock('../../agents/censusAgent', () => ({
      mapDetectedItemsForClient: (items) => items || [],
      scanAlreadyCommitted: jest.fn().mockResolvedValue(false),
      recordCensusToolCall: jest.fn().mockResolvedValue('sess-1'),
      recentReviewCommits: jest.fn().mockResolvedValue({ keys: new Set(), names: new Set(), scanIds: new Set() }),
      dedupKey: (n, r) => `${n}|${r}`,
    }));
    jest.doMock('../../services/infra/mediaAssetService', () => ({ reserveUpload: jest.fn(), ingestUpload: jest.fn() }));
    jest.doMock('../../services/infra/gcsService', () => ({ BUCKET: 'test-bucket', getSignedUploadUrl: jest.fn() }));
    jest.doMock('../../services/inventory/inventoryMutationService', () => ({
      addItem: jest.fn().mockResolvedValue({ success: true }),
      deleteItem: jest.fn().mockResolvedValue({ success: true }),
    }));
    jest.doMock('../../services/inventory/mediaInventoryWorkflowService', () => ({
      analyzeVideoForInventory: jest.fn(),
      analyzePhotoForInventory: jest.fn(),
    }));
    jest.doMock('../../services/inventory/scanJobService', () => ({
      createJob: jest.fn(), getJob: jest.fn(), listUnconsumed: jest.fn().mockResolvedValue([]),
      markConsumed: jest.fn(), toDTO: (r) => r, recoverStaleJobs: jest.fn().mockResolvedValue(0),
      isAllowedMediaUrl: () => true, UUID_RE: /^[0-9a-f-]{36}$/i,
    }));

    const request = require('supertest');
    const express = require('express');
    const router = require('../../routes/api/agents/nexus');
    const app = express();
    app.use('/api/agents/nexus', router);

    const res = await request(app).get('/api/agents/nexus/active-session');
    expect(res.status).toBe(200);

    const sessionInsert = seedInserts.find(sql => /INSERT INTO nexus_sessions/.test(sql));
    expect(sessionInsert).toBeTruthy();
    expect(sessionInsert).toContain("'nexus'");
    expect(sessionInsert).not.toContain("'general'");
  });
});
