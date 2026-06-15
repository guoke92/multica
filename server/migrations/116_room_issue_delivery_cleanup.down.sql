ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_origin_type_check;
ALTER TABLE issue ADD CONSTRAINT issue_origin_type_check
    CHECK (origin_type IS NULL OR origin_type IN ('autopilot', 'quick_create', 'room_message'));

ALTER TABLE issue ADD COLUMN IF NOT EXISTS source_room_id UUID;
ALTER TABLE issue ADD COLUMN IF NOT EXISTS source_message_id UUID;
CREATE INDEX IF NOT EXISTS idx_issue_source_room ON issue (source_room_id) WHERE source_room_id IS NOT NULL;

ALTER TABLE room_delivery
    ADD COLUMN IF NOT EXISTS linked_issue_id UUID REFERENCES issue(id) ON DELETE SET NULL;

ALTER TABLE room_message
    ADD COLUMN IF NOT EXISTS linked_issue_id UUID REFERENCES issue(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_room_message_linked_issue ON room_message (linked_issue_id) WHERE linked_issue_id IS NOT NULL;
