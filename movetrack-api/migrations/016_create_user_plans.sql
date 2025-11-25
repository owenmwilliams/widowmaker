-- Create user_plans table for subscription management
CREATE TABLE IF NOT EXISTS user_plans (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL UNIQUE,
    plan_tier VARCHAR(50) NOT NULL DEFAULT 'basic',
    plan_source VARCHAR(50) NOT NULL DEFAULT 'basic',
    plan_status VARCHAR(50) NOT NULL DEFAULT 'basic',
    plan_expires_at TIMESTAMPTZ,
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on user_email for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_plans_email ON user_plans(user_email);
