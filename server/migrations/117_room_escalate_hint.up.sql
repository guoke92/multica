-- v2.3: visible escalation banner message kind (chat timeline, not hidden system_dispatch).

ALTER TABLE room_message DROP CONSTRAINT IF EXISTS room_message_message_kind_check;
ALTER TABLE room_message ADD CONSTRAINT room_message_message_kind_check
    CHECK (message_kind IN (
        'chat', 'system_dispatch', 'system_milestone', 'card', 'manager_summary',
        'route_hint', 'relay_hint', 'agent_at', 'escalate_hint'
    ));
