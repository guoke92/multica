-- Room v2.3 Phase 6: topic-first convergence — delivery_id becomes optional.

ALTER TABLE room_topic
    ALTER COLUMN delivery_id DROP NOT NULL;

-- Backfill topic_id on messages from delivery when missing.
UPDATE room_message m
SET topic_id = t.id
FROM room_topic t
WHERE m.delivery_id = t.delivery_id
  AND m.topic_id IS NULL
  AND m.room_id = t.room_id;
