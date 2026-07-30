-- Add 'awaiting_approval' to room_assignment.status.
-- An assignment parks here after an agent requests approval; the active
-- invocation is terminated (freeing the per-assignment active slot) and the
-- approval decision either resumes (approve) or cancels (reject) it.
ALTER TABLE room_assignment DROP CONSTRAINT IF EXISTS room_assignment_status_check;
ALTER TABLE room_assignment ADD CONSTRAINT room_assignment_status_check CHECK (status IN (
    'pending', 'blocked', 'awaiting_approval', 'running', 'completed', 'failed', 'cancelled', 'skipped'
));
