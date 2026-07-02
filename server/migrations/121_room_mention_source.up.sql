ALTER TABLE room_message_mention
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN source_message_id UUID REFERENCES room_message(id) ON DELETE SET NULL,
  ADD COLUMN assignment_id UUID REFERENCES room_assignment(id) ON DELETE SET NULL;

CREATE INDEX idx_room_message_mention_source_message ON room_message_mention(source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX idx_room_message_mention_assignment ON room_message_mention(assignment_id) WHERE assignment_id IS NOT NULL;
