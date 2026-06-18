package service

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// AcknowledgeRoomAssignmentFailure marks a failed assignment as reviewed by a user.
func (s *TaskService) AcknowledgeRoomAssignmentFailure(
	ctx context.Context,
	room db.Room,
	assignmentID pgtype.UUID,
	userID pgtype.UUID,
) (db.RoomAssignment, error) {
	updated, err := s.Queries.AcknowledgeRoomAssignmentFailure(ctx, db.AcknowledgeRoomAssignmentFailureParams{
		ID:                    assignmentID,
		RoomID:                room.ID,
		FailureAcknowledgedBy: userID,
	})
	if err != nil {
		return db.RoomAssignment{}, err
	}
	s.publishRoomAssignmentUpdated(ctx, room, updated)
	s.RefreshRoomSnapshot(ctx, room.ID)
	return updated, nil
}

func (s *TaskService) markAssignmentSuperseded(
	ctx context.Context,
	room db.Room,
	failedAssignmentID pgtype.UUID,
	newAssignmentID pgtype.UUID,
) {
	if !failedAssignmentID.Valid || !newAssignmentID.Valid {
		return
	}
	updated, err := s.Queries.MarkRoomAssignmentSuperseded(ctx, db.MarkRoomAssignmentSupersededParams{
		ID:                       failedAssignmentID,
		RoomID:                   room.ID,
		SupersededByAssignmentID: newAssignmentID,
	})
	if err == nil {
		s.publishRoomAssignmentUpdated(ctx, room, updated)
	}
}

func (s *TaskService) supersedeEarlierFailedOnTrack(
	ctx context.Context,
	room db.Room,
	newAssignment db.RoomAssignment,
) {
	if !newAssignment.ID.Valid {
		return
	}
	_, _ = s.Queries.SupersedeEarlierFailedAssignmentsOnTrack(ctx, db.SupersedeEarlierFailedAssignmentsOnTrackParams{
		NewAssignmentID: newAssignment.ID,
		RoomID:          room.ID,
		SourceMessageID: newAssignment.SourceMessageID,
		AssigneeID:      newAssignment.AssigneeID,
	})
}

func (s *TaskService) recoverySupersedeForNewAssignment(
	ctx context.Context,
	room db.Room,
	newAssignment db.RoomAssignment,
	explicitFailedID pgtype.UUID,
) {
	s.supersedeEarlierFailedOnTrack(ctx, room, newAssignment)
	if explicitFailedID.Valid {
		s.markAssignmentSuperseded(ctx, room, explicitFailedID, newAssignment.ID)
	}
}

func parseEscalationFailedAssignmentID(reason pgtype.Text) pgtype.UUID {
	esc, ok := parseAssignmentEscalationReason(reason)
	if !ok {
		return pgtype.UUID{}
	}
	return parseUUID(esc.FailedAssignmentID)
}
