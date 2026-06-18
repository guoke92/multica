-- Track human acknowledgment and recovery supersession for failed assignments.

ALTER TABLE room_assignment
    ADD COLUMN failure_acknowledged_at TIMESTAMPTZ,
    ADD COLUMN failure_acknowledged_by UUID,
    ADD COLUMN superseded_by_assignment_id UUID REFERENCES room_assignment(id) ON DELETE SET NULL;

CREATE INDEX idx_room_assignment_attention_failed ON room_assignment(room_id)
    WHERE status = 'failed'
      AND failure_acknowledged_at IS NULL
      AND superseded_by_assignment_id IS NULL;
