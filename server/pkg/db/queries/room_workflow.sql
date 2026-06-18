-- name: CreateRoomDelivery :one
INSERT INTO room_delivery (
    room_id, title, status, workflow_template, current_phase,
    card_message_id, anchor_message_id, created_by
)
VALUES ($1, $2, $3, $4, $5, sqlc.narg('card_message_id'), sqlc.narg('anchor_message_id'), $6)
RETURNING *;

-- name: GetRoomDelivery :one
SELECT * FROM room_delivery WHERE id = $1;

-- name: GetRoomDeliveryInRoom :one
SELECT * FROM room_delivery WHERE id = $1 AND room_id = $2;

-- name: UpdateRoomDelivery :one
UPDATE room_delivery
SET title = COALESCE(sqlc.narg('title'), title),
    status = COALESCE(sqlc.narg('status'), status),
    current_phase = COALESCE(sqlc.narg('current_phase'), current_phase),
    card_message_id = COALESCE(sqlc.narg('card_message_id'), card_message_id),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListRoomDeliveries :many
SELECT * FROM room_delivery
WHERE room_id = $1
ORDER BY updated_at DESC
LIMIT sqlc.arg('limit');

-- name: GetActiveRoomDelivery :one
SELECT * FROM room_delivery
WHERE room_id = $1 AND status NOT IN ('done', 'cancelled')
ORDER BY updated_at DESC
LIMIT 1;

-- name: CreateRoomTopic :one
INSERT INTO room_topic (
    room_id, delivery_id, parent_topic_id, title, status, phase_key, assignee_agent_id
)
VALUES ($1, $2, sqlc.narg('parent_topic_id'), $3, $4, $5, sqlc.narg('assignee_agent_id'))
RETURNING *;

-- name: GetRoomTopic :one
SELECT * FROM room_topic WHERE id = $1;

-- name: ListRoomTopicsByDelivery :many
SELECT * FROM room_topic
WHERE delivery_id = $1
ORDER BY created_at ASC;

-- name: UpdateRoomTopic :one
UPDATE room_topic
SET title = COALESCE(sqlc.narg('title'), title),
    status = COALESCE(sqlc.narg('status'), status),
    assignee_agent_id = COALESCE(sqlc.narg('assignee_agent_id'), assignee_agent_id),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CreateRoomMessageExtended :one
INSERT INTO room_message (
    id, room_id, sender_type, sender_id, content, quote_message_id,
    delivery_id, topic_id, message_kind, metadata, relay_metadata
)
VALUES (
    sqlc.arg('id'), sqlc.arg('room_id'), sqlc.arg('sender_type'),
    sqlc.narg('sender_id'), sqlc.arg('content'),
    sqlc.narg('quote_message_id'),
    sqlc.narg('delivery_id'), sqlc.narg('topic_id'),
    COALESCE(sqlc.narg('message_kind'), 'chat'),
    COALESCE(sqlc.narg('metadata')::jsonb, '{}'::jsonb),
    sqlc.narg('relay_metadata')::jsonb
)
RETURNING *;

-- name: GetMentionInvocationExtended :one
SELECT id, room_id, message_id, target_type, target_id, intent, status, priority,
       retry_count, max_retries, task_id, response_message_id, failure_reason,
       parent_invocation_id, chain_depth, timeout_at, delivered_at, started_at,
       completed_at, cancelled_by, cancelled_at, created_at, updated_at,
       delivery_id, topic_id
FROM mention_invocation
WHERE id = $1;

-- name: CreateMentionInvocationExtended :one
INSERT INTO mention_invocation (
    id, room_id, message_id, target_type, target_id, intent, status, priority,
    max_retries, parent_invocation_id, chain_depth, timeout_at,
    delivery_id, topic_id
)
VALUES (
    sqlc.arg('id'), sqlc.arg('room_id'), sqlc.arg('message_id'),
    sqlc.arg('target_type'), sqlc.arg('target_id'), sqlc.arg('intent'),
    sqlc.arg('status'), sqlc.arg('priority'), sqlc.arg('max_retries'),
    sqlc.narg('parent_invocation_id'), sqlc.arg('chain_depth'), sqlc.arg('timeout_at'),
    sqlc.narg('delivery_id'), sqlc.narg('topic_id')
)
RETURNING *;

-- name: CreateRoomTaskWithContext :one
INSERT INTO agent_task_queue (
    agent_id, runtime_id, issue_id, status, priority,
    room_id, room_message_id, invocation_id, context, trigger_summary
)
VALUES ($1, $2, NULL, 'queued', $3, $4, $5, $6, COALESCE(sqlc.narg('context')::jsonb, '{}'::jsonb), sqlc.narg('trigger_summary'))
RETURNING *;

-- name: ListRoomMessagesExtended :many
SELECT id, room_id, sender_type, sender_id, content, quote_message_id,
       metadata, created_at, edited_at, deleted_at, delivery_id, topic_id, message_kind,
       relay_metadata
FROM room_message
WHERE room_id = $1
  AND deleted_at IS NULL
  AND ($2::uuid IS NULL OR id < $2::uuid)
ORDER BY id DESC
LIMIT $3;

-- name: UpdateRoomMessageRelayMetadata :exec
UPDATE room_message SET relay_metadata = $2 WHERE id = $1;

