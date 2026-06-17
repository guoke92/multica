ALTER TABLE room_message DROP CONSTRAINT IF EXISTS room_message_message_kind_check;
ALTER TABLE room_message ADD CONSTRAINT room_message_message_kind_check
    CHECK (message_kind IN (
        'chat', 'system_dispatch', 'system_milestone', 'card', 'manager_summary',
        'route_hint', 'relay_hint', 'agent_at'
    ));
