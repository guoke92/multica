-- name: InsertRoomFlowEvent :one
INSERT INTO room_flow_events (
    id, room_id, topic_id, category, step_id, from_message_id, to_message_id,
    type, message_id, invocation_id, actor_type, actor_id, payload
)
VALUES (
    sqlc.arg('id'),
    sqlc.arg('room_id'),
    sqlc.narg('topic_id'),
    COALESCE(sqlc.narg('category'), 'control'),
    sqlc.narg('step_id'),
    sqlc.narg('from_message_id'),
    sqlc.narg('to_message_id'),
    sqlc.arg('type'),
    sqlc.narg('message_id'),
    sqlc.narg('invocation_id'),
    sqlc.arg('actor_type'),
    sqlc.narg('actor_id'),
    COALESCE(sqlc.narg('payload')::jsonb, '{}'::jsonb)
)
RETURNING *;

-- name: ListRoomFlowEventsByRoom :many
SELECT * FROM room_flow_events
WHERE room_id = $1
  AND (sqlc.narg('before_id')::uuid IS NULL OR id < sqlc.narg('before_id')::uuid)
ORDER BY id DESC
LIMIT sqlc.arg('limit');

-- name: ListRoomFlowEventsByTopic :many
SELECT * FROM room_flow_events
WHERE room_id = $1 AND topic_id = $2
  AND (sqlc.narg('before_id')::uuid IS NULL OR id < sqlc.narg('before_id')::uuid)
ORDER BY id DESC
LIMIT sqlc.arg('limit');

-- name: CreateRoomHumanAction :one
INSERT INTO room_human_actions (
    room_id, topic_id, message_id, invocation_id, type, status, assignee_id, title, reason, expires_at
)
VALUES (
    $1, $2, $3, sqlc.narg('invocation_id'), $4, $5,
    sqlc.narg('assignee_id'), $6, sqlc.narg('reason'), sqlc.narg('expires_at')
)
RETURNING *;

-- name: CountPendingRoomHumanActions :one
SELECT COUNT(*)::int AS count
FROM room_human_actions
WHERE room_id = $1 AND status = 'pending';

-- name: GetRoomHumanActionInRoom :one
SELECT * FROM room_human_actions WHERE id = $1 AND room_id = $2;

-- name: DecideRoomHumanAction :one
UPDATE room_human_actions
SET status = $3,
    reason = COALESCE(sqlc.narg('reason'), reason),
    decided_by = $4,
    decided_at = now(),
    updated_at = now()
WHERE id = $1 AND room_id = $2 AND status = 'pending'
RETURNING *;

-- name: IncrementRoomTopicEventCount :one
UPDATE room_topic
SET event_count = event_count + 1,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListRoomTopicSummaries :many
SELECT
    t.id,
    t.room_id,
    t.title,
    t.status,
    t.root_message_id,
    t.last_message_id,
    t.event_count,
    t.updated_at
FROM room_topic t
WHERE t.room_id = $1
ORDER BY t.updated_at DESC
LIMIT sqlc.arg('limit');

-- name: ListRoomTopicsByRoom :many
SELECT * FROM room_topic
WHERE room_id = $1
ORDER BY updated_at DESC
LIMIT sqlc.arg('limit');

-- name: UpdateRoomTopicLastMessage :one
UPDATE room_topic
SET last_message_id = $2,
    root_message_id = COALESCE(root_message_id, $2),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: GetLatestRoomFlowEventID :one
SELECT id FROM room_flow_events
WHERE room_id = $1
ORDER BY id DESC
LIMIT 1;

-- name: GetRoomTopicCardMessageID :one
SELECT id FROM room_message
WHERE room_id = $1
  AND topic_id = $2
  AND message_kind = 'card'
  AND deleted_at IS NULL
ORDER BY id ASC
LIMIT 1;

-- name: ListExpiredPendingRoomHumanActions :many
SELECT * FROM room_human_actions
WHERE status = 'pending'
  AND (
    (expires_at IS NOT NULL AND expires_at <= now())
    OR (expires_at IS NULL AND created_at <= now() - interval '4 hours')
  )
ORDER BY created_at ASC
LIMIT $1;

-- name: ExpireRoomHumanAction :one
UPDATE room_human_actions
SET status = 'expired',
    reason = COALESCE(sqlc.narg('reason'), reason),
    decided_at = now(),
    updated_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING *;
