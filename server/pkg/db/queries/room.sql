-- name: CreateRoom :one
INSERT INTO room (workspace_id, name, description, type, created_by, manager_agent_id, policy)
VALUES ($1, $2, $3, $4, $5, sqlc.narg('manager_agent_id'), COALESCE(sqlc.narg('policy')::jsonb, '{}'::jsonb))
RETURNING *;

-- name: IsRoomManagerAgent :one
SELECT EXISTS(
    SELECT 1 FROM room
    WHERE manager_agent_id = $1 AND archived_at IS NULL
) AS is_manager;

-- name: GetRoom :one
SELECT * FROM room WHERE id = $1;

-- name: GetRoomInWorkspace :one
SELECT * FROM room WHERE id = $1 AND workspace_id = $2;

-- name: UpdateRoom :one
UPDATE room
SET name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    manager_agent_id = COALESCE(sqlc.narg('manager_agent_id'), manager_agent_id),
    policy = COALESCE(sqlc.narg('policy')::jsonb, policy),
    updated_at = now()
WHERE id = sqlc.arg('id') AND workspace_id = sqlc.arg('workspace_id')
RETURNING *;

-- name: UpdateRoomSnapshot :exec
UPDATE room SET snapshot = $2, updated_at = now() WHERE id = $1;

-- name: ArchiveRoom :one
UPDATE room
SET archived_at = now(), updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
RETURNING *;

-- name: ListRoomsForMember :many
SELECT r.*
FROM room r
JOIN room_member rm ON rm.room_id = r.id
WHERE r.workspace_id = $1
  AND rm.principal_type = 'user'
  AND rm.principal_id = $2
  AND rm.removed_at IS NULL
  AND r.archived_at IS NULL
ORDER BY r.updated_at DESC;

-- name: AddRoomMember :one
INSERT INTO room_member (room_id, principal_type, principal_id, role, permissions)
VALUES ($1, $2, $3, $4, COALESCE(sqlc.narg('permissions')::jsonb, '{}'::jsonb))
ON CONFLICT (room_id, principal_type, principal_id) DO UPDATE
SET role = EXCLUDED.role,
    permissions = EXCLUDED.permissions,
    removed_at = NULL,
    joined_at = now()
RETURNING *;

-- name: RemoveRoomMember :exec
UPDATE room_member SET removed_at = now()
WHERE room_id = $1 AND principal_type = $2 AND principal_id = $3;

-- name: GetRoomMember :one
SELECT * FROM room_member
WHERE room_id = $1 AND principal_type = $2 AND principal_id = $3 AND removed_at IS NULL;

-- name: ListRoomMembers :many
SELECT * FROM room_member
WHERE room_id = $1 AND removed_at IS NULL
ORDER BY joined_at ASC;

-- name: UpdateRoomMemberRole :one
UPDATE room_member SET role = $4
WHERE room_id = $1 AND principal_type = $2 AND principal_id = $3 AND removed_at IS NULL
RETURNING *;

-- name: CountRoomOwners :one
SELECT COUNT(*)::bigint AS count
FROM room_member
WHERE room_id = $1 AND role = 'owner' AND removed_at IS NULL;

-- name: TouchRoom :exec
UPDATE room SET updated_at = now() WHERE id = $1;

-- name: CreateRoomMessage :one
INSERT INTO room_message (id, room_id, sender_type, sender_id, content, quote_message_id, metadata)
VALUES (
    sqlc.arg('id'), sqlc.arg('room_id'), sqlc.arg('sender_type'),
    sqlc.narg('sender_id'), sqlc.arg('content'), sqlc.narg('quote_message_id'),
    COALESCE(sqlc.narg('metadata')::jsonb, '{}'::jsonb)
)
RETURNING *;

-- name: GetRoomMessage :one
SELECT * FROM room_message WHERE id = $1;

-- name: GetRoomMessageInRoom :one
SELECT * FROM room_message WHERE id = $1 AND room_id = $2;

-- name: UpdateRoomMessageMetadata :exec
UPDATE room_message SET metadata = $2 WHERE id = $1;

-- name: UpdateRoomMessageTopicID :exec
UPDATE room_message SET topic_id = $2 WHERE id = $1 AND room_id = $3;

-- name: UpdateRoomMessageContent :one
UPDATE room_message
SET content = $2, edited_at = now()
WHERE id = $1
  AND room_id = $3
  AND sender_type = 'user'
  AND sender_id = $4
  AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteRoomMessage :exec
UPDATE room_message SET deleted_at = now()
WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL;

-- name: GetMentionInvocationByResponseMessage :one
SELECT * FROM mention_invocation
WHERE response_message_id = $1 AND room_id = $2
LIMIT 1;

-- name: ResetMentionInvocationForRegenerate :one
UPDATE mention_invocation
SET status = 'pending',
    task_id = NULL,
    response_message_id = NULL,
    failure_reason = NULL,
    delivered_at = NULL,
    started_at = NULL,
    completed_at = NULL,
    cancelled_by = NULL,
    cancelled_at = NULL,
    retry_count = retry_count + 1,
    updated_at = now()
WHERE id = $1 AND status = 'succeeded'
RETURNING *;

-- name: ListRoomMessages :many
SELECT * FROM room_message
WHERE room_id = $1
  AND deleted_at IS NULL
  AND (sqlc.narg('before_id')::uuid IS NULL OR id < sqlc.narg('before_id')::uuid)
ORDER BY id DESC
LIMIT sqlc.arg('limit');

-- name: CreateMentionInvocation :one
INSERT INTO mention_invocation (
    id, room_id, message_id, target_type, target_id, intent, status, priority,
    max_retries, parent_invocation_id, chain_depth, timeout_at
)
VALUES (
    sqlc.arg('id'), sqlc.arg('room_id'), sqlc.arg('message_id'),
    sqlc.arg('target_type'), sqlc.arg('target_id'), sqlc.arg('intent'),
    sqlc.arg('status'), sqlc.arg('priority'), sqlc.arg('max_retries'),
    sqlc.narg('parent_invocation_id'), sqlc.arg('chain_depth'), sqlc.arg('timeout_at')
)
RETURNING *;

-- name: GetMentionInvocation :one
SELECT * FROM mention_invocation WHERE id = $1;

-- name: GetMentionInvocationInRoom :one
SELECT * FROM mention_invocation WHERE id = $1 AND room_id = $2;

-- name: UpdateMentionInvocationStatus :one
UPDATE mention_invocation
SET status = $2,
    task_id = COALESCE(sqlc.narg('task_id'), task_id),
    response_message_id = COALESCE(sqlc.narg('response_message_id'), response_message_id),
    failure_reason = COALESCE(sqlc.narg('failure_reason'), failure_reason),
    delivered_at = COALESCE(sqlc.narg('delivered_at'), delivered_at),
    started_at = COALESCE(sqlc.narg('started_at'), started_at),
    completed_at = COALESCE(sqlc.narg('completed_at'), completed_at),
    retry_count = COALESCE(sqlc.narg('retry_count'), retry_count),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CancelMentionInvocation :one
UPDATE mention_invocation
SET status = 'cancelled',
    cancelled_by = $2,
    cancelled_at = now(),
    updated_at = now()
WHERE id = $1 AND status NOT IN ('succeeded', 'cancelled')
RETURNING *;

-- name: ListMentionInvocationsByMessage :many
SELECT * FROM mention_invocation WHERE message_id = $1 ORDER BY id ASC;

-- name: ListActiveMentionInvocationsByRoom :many
SELECT * FROM mention_invocation
WHERE room_id = $1
  AND status NOT IN ('succeeded', 'cancelled')
ORDER BY id DESC;

-- name: ListRoomMentionInvocations :many
-- UI thread: include succeeded so replies stay anchored under the triggering user message.
SELECT * FROM mention_invocation
WHERE room_id = $1
ORDER BY id ASC;

-- name: CountRunningInvocationsForAgent :one
-- Active agent_task_queue rows for this executor (not invocation.status=queued — that blocked follow-up tasks).
SELECT COUNT(*)::bigint AS count
FROM agent_task_queue
WHERE agent_id = $1
  AND status IN ('queued', 'dispatched', 'running', 'waiting_local_directory');

-- name: ListQueuedInvocationsForExecutor :many
-- Queued invocations awaiting a task for this executor (agent target or squad leader).
SELECT mi.*
FROM mention_invocation mi
LEFT JOIN squad s ON mi.target_type = 'squad' AND s.id = mi.target_id
WHERE mi.status = 'queued'
  AND mi.task_id IS NULL
  AND (
    (mi.target_type = 'agent' AND mi.target_id = $1)
    OR (mi.target_type = 'squad' AND s.leader_id = $1)
  )
ORDER BY mi.id ASC
LIMIT $2;

-- name: CreateRoomTask :one
INSERT INTO agent_task_queue (
    agent_id, runtime_id, issue_id, status, priority,
    room_id, room_message_id, invocation_id
)
VALUES ($1, $2, NULL, 'queued', $3, $4, $5, $6)
RETURNING *;

-- name: GetPendingRoomInvocationTasks :many
SELECT mi.*
FROM mention_invocation mi
WHERE mi.room_id = $1
  AND mi.status = 'queued'
ORDER BY mi.id ASC
LIMIT $2;

-- name: CreateApprovalRequest :one
INSERT INTO approval_request (
    room_id, message_id, invocation_id, requester_type, requester_id, action_type, payload
)
VALUES ($1, $2, sqlc.narg('invocation_id'), $3, $4, $5, COALESCE(sqlc.narg('payload')::jsonb, '{}'::jsonb))
RETURNING *;

-- name: GetApprovalRequest :one
SELECT * FROM approval_request WHERE id = $1;

-- name: DecideApprovalRequest :one
UPDATE approval_request
SET status = $2,
    decided_by = $3,
    decided_at = now(),
    reject_reason = sqlc.narg('reject_reason')
WHERE id = $1 AND status = 'pending'
RETURNING *;

-- name: CountInvocationStatusByRoom :one
SELECT
    COUNT(*) FILTER (WHERE status IN ('pending', 'delivered'))::int AS pending_count,
    COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
    COUNT(*) FILTER (WHERE status = 'running')::int AS running_count,
    COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
    COUNT(*) FILTER (WHERE status = 'timed_out')::int AS timed_out_count
FROM mention_invocation
WHERE room_id = $1
  AND status NOT IN ('succeeded', 'cancelled');

-- name: GetLatestInvocationForMessage :one
SELECT * FROM mention_invocation
WHERE message_id = $1
ORDER BY chain_depth DESC, id DESC
LIMIT 1;

-- name: ListTimedOutRunningInvocations :many
SELECT * FROM mention_invocation
WHERE status = 'running'
  AND started_at IS NOT NULL
  AND timeout_at IS NOT NULL
  AND timeout_at < now()
ORDER BY timeout_at ASC
LIMIT $1;

-- name: UpdateMentionInvocationTimeout :exec
UPDATE mention_invocation
SET timeout_at = $2, updated_at = now()
WHERE id = $1;

-- name: ListQueuedInvocationsForAgent :many
SELECT * FROM mention_invocation
WHERE target_type = 'agent'
  AND target_id = $1
  AND status = 'queued'
ORDER BY id ASC
LIMIT $2;

-- name: ListQueuedRoomInvocations :many
SELECT * FROM mention_invocation
WHERE status = 'queued'
ORDER BY id ASC
LIMIT $1;
