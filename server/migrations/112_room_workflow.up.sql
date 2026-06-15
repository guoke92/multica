-- Room workflow: deliveries, topics, manager routing, extended messages/invocations.

CREATE TABLE room_delivery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'intake'
        CHECK (status IN ('intake', 'in_progress', 'blocked', 'done', 'cancelled')),
    workflow_template TEXT NOT NULL DEFAULT '',
    current_phase TEXT NOT NULL DEFAULT '',
    card_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    anchor_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    linked_issue_id UUID REFERENCES issue(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_delivery_room_active ON room_delivery(room_id, updated_at DESC)
    WHERE status NOT IN ('done', 'cancelled');

CREATE TABLE room_topic (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    delivery_id UUID NOT NULL REFERENCES room_delivery(id) ON DELETE CASCADE,
    parent_topic_id UUID REFERENCES room_topic(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'done', 'failed', 'skipped')),
    phase_key TEXT NOT NULL DEFAULT '',
    assignee_agent_id UUID REFERENCES agent(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_topic_delivery ON room_topic(delivery_id);

ALTER TABLE room_message
    ADD COLUMN IF NOT EXISTS delivery_id UUID REFERENCES room_delivery(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES room_topic(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS message_kind TEXT NOT NULL DEFAULT 'chat'
        CHECK (message_kind IN ('chat', 'system_dispatch', 'system_milestone', 'card', 'manager_summary'));

CREATE INDEX idx_room_message_delivery ON room_message(delivery_id)
    WHERE delivery_id IS NOT NULL;

ALTER TABLE mention_invocation
    ADD COLUMN IF NOT EXISTS delivery_id UUID REFERENCES room_delivery(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES room_topic(id) ON DELETE SET NULL;

ALTER TABLE mention_invocation DROP CONSTRAINT IF EXISTS mention_invocation_intent_check;
ALTER TABLE mention_invocation ADD CONSTRAINT mention_invocation_intent_check
    CHECK (intent IN ('ask', 'execute', 'review', 'confirm', 'arbitrate', 'orchestrate'));

CREATE INDEX idx_mention_invocation_delivery ON mention_invocation(delivery_id)
    WHERE delivery_id IS NOT NULL;

-- Room tasks may carry workflow context (mirrors quick_create pattern).
ALTER TABLE agent_task_queue
    ALTER COLUMN context SET DEFAULT '{}'::jsonb;

-- Extend CreateRoomTask path: context stored via separate update or new insert — column already exists.
