ALTER TABLE room_topic DROP CONSTRAINT IF EXISTS room_topic_status_check;
ALTER TABLE room_topic ADD CONSTRAINT room_topic_status_check
    CHECK (status IN ('pending', 'in_progress', 'done', 'failed', 'skipped'));

ALTER TABLE room_topic
    DROP COLUMN IF EXISTS root_message_id,
    DROP COLUMN IF EXISTS last_message_id,
    DROP COLUMN IF EXISTS closed_by,
    DROP COLUMN IF EXISTS closed_at,
    DROP COLUMN IF EXISTS event_count;

DROP TABLE IF EXISTS room_human_actions;
DROP TABLE IF EXISTS room_flow_events;
