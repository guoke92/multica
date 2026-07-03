package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// maybeRequestRoomApprovalFromResult checks task result JSON for approval_required.
func (s *TaskService) maybeRequestRoomApprovalFromResult(ctx context.Context, task db.AgentTaskQueue, result []byte) bool {
	if !task.RoomID.Valid || !task.InvocationID.Valid || len(result) == 0 {
		return false
	}
	var payload struct {
		ApprovalRequired bool   `json:"approval_required"`
		ApprovalAction   string `json:"approval_action"`
	}
	if err := json.Unmarshal(result, &payload); err != nil || !payload.ApprovalRequired {
		return false
	}
	action := payload.ApprovalAction
	if action == "" {
		action = "execution"
	}
	room, err := s.Queries.GetRoom(ctx, task.RoomID)
	if err != nil {
		return false
	}
	_, _, err = s.RequestRoomApproval(ctx, RequestRoomApprovalParams{
		Room:             room,
		RoomInvocationID: task.InvocationID,
		RequesterID:      task.AgentID,
		ActionType:       action,
	})
	return err == nil
}

// reconcileRoomInvocationCancelled marks the invocation cancelled when its task is cancelled.
func (s *TaskService) reconcileRoomInvocationCancelled(ctx context.Context, task db.AgentTaskQueue) {
	if !task.RoomID.Valid || !task.InvocationID.Valid {
		return
	}
	inv, err := s.Queries.GetRoomInvocation(ctx, task.InvocationID)
	if err != nil {
		return
	}
	if inv.Status == "succeeded" || inv.Status == "cancelled" {
		return
	}
	now := time.Now()
	inv, _ = s.Queries.UpdateRoomInvocationStatus(ctx, db.UpdateRoomInvocationStatusParams{
		ID: inv.ID, Status: "cancelled",
		CompletedAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	_ = s.writeInvocationOutcome(ctx, inv, cancelledOutcome())
	if room, roomErr := s.Queries.GetRoom(ctx, task.RoomID); roomErr == nil {
		if assignment, aErr := s.Queries.GetRoomAssignment(ctx, inv.AssignmentID); aErr == nil {
			s.appendInvocationEvent(ctx, room, assignment, inv, "invocation_cancelled", "system", pgtype.UUID{}, nil)
		}
	}
	s.RefreshRoomSnapshot(ctx, task.RoomID)
	s.publishRoomInvocationUpdated(ctx, task.RoomID)
	s.DrainQueuedRoomInvocations(ctx, task.AgentID)
}

// finalizeRoomInvocation completes or fails the invocation tied to a room task.
func (s *TaskService) finalizeRoomInvocation(ctx context.Context, task db.AgentTaskQueue, status string, output string, failureReason string) {
	if !task.InvocationID.Valid {
		return
	}
	inv, err := s.Queries.GetRoomInvocation(ctx, task.InvocationID)
	if err != nil {
		return
	}
	if inv.Status == "cancelled" || inv.Status == "succeeded" {
		return
	}

	room, roomErr := s.Queries.GetRoom(ctx, task.RoomID)
	if roomErr != nil {
		return
	}
	assignment, aErr := s.Queries.GetRoomAssignment(ctx, inv.AssignmentID)
	if aErr != nil {
		return
	}

	now := time.Now()
	if status == "succeeded" {
		body := s.resolveRoomTaskBody(ctx, task, output)
		if strings.TrimSpace(body) == "" {
			_, _ = s.Queries.UpdateRoomInvocationStatus(ctx, db.UpdateRoomInvocationStatusParams{
				ID: inv.ID, Status: "failed",
				FailureReason: pgtype.Text{String: "empty agent response", Valid: true},
				CompletedAt:     pgtype.Timestamptz{Time: now, Valid: true},
			})
			_ = s.FailAssignment(ctx, room, assignment, "empty agent response")
		} else if err := s.CompleteInvocationWithOutput(ctx, task, inv, room, body); err != nil {
			slog.Warn("complete invocation with output failed", "error", err)
			_, _ = s.Queries.UpdateRoomInvocationStatus(ctx, db.UpdateRoomInvocationStatusParams{
				ID: inv.ID, Status: "failed",
				FailureReason: pgtype.Text{String: err.Error(), Valid: true},
				CompletedAt:     pgtype.Timestamptz{Time: now, Valid: true},
			})
			_ = s.FailAssignment(ctx, room, assignment, err.Error())
		}
	} else {
		_, _ = s.Queries.UpdateRoomInvocationStatus(ctx, db.UpdateRoomInvocationStatusParams{
			ID: inv.ID, Status: "failed",
			FailureReason: pgtype.Text{String: failureReason, Valid: failureReason != ""},
			CompletedAt:     pgtype.Timestamptz{Time: now, Valid: true},
		})
		s.appendInvocationEvent(ctx, room, assignment, inv, "invocation_failed", "agent", task.AgentID, map[string]any{
			"reason": failureReason,
		})
		_ = s.FailAssignment(ctx, room, assignment, failureReason)
	}

	s.RefreshRoomSnapshot(ctx, task.RoomID)
	s.publishRoomInvocationUpdated(ctx, task.RoomID)
	s.DrainQueuedRoomInvocations(ctx, task.AgentID)
}

// resolveRoomTaskBody prefers the daemon's terminal output; when empty, waits briefly for task_messages.
func (s *TaskService) resolveRoomTaskBody(ctx context.Context, task db.AgentTaskQueue, output string) string {
	body := strings.TrimSpace(util.UnescapeBackslashEscapes(output))
	if body != "" || !task.ID.Valid {
		return body
	}
	const attempts = 5
	for i := 0; i < attempts; i++ {
		msgs, err := s.Queries.ListTaskMessages(ctx, task.ID)
		if err == nil && len(msgs) > 0 {
			body = strings.TrimSpace(extractRoomReplyFromTaskMessages(msgs))
			if body != "" {
				return body
			}
		}
		if i < attempts-1 {
			time.Sleep(150 * time.Millisecond)
		}
	}
	return ""
}

func (s *TaskService) publishRoomInvocationUpdated(ctx context.Context, roomID pgtype.UUID) {
	if s.Bus == nil {
		return
	}
	room, err := s.Queries.GetRoom(ctx, roomID)
	if err != nil {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomInvocationUpdated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		Payload: map[string]string{
			"room_id": util.UUIDToString(roomID),
		},
	})
}

func (s *TaskService) publishRoomMessage(ctx context.Context, room db.Room, msg db.RoomMessage, task db.AgentTaskQueue) {
	if s.Bus == nil {
		return
	}
	payload := protocol.RoomMessagePayload{
		RoomID:    util.UUIDToString(room.ID),
		MessageID: util.UUIDToString(msg.ID),
		Role:      msg.SenderType,
		Content:   msg.Content,
		CreatedAt: msg.CreatedAt.Time.Format(time.RFC3339),
	}
	if task.ID.Valid {
		payload.TaskID = util.UUIDToString(task.ID)
	}
	actorType := msg.SenderType
	actorID := ""
	if msg.SenderID.Valid {
		actorID = util.UUIDToString(msg.SenderID)
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomMessageCreated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		ActorType:   actorType,
		ActorID:     actorID,
		Payload:     payload,
	})
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomMessageUpdated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		ActorType:   actorType,
		ActorID:     actorID,
		Payload:     payload,
	})
}
