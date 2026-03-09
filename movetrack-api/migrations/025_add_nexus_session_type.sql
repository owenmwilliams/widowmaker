-- Add 'nexus' session type for the orchestrator agent
-- Note: 'vector' was already added live; this documents both additions
ALTER TABLE nexus_sessions DROP CONSTRAINT IF EXISTS nexus_sessions_session_type_check;
ALTER TABLE nexus_sessions ADD CONSTRAINT nexus_sessions_session_type_check
  CHECK (session_type IN ('onboarding', 'census', 'general', 'vector', 'nexus'));
