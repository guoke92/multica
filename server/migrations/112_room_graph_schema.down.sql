-- Rollback room graph schema (destructive; data loss).

ALTER TABLE approval_request DROP CONSTRAINT IF EXISTS approval_request_room_invocation_id_fkey;
ALTER TABLE agent_task_queue DROP CONSTRAINT IF EXISTS agent_task_queue_invocation_id_fkey;

DROP TABLE IF EXISTS room_invocation_event CASCADE;
DROP TABLE IF EXISTS room_manager_decision CASCADE;
DROP TABLE IF EXISTS room_invocation CASCADE;
DROP TABLE IF EXISTS room_assignment_dependency CASCADE;
DROP INDEX IF EXISTS idx_room_assignment_attention_failed;
ALTER TABLE room_assignment DROP COLUMN IF EXISTS failure_acknowledged_at;
ALTER TABLE room_assignment DROP COLUMN IF EXISTS failure_acknowledged_by;
ALTER TABLE room_assignment DROP COLUMN IF EXISTS superseded_by_assignment_id;

DROP TABLE IF EXISTS room_assignment CASCADE;
DROP TABLE IF EXISTS room_message_mention CASCADE;

ALTER TABLE approval_request RENAME COLUMN room_invocation_id TO invocation_id;

-- Legacy tables are not recreated; run earlier migrations to restore schema.
