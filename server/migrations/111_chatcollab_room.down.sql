ALTER TABLE agent_task_queue DROP COLUMN IF EXISTS invocation_id;
ALTER TABLE agent_task_queue DROP COLUMN IF EXISTS room_message_id;
ALTER TABLE agent_task_queue DROP COLUMN IF EXISTS room_id;

ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_origin_type_check;
ALTER TABLE issue ADD CONSTRAINT issue_origin_type_check
    CHECK (origin_type IS NULL OR origin_type IN ('autopilot', 'quick_create'));

ALTER TABLE issue DROP COLUMN IF EXISTS source_message_id;
ALTER TABLE issue DROP COLUMN IF EXISTS source_room_id;

DROP TABLE IF EXISTS approval_request;
DROP TABLE IF EXISTS mention_invocation;
DROP TABLE IF EXISTS room_message;
DROP TABLE IF EXISTS room_member;
DROP TABLE IF EXISTS room;
