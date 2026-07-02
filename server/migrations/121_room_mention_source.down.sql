DROP INDEX IF EXISTS idx_room_message_mention_assignment;
DROP INDEX IF EXISTS idx_room_message_mention_source_message;
ALTER TABLE room_message_mention
  DROP COLUMN IF EXISTS assignment_id,
  DROP COLUMN IF EXISTS source_message_id,
  DROP COLUMN IF EXISTS source_type;
