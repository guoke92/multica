-- Room v2.3: flow events, human actions, topic extensions.

CREATE TABLE room_flow_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    topic_id UUID NOT NULL REFERENCES room_topic(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    invocation_id UUID REFERENCES mention_invocation(id) ON DELETE SET NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
    actor_id UUID,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_flow_events_room_topic_created
    ON room_flow_events(room_id, topic_id, created_at DESC);
CREATE INDEX idx_room_flow_events_room_created
    ON room_flow_events(room_id, created_at DESC);

CREATE TABLE room_human_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    topic_id UUID NOT NULL REFERENCES room_topic(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES room_message(id) ON DELETE CASCADE,
    invocation_id UUID REFERENCES mention_invocation(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    assignee_id UUID REFERENCES "user"(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    reason TEXT,
    expires_at TIMESTAMPTZ,
    decided_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_human_actions_room_status
    ON room_human_actions(room_id, status);
CREATE INDEX idx_room_human_actions_topic_status
    ON room_human_actions(topic_id, status);

ALTER TABLE room_topic
    ADD COLUMN IF NOT EXISTS root_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS last_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS event_count INT NOT NULL DEFAULT 0;

ALTER TABLE room_topic DROP CONSTRAINT IF EXISTS room_topic_status_check;
ALTER TABLE room_topic ADD CONSTRAINT room_topic_status_check
    CHECK (status IN (
        'pending', 'in_progress', 'done', 'failed', 'skipped',
        'open', 'closing', 'closed'
    ));
