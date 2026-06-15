-- Revert topic convergence (delivery_id required again; only safe on empty DBs).

UPDATE room_topic SET delivery_id = (
    SELECT id FROM room_delivery d WHERE d.room_id = room_topic.room_id ORDER BY created_at ASC LIMIT 1
) WHERE delivery_id IS NULL;

ALTER TABLE room_topic
    ALTER COLUMN delivery_id SET NOT NULL;
