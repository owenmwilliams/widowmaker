-- 048_add_agent_conversations.sql
--
-- The real vendor agent — LLM brain for the chat widget (W1c, #117).
--
--   agent_conversations — one row per widget-chat conversation with a
--       vendor's model-run agent (POST /api/agent/:token/converse).
--       `transcript` is the full turn log (user/assistant/tool events),
--       `state` is what the agent has established so far (answers gathered,
--       customer email, quoteId once priced, reservation once reserved) so a
--       reload — or a mid-conversation fallback to the deterministic battery
--       — never re-asks what the customer already answered. `turns` backs
--       the per-conversation cap (40): past it the agent hands off politely
--       instead of burning tokens forever.
--
--   companies gains the agent's scheduling + intake knobs (Mode B-lite):
--       capacity_per_day — how many jobs the company takes per date; the
--           availability check counts pending_confirmation+confirmed
--           booking_reservations per date against it.
--       blackout_days   — JSONB array of 'YYYY-MM-DD' the company never
--           books (holidays, maintenance days).
--       intake_specs    — JSONB array of {key, question}: mover-defined
--           extra intake questions merged into the estimator battery on
--           every surface (converse brain + MCP get_intake_questions).
--
-- Keep in sync with db/init-movetrack.sql (scripts/check-schema-drift.js).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS capacity_per_day INTEGER NOT NULL DEFAULT 2;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS blackout_days JSONB NOT NULL DEFAULT '[]';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS intake_specs JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS agent_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_email VARCHAR(255),
    state JSONB NOT NULL DEFAULT '{}',
    transcript JSONB NOT NULL DEFAULT '[]',
    turns INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_company
    ON agent_conversations(company_id, created_at);
