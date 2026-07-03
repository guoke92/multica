-- Room Graph schema (final): Message / Mention / Assignment / Dependency / Invocation / Decision / Event.
-- Cleans legacy room workflow tables and creates final room collaboration schema.

DELETE FROM agent_task_queue WHERE room_id IS NOT NULL;
DELETE FROM approval_request WHERE room_id IS NOT NULL;
DELETE FROM room_message WHERE room_id IN (SELECT id FROM room);

-- Drop legacy workflow tables (dependency order).
DROP TABLE IF EXISTS room_flow_events CASCADE;
DROP TABLE IF EXISTS room_human_actions CASCADE;
DROP TABLE IF EXISTS room_topic CASCADE;
DROP TABLE IF EXISTS room_delivery CASCADE;
DROP TABLE IF EXISTS mention_invocation CASCADE;

-- agent_task_queue: re-point invocation_id to room_invocation (after table exists).
ALTER TABLE agent_task_queue DROP CONSTRAINT IF EXISTS agent_task_queue_invocation_id_fkey;
ALTER TABLE agent_task_queue ALTER COLUMN invocation_id DROP NOT NULL;

-- Simplify room_message (content fact only).
ALTER TABLE room_message DROP COLUMN IF EXISTS delivery_id;
ALTER TABLE room_message DROP COLUMN IF EXISTS topic_id;
ALTER TABLE room_message DROP COLUMN IF EXISTS message_kind;
ALTER TABLE room_message DROP COLUMN IF EXISTS relay_metadata;

DROP INDEX IF EXISTS idx_room_message_delivery;

-- approval_request: link to room_invocation instead of mention_invocation.
ALTER TABLE approval_request DROP CONSTRAINT IF EXISTS approval_request_invocation_id_fkey;
ALTER TABLE approval_request RENAME COLUMN invocation_id TO room_invocation_id;

-- Collaboration assignments (mention, auto_review, manager_route, join, etc.).
CREATE TABLE room_assignment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    source_message_id UUID NOT NULL REFERENCES room_message(id) ON DELETE CASCADE,
    assignee_type TEXT NOT NULL CHECK (assignee_type IN ('agent', 'squad', 'member', 'user')),
    assignee_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (
        'mention', 'auto_review', 'manager_route', 'manager_relay',
        'approval', 'retry', 'timeout_review', 'reassign', 'join'
    )),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'blocked', 'running', 'completed', 'failed', 'cancelled', 'skipped'
    )),
    reason TEXT,
    output_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    failure_acknowledged_at TIMESTAMPTZ,
    failure_acknowledged_by UUID,
    superseded_by_assignment_id UUID REFERENCES room_assignment(id) ON DELETE SET NULL,
    created_by_type TEXT NOT NULL DEFAULT 'system'
        CHECK (created_by_type IN ('user', 'agent', 'system')),
    created_by_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_assignment_room_status ON room_assignment(room_id, status);
CREATE INDEX idx_room_assignment_source_message ON room_assignment(source_message_id);
CREATE INDEX idx_room_assignment_room_active ON room_assignment(room_id, updated_at DESC)
    WHERE status NOT IN ('completed', 'cancelled', 'skipped');

CREATE INDEX idx_room_assignment_attention_failed ON room_assignment(room_id)
    WHERE status = 'failed'
      AND failure_acknowledged_at IS NULL
      AND superseded_by_assignment_id IS NULL;

-- Structured @mentions on messages.
CREATE TABLE room_message_mention (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES room_message(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('agent', 'squad', 'member', 'all')),
    target_id UUID,
    source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'agent_mention', 'manager_dispatch')),
    source_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    assignment_id UUID REFERENCES room_assignment(id) ON DELETE SET NULL,
    label TEXT NOT NULL DEFAULT '',
    span_start INT,
    span_end INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_message_mention_message ON room_message_mention(message_id);
CREATE INDEX idx_room_message_mention_source_message ON room_message_mention(source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX idx_room_message_mention_assignment ON room_message_mention(assignment_id) WHERE assignment_id IS NOT NULL;

-- Join / barrier: blocked assignment waits on prerequisite assignments.
CREATE TABLE room_assignment_dependency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES room_assignment(id) ON DELETE CASCADE,
    depends_on_assignment_id UUID NOT NULL REFERENCES room_assignment(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (assignment_id, depends_on_assignment_id),
    CHECK (assignment_id <> depends_on_assignment_id)
);

CREATE INDEX idx_room_assignment_dep_assignment ON room_assignment_dependency(assignment_id);
CREATE INDEX idx_room_assignment_dep_depends_on ON room_assignment_dependency(depends_on_assignment_id);

-- Execution attempts for an assignment.
CREATE TABLE room_invocation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    assignment_id UUID NOT NULL REFERENCES room_assignment(id) ON DELETE CASCADE,
    source_message_id UUID NOT NULL REFERENCES room_message(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    intent TEXT NOT NULL DEFAULT 'ask' CHECK (intent IN (
        'ask', 'execute', 'review', 'confirm', 'arbitrate', 'orchestrate', 'route', 'relay'
    )),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled'
    )),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 1,
    task_id UUID REFERENCES agent_task_queue(id) ON DELETE SET NULL,
    output_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    outcome JSONB,
    failure_reason TEXT,
    timeout_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_invocation_assignment ON room_invocation(assignment_id);
CREATE INDEX idx_room_invocation_room_status ON room_invocation(room_id, status)
    WHERE status NOT IN ('succeeded', 'cancelled');
CREATE INDEX idx_room_invocation_task ON room_invocation(task_id) WHERE task_id IS NOT NULL;

-- At most one active invocation per assignment.
CREATE UNIQUE INDEX idx_room_invocation_active_per_assignment
    ON room_invocation(assignment_id)
    WHERE status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled');

-- Manager decisions (audit trail; may create downstream assignments).
CREATE TABLE room_manager_decision (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    source_message_id UUID NOT NULL REFERENCES room_message(id) ON DELETE CASCADE,
    invocation_id UUID REFERENCES room_invocation(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN (
        'assign', 'complete', 'wait', 'ask_user', 'retry', 'reassign', 'skip'
    )),
    payload JSONB NOT NULL DEFAULT '{}',
    created_assignment_ids UUID[] NOT NULL DEFAULT '{}',
    created_by_type TEXT NOT NULL DEFAULT 'agent'
        CHECK (created_by_type IN ('user', 'agent', 'system')),
    created_by_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_manager_decision_room ON room_manager_decision(room_id, created_at DESC);

-- Append-only invocation events for flow timeline projection.
CREATE TABLE room_invocation_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    assignment_id UUID NOT NULL REFERENCES room_assignment(id) ON DELETE CASCADE,
    invocation_id UUID REFERENCES room_invocation(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
    actor_id UUID,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_invocation_event_room_created
    ON room_invocation_event(room_id, created_at DESC);
CREATE INDEX idx_room_invocation_event_assignment
    ON room_invocation_event(assignment_id, created_at ASC);

-- Re-link agent_task_queue.invocation_id → room_invocation.
ALTER TABLE agent_task_queue
    ADD CONSTRAINT agent_task_queue_invocation_id_fkey
    FOREIGN KEY (invocation_id) REFERENCES room_invocation(id) ON DELETE SET NULL;

ALTER TABLE approval_request
    ADD CONSTRAINT approval_request_room_invocation_id_fkey
    FOREIGN KEY (room_invocation_id) REFERENCES room_invocation(id) ON DELETE SET NULL;
