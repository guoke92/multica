package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

const roomInvocationSweepBatch = 50

// ProcessQueuedRoomInvocations tries to start queued invocations whose agents are idle.
func (s *TaskService) ProcessQueuedRoomInvocations(ctx context.Context) {
	rows, err := s.Queries.ListQueuedRoomInvocations(ctx, 50)
	if err != nil {
		return
	}
	seen := make(map[string]struct{})
	for _, inv := range rows {
		if inv.TaskID.Valid {
			task, err := s.Queries.GetAgentTask(ctx, inv.TaskID)
			if err == nil && task.Status == "queued" {
				s.NotifyTaskEnqueued(ctx, task)
			}
			continue
		}
		room, err := s.Queries.GetRoom(ctx, inv.RoomID)
		if err != nil {
			continue
		}
		agentID, _, err := s.ResolveRoomMentionAgent(ctx, room.WorkspaceID, util.Mention{
			Type: inv.TargetType,
			ID:   util.UUIDToString(inv.TargetID),
		})
		if err != nil {
			continue
		}
		key := util.UUIDToString(agentID)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		s.DrainQueuedRoomInvocations(ctx, agentID)
	}
}

// SweepTimedOutRoomInvocations marks running invocations past timeout_at as timed_out.
func (s *TaskService) SweepTimedOutRoomInvocations(ctx context.Context) int {
	rows, err := s.Queries.ListTimedOutRunningInvocations(ctx, roomInvocationSweepBatch)
	if err != nil {
		slog.Warn("room invocation sweeper: list timed out", "error", err)
		return 0
	}
	n := 0
	for _, inv := range rows {
		if inv.TaskID.Valid {
			_, _ = s.CancelTask(ctx, inv.TaskID)
		}
		_, err := s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
			ID:            inv.ID,
			Status:        "timed_out",
			FailureReason: pgtype.Text{String: "mention_timeout", Valid: true},
			CompletedAt:   pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
		if err != nil {
			continue
		}
		if room, roomErr := s.Queries.GetRoom(ctx, inv.RoomID); roomErr == nil {
			if updated, loadErr := s.Queries.GetMentionInvocation(ctx, inv.ID); loadErr == nil {
				s.MaybeRecordInvocationStatusFlowEvent(ctx, room, updated, "timed_out")
			}
		}
		s.RefreshRoomSnapshot(ctx, inv.RoomID)
		n++
	}
	return n
}

// DrainQueuedRoomInvocations starts the next queued invocation for an agent when idle.
func (s *TaskService) DrainQueuedRoomInvocations(ctx context.Context, agentID pgtype.UUID) {
	running, err := s.Queries.CountRunningInvocationsForAgent(ctx, agentID)
	if err != nil || running >= 1 {
		return
	}
	queued, err := s.Queries.ListQueuedInvocationsForExecutor(ctx, db.ListQueuedInvocationsForExecutorParams{
		TargetID: agentID,
		Limit:    1,
	})
	if err != nil || len(queued) == 0 {
		return
	}
	inv := queued[0]
	if inv.TaskID.Valid {
		return
	}
	room, err := s.Queries.GetRoom(ctx, inv.RoomID)
	if err != nil {
		s.failDrainingRoomInvocation(ctx, inv, "room not found while draining queue")
		return
	}
	msg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID:     inv.MessageID,
		RoomID: inv.RoomID,
	})
	if err != nil {
		s.failDrainingRoomInvocation(ctx, inv, "trigger message not found while draining queue")
		return
	}
	agentID2, isLeader, err := s.ResolveRoomMentionAgent(ctx, room.WorkspaceID, util.Mention{
		Type: inv.TargetType,
		ID:   util.UUIDToString(inv.TargetID),
	})
	if err != nil {
		s.failDrainingRoomInvocation(ctx, inv, "agent not resolvable while draining queue")
		return
	}
	task, err := s.EnqueueRoomInvocationTask(ctx, EnqueueRoomInvocationParams{
		Room:       room,
		Message:    msg,
		Invocation: inv,
		AgentID:    agentID2,
		IsLeader:   isLeader,
	})
	if err != nil {
		s.failDrainingRoomInvocation(ctx, inv, err.Error())
		return
	}
	now := time.Now()
	updated, err := s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
		ID:          inv.ID,
		Status:      "queued",
		TaskID:      task.ID,
		DeliveredAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.Warn("drain queued invocation: status update failed",
			"invocation_id", util.UUIDToString(inv.ID),
			"error", err,
		)
		return
	}
	s.MaybeRecordInvocationStatusFlowEvent(ctx, room, updated, "queued")
	s.RefreshRoomSnapshot(ctx, inv.RoomID)
}

func (s *TaskService) failDrainingRoomInvocation(ctx context.Context, inv db.MentionInvocation, reason string) {
	slog.Warn("drain queued invocation failed",
		"invocation_id", util.UUIDToString(inv.ID),
		"room_id", util.UUIDToString(inv.RoomID),
		"reason", reason,
	)
	now := time.Now()
	updated, err := s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
		ID:            inv.ID,
		Status:        "failed",
		FailureReason: pgtype.Text{String: reason, Valid: true},
		CompletedAt:   pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return
	}
	if room, roomErr := s.Queries.GetRoom(ctx, inv.RoomID); roomErr == nil {
		s.MaybeRecordInvocationStatusFlowEvent(ctx, room, updated, "failed")
	}
	s.RefreshRoomSnapshot(ctx, inv.RoomID)
}

// SweepExpiredRoomHumanActions marks stale pending human actions as expired (G7).
func (s *TaskService) SweepExpiredRoomHumanActions(ctx context.Context) int {
	rows, err := s.Queries.ListExpiredPendingRoomHumanActions(ctx, 50)
	if err != nil {
		slog.Warn("room human action sweeper: list expired", "error", err)
		return 0
	}
	n := 0
	for _, action := range rows {
		expired, err := s.Queries.ExpireRoomHumanAction(ctx, db.ExpireRoomHumanActionParams{
			ID:     action.ID,
			Reason: pgtype.Text{String: "expired", Valid: true},
		})
		if err != nil {
			continue
		}
		if room, roomErr := s.Queries.GetRoom(ctx, expired.RoomID); roomErr == nil {
			s.RecordRoomFlowEvent(ctx, room, db.InsertRoomFlowEventParams{
				RoomID:       room.ID,
				TopicID:      expired.TopicID,
				Type:         "human_confirm_expired",
				MessageID:    expired.MessageID,
				InvocationID: expired.InvocationID,
				ActorType:    "system",
				Payload:      []byte(`{"status":"expired"}`),
			})
			if s.Bus != nil {
				s.Bus.Publish(events.Event{
					Type:        protocol.EventRoomHumanActionUpdated,
					WorkspaceID: util.UUIDToString(room.WorkspaceID),
					Payload: map[string]string{
						"room_id":   util.UUIDToString(room.ID),
						"action_id": util.UUIDToString(expired.ID),
						"status":    expired.Status,
					},
				})
			}
		}
		n++
	}
	return n
}

// MaybeAutoRetryRoomInvocation retries a failed ask invocation once when policy allows.
func (s *TaskService) MaybeAutoRetryRoomInvocation(ctx context.Context, task db.AgentTaskQueue) bool {
	if !task.InvocationID.Valid || !task.RoomID.Valid {
		return false
	}
	inv, err := s.Queries.GetMentionInvocation(ctx, task.InvocationID)
	if err != nil || (inv.Intent != "ask" && inv.Intent != "execute") || inv.RetryCount >= inv.MaxRetries {
		return false
	}
	room, err := s.Queries.GetRoom(ctx, task.RoomID)
	if err != nil {
		return false
	}
	// In Router/Supervisor mode (room has Manager), skip auto-retry.
	// The Manager will be notified of the failure and decide whether to retry,
	// re-route, or escalate via ProcessRoomWorkflowOnComplete.
	if room.ManagerAgentID.Valid {
		return false
	}
	msg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID:     inv.MessageID,
		RoomID: inv.RoomID,
	})
	if err != nil {
		return false
	}
	inv, err = s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
		ID:         inv.ID,
		Status:     "pending",
		RetryCount: pgtype.Int4{Int32: inv.RetryCount + 1, Valid: true},
	})
	if err != nil {
		return false
	}
	agentID, isLeader, err := s.ResolveRoomMentionAgent(ctx, room.WorkspaceID, util.Mention{
		Type: inv.TargetType,
		ID:   util.UUIDToString(inv.TargetID),
	})
	if err != nil {
		return false
	}
	running, err := s.Queries.CountRunningInvocationsForAgent(ctx, agentID)
	if err == nil && running >= 1 {
		_, _ = s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
			ID:     inv.ID,
			Status: "queued",
		})
		s.RefreshRoomSnapshot(ctx, inv.RoomID)
		return true
	}
	newTask, err := s.EnqueueRoomInvocationTask(ctx, EnqueueRoomInvocationParams{
		Room:       room,
		Message:    msg,
		Invocation: inv,
		AgentID:    agentID,
		IsLeader:   isLeader,
	})
	if err != nil {
		return false
	}
	now := time.Now()
	_, _ = s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
		ID:          inv.ID,
		Status:      "queued",
		TaskID:      newTask.ID,
		DeliveredAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	s.DrainQueuedRoomInvocations(ctx, agentID)
	s.RefreshRoomSnapshot(ctx, inv.RoomID)
	return true
}
