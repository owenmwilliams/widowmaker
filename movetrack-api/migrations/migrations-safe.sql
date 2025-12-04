-- Safe migration script that can be run multiple times
-- This updates existing database to add auth tables and fix users table

\connect movetrack_db;

-- Update users table to make user_name optional and email required
-- First, check if we need to modify columns
DO $$ 
BEGIN
    -- Make user_name nullable if it isn't already
    ALTER TABLE users ALTER COLUMN user_name DROP NOT NULL;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- Add new columns to users table if they don't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Make email NOT NULL if there are no null emails
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE email IS NULL) THEN
        ALTER TABLE users ALTER COLUMN email SET NOT NULL;
    END IF;
END $$;

-- Create auth_tokens table if it doesn't exist
CREATE TABLE IF NOT EXISTS auth_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    token_type VARCHAR(50) NOT NULL, -- 'magic_link' or 'session'
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ip_address VARCHAR(45),
    user_agent TEXT
);

-- Create login_history table if it doesn't exist
CREATE TABLE IF NOT EXISTS login_history (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    login_method VARCHAR(50) NOT NULL, -- 'magic_link', 'password', 'google', etc.
    success BOOLEAN NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    failure_reason VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires_at ON auth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_created_at ON login_history(created_at);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Track AI-generated size/weight estimates for inventory items
CREATE TABLE IF NOT EXISTS item_estimate_events (
    id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128),
    prompt TEXT,
    request_context JSONB,
    response_text TEXT,
    response_json JSONB,
    estimated_weight_lbs NUMERIC,
    estimated_length_in NUMERIC,
    estimated_width_in NUMERIC,
    estimated_height_in NUMERIC,
    volume_cuft NUMERIC,
    confidence NUMERIC,
    notes TEXT,
    token_usage JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_estimate_events_item_id ON item_estimate_events(item_id);
CREATE INDEX IF NOT EXISTS idx_item_estimate_events_user_id ON item_estimate_events(user_id);
CREATE INDEX IF NOT EXISTS idx_item_estimate_events_created_at ON item_estimate_events(created_at);

-- Verify setup
SELECT 'Migration completed successfully!' as status;
