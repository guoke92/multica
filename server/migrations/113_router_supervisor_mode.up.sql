-- Migration 113: Router/Supervisor Mode
-- Extends the collaboration room from orchestrator model to router+supervisor model.

-- 1. Extend message_kind to support route/relay/agent-at hint messages.
ALTER TABLE room_message DROP CONSTRAINT IF EXISTS room_message_message_kind_check;
ALTER TABLE room_message ADD CONSTRAINT room_message_message_kind_check
    CHECK (message_kind IN (
        'chat', 'system_dispatch', 'system_milestone', 'card', 'manager_summary',
        'route_hint', 'relay_hint', 'agent_at'
    ));

-- 2. Extend mention_invocation intent for router/supervisor flows.
ALTER TABLE mention_invocation DROP CONSTRAINT IF EXISTS mention_invocation_intent_check;
ALTER TABLE mention_invocation ADD CONSTRAINT mention_invocation_intent_check
    CHECK (intent IN (
        'ask', 'execute', 'review', 'confirm', 'arbitrate', 'orchestrate',
        'route', 'relay', 'escalate'
    ));

-- 3. Structured metadata for route/relay/agent-at system messages.
--    Stores from/to agent ids, names, and relay reason.
ALTER TABLE room_message
    ADD COLUMN IF NOT EXISTS relay_metadata JSONB DEFAULT NULL;
