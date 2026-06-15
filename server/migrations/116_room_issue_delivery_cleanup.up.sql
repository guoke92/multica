-- Room v2.3 Phase 6 final cleanup: drop Issue bridge columns.

DROP INDEX IF EXISTS idx_room_message_linked_issue;
ALTER TABLE room_message DROP COLUMN IF EXISTS linked_issue_id;

ALTER TABLE room_delivery DROP COLUMN IF EXISTS linked_issue_id;

UPDATE issue SET origin_type = NULL, origin_id = NULL WHERE origin_type = 'room_message';

DROP INDEX IF EXISTS idx_issue_source_room;
ALTER TABLE issue DROP COLUMN IF EXISTS source_room_id;
ALTER TABLE issue DROP COLUMN IF EXISTS source_message_id;

ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_origin_type_check;
ALTER TABLE issue ADD CONSTRAINT issue_origin_type_check
    CHECK (origin_type IS NULL OR origin_type IN ('autopilot', 'quick_create'));
