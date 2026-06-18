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

-- name: ListRoomMessages :many
SELECT * FROM room_message
WHERE room_id = $1
  AND deleted_at IS NULL
  AND (sqlc.narg('before_id')::uuid IS NULL OR id < sqlc.narg('before_id')::uuid)
ORDER BY id DESC
LIMIT sqlc.arg('limit');

-- name: CreateApprovalRequest :one
INSERT INTO approval_request (
    room_id, message_id, room_invocation_id, requester_type, requester_id, action_type, payload
)
VALUES ($1, $2, sqlc.narg('room_invocation_id'), $3, $4, $5, COALESCE(sqlc.narg('payload')::jsonb, '{}'::jsonb))
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
