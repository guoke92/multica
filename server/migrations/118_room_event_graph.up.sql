-- Room event graph: flow events are the fact source; topics are optional
-- compressed phase views.

ALTER TABLE room_flow_events
    ALTER COLUMN topic_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'control',
    ADD COLUMN IF NOT EXISTS step_id TEXT,
    ADD COLUMN IF NOT EXISTS from_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS to_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL;

ALTER TABLE room_human_actions
    ALTER COLUMN topic_id DROP NOT NULL;

ALTER TABLE room_topic DROP CONSTRAINT IF EXISTS room_topic_status_check;
ALTER TABLE room_topic ADD CONSTRAINT room_topic_status_check
    CHECK (status IN (
        'pending', 'in_progress', 'done', 'failed', 'skipped',
        'open', 'closing', 'closed', 'compressed', 'expanded', 'archived'
    ));

ALTER TABLE room_flow_events DROP CONSTRAINT IF EXISTS room_flow_events_category_check;
ALTER TABLE room_flow_events ADD CONSTRAINT room_flow_events_category_check
    CHECK (category IN ('message', 'control', 'confirm', 'phase', 'meta'));

CREATE INDEX IF NOT EXISTS idx_room_flow_events_room_category_created
    ON room_flow_events(room_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_flow_events_room_step
    ON room_flow_events(room_id, step_id)
    WHERE step_id IS NOT NULL;
