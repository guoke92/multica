package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// RequestRoomApprovalParams creates a pending human action with a system room message.
type RequestRoomApprovalParams struct {
	Room         db.Room
	InvocationID pgtype.UUID
	RequesterID  pgtype.UUID
	ActionType   string
	Payload      map[string]any
}

// RequestRoomApproval inserts a system message and room_human_action for inline UI.
func (s *TaskService) RequestRoomApproval(ctx context.Context, p RequestRoomApprovalParams) (db.RoomHumanAction, db.RoomMessage, error) {
	payload, _ := json.Marshal(p.Payload)
	if payload == nil {
		payload = []byte("{}")
	}
	summary := fmt.Sprintf("Approval required: **%s**", p.ActionType)
	msg, err := s.Queries.CreateRoomMessage(ctx, db.CreateRoomMessageParams{
		RoomID:     p.Room.ID,
		SenderType: "system",
		Content:    summary,
		Metadata:   []byte("{}"),
	})
	if err != nil {
		return db.RoomHumanAction{}, db.RoomMessage{}, fmt.Errorf("create approval message: %w", err)
	}

	inv, invErr := s.Queries.GetMentionInvocation(ctx, p.InvocationID)
	topicID := s.resolveFlowEventTopicID(ctx, p.Room.ID, inv)

	var invocationID pgtype.UUID
	if invErr == nil {
		invocationID = inv.ID
	}

	expiresAt := pgtype.Timestamptz{Time: time.Now().Add(4 * time.Hour), Valid: true}

	action, err := s.Queries.CreateRoomHumanAction(ctx, db.CreateRoomHumanActionParams{
		RoomID:       p.Room.ID,
		TopicID:      topicID,
		MessageID:    msg.ID,
		InvocationID: invocationID,
		Type:         "approval",
		Status:       "pending",
		Title:        p.ActionType,
		ExpiresAt:    expiresAt,
	})
	if err != nil {
		return db.RoomHumanAction{}, db.RoomMessage{}, fmt.Errorf("create human action: %w", err)
	}

	meta, _ := json.Marshal(map[string]string{
		"human_action_id": util.UUIDToString(action.ID),
		"action_type":     p.ActionType,
	})
	_ = s.Queries.UpdateRoomMessageMetadata(ctx, db.UpdateRoomMessageMetadataParams{
		ID:       msg.ID,
		Metadata: meta,
	})
	if topicID.Valid {
		_ = s.TouchRoomTopicLastMessage(ctx, topicID, msg.ID)
	}

	if s.Bus != nil {
		s.Bus.Publish(events.Event{
			Type:        protocol.EventRoomHumanActionUpdated,
			WorkspaceID: util.UUIDToString(p.Room.WorkspaceID),
			ActorType:   "agent",
			ActorID:     util.UUIDToString(p.RequesterID),
			Payload: map[string]string{
				"room_id":         util.UUIDToString(p.Room.ID),
				"human_action_id": util.UUIDToString(action.ID),
				"message_id":      util.UUIDToString(msg.ID),
				"status":          "pending",
			},
		})
		s.publishRoomMessage(ctx, p.Room, msg, db.AgentTaskQueue{})
	}
	return action, msg, nil
}
