ALTER TABLE mention_invocation DROP CONSTRAINT IF EXISTS mention_invocation_intent_check;
ALTER TABLE mention_invocation ADD CONSTRAINT mention_invocation_intent_check
    CHECK (intent IN ('ask', 'execute', 'review', 'confirm', 'arbitrate'));

ALTER TABLE mention_invocation DROP COLUMN IF EXISTS topic_id;
ALTER TABLE mention_invocation DROP COLUMN IF EXISTS delivery_id;

ALTER TABLE room_message DROP COLUMN IF EXISTS message_kind;
ALTER TABLE room_message DROP COLUMN IF EXISTS topic_id;
ALTER TABLE room_message DROP COLUMN IF EXISTS delivery_id;

DROP TABLE IF EXISTS room_topic;
DROP TABLE IF EXISTS room_delivery;
