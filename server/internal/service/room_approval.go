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

// RequestRoomApprovalParams creates a pending approval_request with a system room message.
type RequestRoomApprovalParams struct {
	Room             db.Room
	RoomInvocationID pgtype.UUID
	RequesterID      pgtype.UUID
	ActionType       string
	Payload          map[string]any
}

// RequestRoomApproval inserts a system message and approval_request for inline UI.
func (s *TaskService) RequestRoomApproval(ctx context.Context, p RequestRoomApprovalParams) (db.ApprovalRequest, db.RoomMessage, error) {
	payload, _ := json.Marshal(p.Payload)
	if payload == nil {
		payload = []byte("{}")
	}
	summary := fmt.Sprintf("Approval required: **%s**", p.ActionType)
	msg, err := s.Queries.CreateRoomMessage(ctx, db.CreateRoomMessageParams{
		ID: util.MustNewUUIDv7(), RoomID: p.Room.ID,
		SenderType: "system", Content: summary, Metadata: []byte("{}"),
	})
	if err != nil {
		return db.ApprovalRequest{}, db.RoomMessage{}, fmt.Errorf("create approval message: %w", err)
	}

	inv, invErr := s.Queries.GetRoomInvocation(ctx, p.RoomInvocationID)
	var messageID pgtype.UUID
	if invErr == nil {
		messageID = inv.SourceMessageID
	} else {
		messageID = msg.ID
	}

	req, err := s.Queries.CreateApprovalRequest(ctx, db.CreateApprovalRequestParams{
		RoomID: p.Room.ID, MessageID: messageID,
		RoomInvocationID: p.RoomInvocationID,
		RequesterType:    "agent", RequesterID: p.RequesterID,
		ActionType:       p.ActionType, Payload: payload,
	})
	if err != nil {
		return db.ApprovalRequest{}, db.RoomMessage{}, fmt.Errorf("create approval request: %w", err)
	}

	meta, _ := json.Marshal(map[string]string{
		"approval_request_id": util.UUIDToString(req.ID),
		"action_type":         p.ActionType,
	})
	_ = s.Queries.UpdateRoomMessageMetadata(ctx, db.UpdateRoomMessageMetadataParams{
		ID: msg.ID, Metadata: meta,
	})

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
	return req, msg, nil
}
