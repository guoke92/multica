-- name: CreateRoomHumanInteraction :one
INSERT INTO room_human_interaction (
    id, room_id, kind, status, title, body, options, allow_custom_response,
    invocation_id, assignment_id, decision_id, approval_request_id,
    created_by_type, created_by_id
)
VALUES (
    sqlc.arg('id'), sqlc.arg('room_id'), sqlc.arg('kind'), sqlc.arg('status'),
    sqlc.narg('title'), sqlc.arg('body'), sqlc.arg('options'), sqlc.arg('allow_custom_response'),
    sqlc.narg('invocation_id'), sqlc.narg('assignment_id'), sqlc.narg('decision_id'),
    sqlc.narg('approval_request_id'), sqlc.arg('created_by_type'), sqlc.narg('created_by_id')
)
RETURNING *;

-- name: GetRoomHumanInteraction :one
SELECT * FROM room_human_interaction WHERE id = $1;

-- name: GetRoomHumanInteractionInRoom :one
SELECT * FROM room_human_interaction WHERE id = $1 AND room_id = $2;

-- name: ListPendingRoomHumanInteractionsByRoom :many
SELECT * FROM room_human_interaction
WHERE room_id = $1 AND status = 'pending'
ORDER BY created_at ASC;

-- name: ListRoomHumanInteractionsByRoom :many
SELECT * FROM room_human_interaction
WHERE room_id = $1
ORDER BY created_at ASC;

-- name: RespondRoomHumanInteraction :one
UPDATE room_human_interaction
SET status = 'responded',
    response_text = sqlc.narg('response_text'),
    response_option_id = sqlc.narg('response_option_id'),
    responded_by = sqlc.arg('responded_by'),
    responded_at = now(),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND room_id = sqlc.arg('room_id')
  AND status = 'pending'
RETURNING *;

-- name: DismissRoomHumanInteraction :one
UPDATE room_human_interaction
SET status = 'dismissed',
    dismissed_at = now(),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND room_id = sqlc.arg('room_id')
  AND status = 'pending'
RETURNING *;

-- name: ExpirePendingRoomHumanInteractionsForInvocation :exec
UPDATE room_human_interaction
SET status = 'expired',
    updated_at = now()
WHERE invocation_id = $1
  AND status = 'pending';
