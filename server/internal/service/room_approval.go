package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// RequestRoomApprovalParams creates a pending approval_request surfaced in the interaction dock.
type RequestRoomApprovalParams struct {
	Room             db.Room
	RoomInvocationID pgtype.UUID
	RequesterID      pgtype.UUID
	ActionType       string
	Payload          map[string]any
}

// RequestRoomApproval inserts an approval_request and a dock interaction (no chat row).
func (s *TaskService) RequestRoomApproval(ctx context.Context, p RequestRoomApprovalParams) (db.ApprovalRequest, error) {
	payload, _ := json.Marshal(p.Payload)
	if payload == nil {
		payload = []byte("{}")
	}
	inv, err := s.Queries.GetRoomInvocation(ctx, p.RoomInvocationID)
	if err != nil {
		return db.ApprovalRequest{}, fmt.Errorf("load invocation: %w", err)
	}
	assignment, err := s.Queries.GetRoomAssignment(ctx, inv.AssignmentID)
	if err != nil {
		return db.ApprovalRequest{}, fmt.Errorf("load assignment: %w", err)
	}

	req, err := s.Queries.CreateApprovalRequest(ctx, db.CreateApprovalRequestParams{
		RoomID: p.Room.ID, MessageID: inv.SourceMessageID,
		RoomInvocationID: p.RoomInvocationID,
		RequesterType:    "agent", RequesterID: p.RequesterID,
		ActionType:       p.ActionType, Payload: payload,
	})
	if err != nil {
		return db.ApprovalRequest{}, fmt.Errorf("create approval request: %w", err)
	}

	if err := s.createApprovalHumanInteraction(ctx, p.Room, inv, assignment, req, p.ActionType); err != nil {
		return db.ApprovalRequest{}, fmt.Errorf("create approval interaction: %w", err)
	}

	if s.Bus != nil {
		s.Bus.Publish(events.Event{
			Type:        protocol.EventRoomApprovalRequested,
			WorkspaceID: util.UUIDToString(p.Room.WorkspaceID),
			Payload: map[string]string{
				"room_id":     util.UUIDToString(p.Room.ID),
				"request_id":  util.UUIDToString(req.ID),
				"action_type": p.ActionType,
			},
		})
	}
	s.RefreshRoomSnapshot(ctx, p.Room.ID)
	return req, nil
}
