-- Room graph: mentions, assignments, dependencies, invocations, decisions, events.

-- name: CreateRoomMessageMention :one
INSERT INTO room_message_mention (
    id, message_id, target_type, target_id, label, span_start, span_end,
    source_type, source_message_id, assignment_id
)
VALUES (
    sqlc.arg('id'), sqlc.arg('message_id'), sqlc.arg('target_type'), sqlc.arg('target_id'),
    COALESCE(sqlc.narg('label'), ''),
    sqlc.narg('span_start'), sqlc.narg('span_end'),
    COALESCE(sqlc.narg('source_type'), 'manual'),
    sqlc.narg('source_message_id'),
    sqlc.narg('assignment_id')
)
RETURNING *;

-- name: UpdateRoomMessageMentionAssignment :one
UPDATE room_message_mention
SET assignment_id = sqlc.arg('assignment_id')
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: ListRoomMessageMentionsByAssignment :many
SELECT * FROM room_message_mention WHERE assignment_id = $1 ORDER BY id ASC;

-- name: ListRoomMessageMentionsByMessage :many
SELECT * FROM room_message_mention WHERE message_id = $1 ORDER BY id ASC;

-- name: ListRoomMessageMentionsByRoom :many
SELECT m.*
FROM room_message_mention m
JOIN room_message msg ON msg.id = m.message_id
WHERE msg.room_id = $1
ORDER BY m.id ASC;

-- name: CreateRoomAssignment :one
INSERT INTO room_assignment (
    id, room_id, source_message_id, assignee_type, assignee_id, kind, status, reason,
    created_by_type, created_by_id
)
VALUES (
    sqlc.arg('id'), sqlc.arg('room_id'), sqlc.arg('source_message_id'),
    sqlc.arg('assignee_type'), sqlc.arg('assignee_id'), sqlc.arg('kind'), sqlc.arg('status'),
    sqlc.narg('reason'), sqlc.arg('created_by_type'), sqlc.narg('created_by_id')
)
RETURNING *;

-- name: GetRoomAssignment :one
SELECT * FROM room_assignment WHERE id = $1;

-- name: GetRoomAssignmentInRoom :one
SELECT * FROM room_assignment WHERE id = $1 AND room_id = $2;

-- name: TransitionRoomAssignmentStatus :one
-- CAS status write: only applies when the current status is one of from_status.
-- Returns no rows (pgx.ErrNoRows) when the assignment was already moved by a
-- concurrent path — callers must treat that as an idempotent no-op, never an error.
UPDATE room_assignment
SET status = sqlc.arg('to_status'),
    output_message_id = COALESCE(sqlc.narg('output_message_id'), output_message_id),
    reason = COALESCE(sqlc.narg('reason'), reason),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND status = ANY(sqlc.arg('from_status')::text[])
RETURNING *;

-- name: UnblockRoomAssignmentIfBlocked :one
UPDATE room_assignment
SET status = 'pending',
    updated_at = now()
WHERE id = $1
  AND status = 'blocked'
RETURNING *;

-- name: ListRoomAssignmentsByRoom :many
SELECT * FROM room_assignment
WHERE room_id = $1
ORDER BY id ASC;

-- name: ListRoomAssignmentsBySourceMessage :many
SELECT * FROM room_assignment
WHERE source_message_id = $1
ORDER BY id ASC;

-- name: ListActiveRoomAssignmentsByRoom :many
SELECT * FROM room_assignment
WHERE room_id = $1
  AND status NOT IN ('completed', 'cancelled', 'skipped')
ORDER BY id ASC;

-- name: CountRoomAssignmentStatusByRoom :one
SELECT
    COUNT(*) FILTER (WHERE ra.status = 'pending')::int AS pending_count,
    COUNT(*) FILTER (WHERE ra.status = 'blocked')::int AS blocked_count,
    COUNT(*) FILTER (WHERE ra.status = 'running')::int AS running_count,
    COUNT(*) FILTER (
        WHERE ra.status = 'failed'
          AND ra.failure_acknowledged_at IS NULL
          AND ra.superseded_by_assignment_id IS NULL
          AND ra.id = (
              SELECT MAX(sub.id)
              FROM room_assignment sub
              WHERE sub.room_id = ra.room_id
                AND sub.assignee_id = ra.assignee_id
                AND sub.source_message_id = ra.source_message_id
          )
    )::int AS failed_count,
    COUNT(*) FILTER (WHERE ra.status = 'completed')::int AS completed_count
FROM room_assignment ra
WHERE ra.room_id = $1
  AND ra.status NOT IN ('cancelled', 'skipped');

-- name: CountActiveRoomInvocationsByRoom :one
SELECT
    COUNT(*) FILTER (WHERE status IN ('pending', 'queued'))::int AS queued_count,
    COUNT(*) FILTER (WHERE status IN ('running', 'delivered'))::int AS active_running_count
FROM room_invocation
WHERE room_id = $1
  AND status IN ('pending', 'queued', 'running', 'delivered');

-- name: CountManagerActiveInvocationsByRoom :one
SELECT COUNT(*)::int AS manager_active_count
FROM room_invocation i
JOIN room_assignment a ON a.id = i.assignment_id
JOIN room r ON r.id = i.room_id
WHERE i.room_id = $1
  AND i.status IN ('pending', 'queued', 'running', 'delivered')
  AND (
    a.kind IN ('auto_review', 'manager_route', 'manager_relay')
    OR (
      a.assignee_type = 'agent'
      AND r.manager_agent_id IS NOT NULL
      AND a.assignee_id = r.manager_agent_id
    )
  );

-- name: AcknowledgeRoomAssignmentFailure :one
UPDATE room_assignment
SET failure_acknowledged_at = now(),
    failure_acknowledged_by = sqlc.narg('failure_acknowledged_by'),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND room_id = sqlc.arg('room_id')
  AND status = 'failed'
  AND failure_acknowledged_at IS NULL
RETURNING *;

-- name: MarkRoomAssignmentSuperseded :one
UPDATE room_assignment
SET superseded_by_assignment_id = sqlc.arg('superseded_by_assignment_id'),
    failure_acknowledged_at = COALESCE(failure_acknowledged_at, now()),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND room_id = sqlc.arg('room_id')
  AND status = 'failed'
  AND superseded_by_assignment_id IS NULL
RETURNING *;

-- name: SupersedeEarlierFailedAssignmentsOnTrack :execrows
UPDATE room_assignment AS older
SET superseded_by_assignment_id = sqlc.arg('new_assignment_id'),
    failure_acknowledged_at = COALESCE(older.failure_acknowledged_at, now()),
    updated_at = now()
WHERE older.room_id = sqlc.arg('room_id')
  AND older.source_message_id = sqlc.arg('source_message_id')
  AND older.assignee_id = sqlc.arg('assignee_id')
  AND older.status = 'failed'
  AND older.id <> sqlc.arg('new_assignment_id')
  AND older.id < sqlc.arg('new_assignment_id')
  AND older.superseded_by_assignment_id IS NULL;

-- name: CreateRoomAssignmentDependency :one
INSERT INTO room_assignment_dependency (assignment_id, depends_on_assignment_id)
VALUES ($1, $2)
RETURNING *;

-- name: ListRoomAssignmentDependenciesByAssignment :many
SELECT * FROM room_assignment_dependency
WHERE assignment_id = $1
ORDER BY id ASC;

-- name: ListRoomAssignmentDependenciesByRoom :many
SELECT d.*
FROM room_assignment_dependency d
JOIN room_assignment a ON a.id = d.assignment_id
WHERE a.room_id = $1
ORDER BY d.id ASC;

-- name: ListIncompleteDependenciesForAssignment :many
SELECT dep.*
FROM room_assignment_dependency dep
JOIN room_assignment prereq ON prereq.id = dep.depends_on_assignment_id
WHERE dep.assignment_id = $1
  AND prereq.status <> 'completed';

-- name: LockBlockedAssignmentsDependingOn :many
SELECT a.*
FROM room_assignment a
JOIN room_assignment_dependency d ON d.assignment_id = a.id
WHERE d.depends_on_assignment_id = $1
  AND a.status = 'blocked'
FOR UPDATE OF a;

-- name: CreateRoomInvocation :one
INSERT INTO room_invocation (
    id, room_id, assignment_id, source_message_id, agent_id, intent, status,
    priority, max_retries, timeout_at, outcome
)
VALUES (
    sqlc.arg('id'), sqlc.arg('room_id'), sqlc.arg('assignment_id'), sqlc.arg('source_message_id'),
    sqlc.arg('agent_id'), sqlc.arg('intent'), sqlc.arg('status'),
    COALESCE(sqlc.narg('priority'), 'normal'), sqlc.arg('max_retries'), sqlc.arg('timeout_at'),
    COALESCE(sqlc.narg('outcome')::jsonb, '{}'::jsonb)
)
RETURNING *;

-- name: UpdateRoomInvocationOutcome :one
UPDATE room_invocation
SET outcome = COALESCE(sqlc.narg('outcome')::jsonb, outcome),
    updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: GetRoomInvocation :one
SELECT * FROM room_invocation WHERE id = $1;

-- name: GetRoomInvocationInRoom :one
SELECT * FROM room_invocation WHERE id = $1 AND room_id = $2;

-- name: GetActiveRoomInvocationForAssignment :one
SELECT * FROM room_invocation
WHERE assignment_id = $1
  AND status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')
ORDER BY id DESC
LIMIT 1;

-- name: UpdateRoomInvocationStatus :one
UPDATE room_invocation
SET status = $2,
    task_id = COALESCE(sqlc.narg('task_id'), task_id),
    output_message_id = COALESCE(sqlc.narg('output_message_id'), output_message_id),
    failure_reason = COALESCE(sqlc.narg('failure_reason'), failure_reason),
    started_at = COALESCE(sqlc.narg('started_at'), started_at),
    completed_at = COALESCE(sqlc.narg('completed_at'), completed_at),
    retry_count = COALESCE(sqlc.narg('retry_count'), retry_count),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CancelRoomInvocation :one
UPDATE room_invocation
SET status = 'cancelled',
    cancelled_by = $2,
    cancelled_at = now(),
    updated_at = now()
WHERE id = $1 AND status NOT IN ('succeeded', 'cancelled')
RETURNING *;

-- name: ClaimRoomInvocationTask :one
-- Atomically attaches a task to a queued invocation. Only one concurrent drain
-- can win the claim (task_id IS NULL guard); losers get no rows and must cancel
-- the task they speculatively created.
UPDATE room_invocation
SET task_id = sqlc.arg('task_id'),
    status = 'queued',
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND task_id IS NULL
  AND status = 'queued'
RETURNING *;

-- name: ListRoomInvocationsByRoom :many
SELECT * FROM room_invocation
WHERE room_id = $1
ORDER BY id ASC;

-- name: ListRoomInvocationsByAssignment :many
SELECT * FROM room_invocation
WHERE assignment_id = $1
ORDER BY id ASC;

-- name: ListQueuedRoomInvocationsForAgent :many
SELECT * FROM room_invocation
WHERE agent_id = $1
  AND status = 'queued'
ORDER BY id ASC
LIMIT $2;

-- name: ListQueuedRoomInvocations :many
SELECT * FROM room_invocation
WHERE status = 'queued'
ORDER BY id ASC
LIMIT $1;

-- name: ListTimedOutRunningRoomInvocations :many
SELECT * FROM room_invocation
WHERE status = 'running'
  AND started_at IS NOT NULL
  AND timeout_at IS NOT NULL
  AND timeout_at < now()
ORDER BY timeout_at ASC
LIMIT $1;

-- name: ListRunningRoomInvocationsForSoftWarn :many
SELECT * FROM room_invocation
WHERE status = 'running'
  AND started_at IS NOT NULL
ORDER BY started_at ASC
LIMIT $1;

-- name: GetRoomInvocationByOutputMessage :one
SELECT * FROM room_invocation
WHERE output_message_id = $1 AND room_id = $2
LIMIT 1;

-- name: CreateRoomManagerDecision :one
INSERT INTO room_manager_decision (
    id, room_id, source_message_id, invocation_id, action, payload,
    created_assignment_ids, created_by_type, created_by_id
)
VALUES (
    sqlc.arg('id'), sqlc.arg('room_id'), sqlc.arg('source_message_id'),
    sqlc.narg('invocation_id'), sqlc.arg('action'),
    COALESCE(sqlc.narg('payload')::jsonb, '{}'::jsonb),
    COALESCE(sqlc.narg('created_assignment_ids')::uuid[], '{}'::uuid[]),
    sqlc.arg('created_by_type'), sqlc.narg('created_by_id')
)
RETURNING *;

-- name: ListRoomManagerDecisionsByRoom :many
SELECT * FROM room_manager_decision
WHERE room_id = $1
ORDER BY id ASC;

-- name: UpdateRoomManagerDecisionCreatedAssignments :one
UPDATE room_manager_decision
SET created_assignment_ids = $2
WHERE id = $1
RETURNING *;

-- name: AppendRoomInvocationEvent :one
INSERT INTO room_invocation_event (
    id, room_id, assignment_id, invocation_id, type, actor_type, actor_id, payload
)
VALUES (
    sqlc.arg('id'), sqlc.arg('room_id'), sqlc.arg('assignment_id'),
    sqlc.narg('invocation_id'), sqlc.arg('type'), sqlc.arg('actor_type'),
    sqlc.narg('actor_id'), COALESCE(sqlc.narg('payload')::jsonb, '{}'::jsonb)
)
RETURNING *;

-- name: ListRoomInvocationEventsByRoom :many
SELECT * FROM room_invocation_event
WHERE room_id = $1
  AND (sqlc.narg('before_id')::uuid IS NULL OR id < sqlc.narg('before_id')::uuid)
ORDER BY id DESC
LIMIT sqlc.arg('limit');

-- name: ListRoomInvocationEventsByAssignment :many
SELECT * FROM room_invocation_event
WHERE assignment_id = $1
ORDER BY created_at ASC;

-- name: CreateRoomTaskForInvocation :one
INSERT INTO agent_task_queue (
    agent_id, runtime_id, issue_id, status, priority,
    room_id, room_message_id, invocation_id, context, trigger_summary
)
VALUES ($1, $2, NULL, 'queued', $3, $4, $5, $6,
    COALESCE(sqlc.narg('context')::jsonb, '{}'::jsonb), sqlc.narg('trigger_summary'))
RETURNING *;

-- name: CountRunningRoomInvocationsForAgent :one
SELECT COUNT(*)::bigint AS count
FROM agent_task_queue
WHERE agent_id = $1
  AND status IN ('queued', 'dispatched', 'running', 'waiting_local_directory');

-- name: GetRoomInvocationByTask :one
SELECT ri.*
FROM room_invocation ri
JOIN agent_task_queue t ON t.invocation_id = ri.id
WHERE t.id = $1
LIMIT 1;
