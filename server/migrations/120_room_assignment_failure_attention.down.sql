DROP INDEX IF EXISTS idx_room_assignment_attention_failed;

ALTER TABLE room_assignment
    DROP COLUMN IF EXISTS superseded_by_assignment_id,
    DROP COLUMN IF EXISTS failure_acknowledged_by,
    DROP COLUMN IF EXISTS failure_acknowledged_at;
