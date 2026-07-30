-- Human-in-the-loop prompts: manager/assistant ↔ user interactions shown above the composer.
CREATE TABLE room_human_interaction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('notify', 'ask', 'confirm', 'approve')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'responded', 'dismissed', 'expired')),
    title TEXT,
    body TEXT NOT NULL DEFAULT '',
    options JSONB NOT NULL DEFAULT '[]',
    allow_custom_response BOOLEAN NOT NULL DEFAULT false,
    invocation_id UUID REFERENCES room_invocation(id) ON DELETE SET NULL,
    assignment_id UUID REFERENCES room_assignment(id) ON DELETE SET NULL,
    decision_id UUID REFERENCES room_manager_decision(id) ON DELETE SET NULL,
    approval_request_id UUID REFERENCES approval_request(id) ON DELETE SET NULL,
    created_by_type TEXT NOT NULL CHECK (created_by_type IN ('agent', 'system')),
    created_by_id UUID,
    response_text TEXT,
    response_option_id TEXT,
    responded_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
    responded_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_human_interaction_room_pending
    ON room_human_interaction(room_id, created_at DESC)
    WHERE status = 'pending';

CREATE INDEX idx_room_human_interaction_invocation
    ON room_human_interaction(invocation_id)
    WHERE invocation_id IS NOT NULL;
