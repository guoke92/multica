-- Rollback Migration 113: Router/Supervisor Mode

ALTER TABLE room_message DROP CONSTRAINT IF EXISTS room_message_message_kind_check;
ALTER TABLE room_message ADD CONSTRAINT room_message_message_kind_check
    CHECK (message_kind IN ('chat', 'system_dispatch', 'system_milestone', 'card', 'manager_summary'));

ALTER TABLE mention_invocation DROP CONSTRAINT IF EXISTS mention_invocation_intent_check;
ALTER TABLE mention_invocation ADD CONSTRAINT mention_invocation_intent_check
    CHECK (intent IN ('ask', 'execute', 'review', 'confirm', 'arbitrate', 'orchestrate'));

ALTER TABLE room_message DROP COLUMN IF EXISTS relay_metadata;
