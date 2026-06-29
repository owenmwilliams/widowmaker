-- 027_add_user_costs.sql
-- Per-user daily AI spend rollup for cost metering + hard caps (B4).
-- One row per (user, day); recordUsage() upserts increments. Daily and
-- month-to-date spend are summed from this table to enforce budget caps.

CREATE TABLE IF NOT EXISTS user_costs (
    user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    usage_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    calls         INTEGER NOT NULL DEFAULT 0,
    input_tokens  BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cost_usd      NUMERIC(12,6) NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_user_costs_date ON user_costs(usage_date);
