DROP INDEX IF EXISTS idx_room_flow_events_room_step;
DROP INDEX IF EXISTS idx_room_flow_events_room_category_created;

ALTER TABLE room_flow_events DROP CONSTRAINT IF EXISTS room_flow_events_category_check;

ALTER TABLE room_flow_events
    DROP COLUMN IF EXISTS to_message_id,
    DROP COLUMN IF EXISTS from_message_id,
    DROP COLUMN IF EXISTS step_id,
    DROP COLUMN IF EXISTS category;

-- Restore the old topic-first constraint for rollbacks. This assumes all rows
-- created while the migration was applied have been backfilled with topic_id.
ALTER TABLE room_flow_events
    ALTER COLUMN topic_id SET NOT NULL;

ALTER TABLE room_human_actions
    ALTER COLUMN topic_id SET NOT NULL;

ALTER TABLE room_topic DROP CONSTRAINT IF EXISTS room_topic_status_check;
ALTER TABLE room_topic ADD CONSTRAINT room_topic_status_check
    CHECK (status IN (
        'pending', 'in_progress', 'done', 'failed', 'skipped',
        'open', 'closing', 'closed'
    ));
