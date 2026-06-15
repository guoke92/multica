-- ChatCollab: Room-based group collaboration (parallel to chat_session 1:1).

CREATE TABLE room (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'project'
        CHECK (type IN ('project', 'temporary', 'dm', 'system')),
    created_by UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    manager_agent_id UUID REFERENCES agent(id) ON DELETE SET NULL,
    policy JSONB NOT NULL DEFAULT '{}',
    snapshot JSONB NOT NULL DEFAULT '{}',
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_workspace ON room(workspace_id);
CREATE INDEX idx_room_workspace_updated ON room(workspace_id, updated_at DESC);

CREATE TABLE room_member (
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'agent', 'squad')),
    principal_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    permissions JSONB NOT NULL DEFAULT '{}',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    removed_at TIMESTAMPTZ,
    PRIMARY KEY (room_id, principal_type, principal_id)
);

CREATE INDEX idx_room_member_user ON room_member(principal_type, principal_id)
    WHERE principal_type = 'user' AND removed_at IS NULL;

CREATE TABLE room_message (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'agent', 'system')),
    sender_id UUID,
    content TEXT NOT NULL DEFAULT '',
    quote_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    linked_issue_id UUID REFERENCES issue(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_room_message_room_created ON room_message(room_id, created_at DESC);
CREATE INDEX idx_room_message_linked_issue ON room_message(linked_issue_id)
    WHERE linked_issue_id IS NOT NULL;

CREATE TABLE mention_invocation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES room_message(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('agent', 'squad', 'member', 'all')),
    target_id UUID NOT NULL,
    intent TEXT NOT NULL DEFAULT 'ask' CHECK (intent IN ('ask', 'execute', 'review', 'confirm', 'arbitrate')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending', 'delivered', 'queued', 'running',
            'succeeded', 'failed', 'timed_out', 'cancelled', 'paused'
        )),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 1,
    task_id UUID REFERENCES agent_task_queue(id) ON DELETE SET NULL,
    response_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    failure_reason TEXT,
    parent_invocation_id UUID REFERENCES mention_invocation(id) ON DELETE SET NULL,
    chain_depth INT NOT NULL DEFAULT 0,
    timeout_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mention_invocation_room_status ON mention_invocation(room_id, status)
    WHERE status NOT IN ('succeeded', 'cancelled');
CREATE INDEX idx_mention_invocation_message ON mention_invocation(message_id);
CREATE INDEX idx_mention_invocation_task ON mention_invocation(task_id)
    WHERE task_id IS NOT NULL;

CREATE TABLE approval_request (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES room_message(id) ON DELETE CASCADE,
    invocation_id UUID REFERENCES mention_invocation(id) ON DELETE SET NULL,
    requester_type TEXT NOT NULL CHECK (requester_type IN ('agent', 'system')),
    requester_id UUID NOT NULL,
    action_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    decided_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    reject_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_request_room ON approval_request(room_id, status);

-- Issue provenance from Room messages.
ALTER TABLE issue ADD COLUMN IF NOT EXISTS source_room_id UUID REFERENCES room(id) ON DELETE SET NULL;
ALTER TABLE issue ADD COLUMN IF NOT EXISTS source_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_issue_source_room ON issue(source_room_id) WHERE source_room_id IS NOT NULL;

ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_origin_type_check;
ALTER TABLE issue ADD CONSTRAINT issue_origin_type_check
    CHECK (origin_type IS NULL OR origin_type IN ('autopilot', 'quick_create', 'room_message'));

-- Task queue linkage for Room invocations.
ALTER TABLE agent_task_queue ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES room(id) ON DELETE SET NULL;
ALTER TABLE agent_task_queue ADD COLUMN IF NOT EXISTS room_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL;
ALTER TABLE agent_task_queue ADD COLUMN IF NOT EXISTS invocation_id UUID REFERENCES mention_invocation(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_task_queue_room_pending
    ON agent_task_queue(room_id, agent_id, created_at)
    WHERE room_id IS NOT NULL AND status IN ('queued', 'dispatched', 'running', 'waiting_local_directory');
