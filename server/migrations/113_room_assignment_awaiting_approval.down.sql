-- Revert 'awaiting_approval'. Any parked assignments are coerced to 'failed'
-- so the restored CHECK constraint holds.
UPDATE room_assignment SET status = 'failed' WHERE status = 'awaiting_approval';
ALTER TABLE room_assignment DROP CONSTRAINT IF EXISTS room_assignment_status_check;
ALTER TABLE room_assignment ADD CONSTRAINT room_assignment_status_check CHECK (status IN (
    'pending', 'blocked', 'running', 'completed', 'failed', 'cancelled', 'skipped'
));
