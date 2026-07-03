package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
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
		key := util.UUIDToString(inv.AgentID)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		s.DrainQueuedRoomInvocations(ctx, inv.AgentID)
	}
}

// SweepTimedOutRoomInvocations marks running invocations past timeout_at as timed_out.
func (s *TaskService) SweepTimedOutRoomInvocations(ctx context.Context) int {
	rows, err := s.Queries.ListTimedOutRunningRoomInvocations(ctx, roomInvocationSweepBatch)
	if err != nil {
		slog.Warn("room invocation sweeper: list timed out", "error", err)
		return 0
	}
	n := 0
	for _, inv := range rows {
		if inv.TaskID.Valid {
			_, _ = s.CancelTask(ctx, inv.TaskID)
		}
		_, err := s.Queries.UpdateRoomInvocationStatus(ctx, db.UpdateRoomInvocationStatusParams{
			ID:            inv.ID,
			Status:        "timed_out",
			FailureReason: pgtype.Text{String: "mention_timeout", Valid: true},
			CompletedAt:   pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
		if err != nil {
			continue
		}
		if room, roomErr := s.Queries.GetRoom(ctx, inv.RoomID); roomErr == nil {
			if assignment, aErr := s.Queries.GetRoomAssignment(ctx, inv.AssignmentID); aErr == nil {
				_ = s.FailAssignment(ctx, room, assignment, "timed_out")
			}
		}
		s.RefreshRoomSnapshot(ctx, inv.RoomID)
		n++
	}
	return n
}

// SweepManagerSoftWarnings posts a soft-warn invocation event for any
// manager invocation that has been running longer than the configured
// threshold. Per-room threshold is applied in Go so policy changes
// don't require a migration.
func (s *TaskService) SweepManagerSoftWarnings(ctx context.Context) int {
	rows, err := s.Queries.ListRunningRoomInvocationsForSoftWarn(ctx, roomInvocationSweepBatch)
	if err != nil {
		slog.Warn("room invocation sweeper: list manager soft warn", "error", err)
		return 0
	}
	n := 0
	now := time.Now()
	for _, inv := range rows {
		room, roomErr := s.Queries.GetRoom(ctx, inv.RoomID)
		if roomErr != nil || !room.ManagerAgentID.Valid {
			continue
		}
		if inv.AgentID.Bytes != room.ManagerAgentID.Bytes {
			continue
		}
		if !inv.StartedAt.Valid {
			continue
		}
		threshold := time.Duration(RoomManagerSoftWarnSeconds(room)) * time.Second
		runningFor := now.Sub(inv.StartedAt.Time)
		if runningFor < threshold {
			continue
		}
		if alreadyWarnedRecently(ctx, s, inv.ID, now, threshold/2) {
			continue
		}
		assignment, aErr := s.Queries.GetRoomAssignment(ctx, inv.AssignmentID)
		if aErr != nil {
			continue
		}
		s.appendInvocationEvent(ctx, room, assignment, inv, "invocation_soft_warn", "system", pgtype.UUID{}, map[string]any{
			"running_seconds":  int(runningFor.Seconds()),
			"threshold_seconds": int(threshold.Seconds()),
		})
		s.RefreshRoomSnapshot(ctx, inv.RoomID)
		n++
	}
	return n
}

func alreadyWarnedRecently(
	ctx context.Context,
	s *TaskService,
	invocationID pgtype.UUID,
	now time.Time,
	minInterval time.Duration,
) bool {
	events, err := s.Queries.ListRoomInvocationEventsByAssignment(ctx, invocationID)
	if err != nil {
		return false
	}
	for _, ev := range events {
		if ev.Type != "invocation_soft_warn" {
			continue
		}
		if now.Sub(ev.CreatedAt.Time) < minInterval {
			return true
		}
	}
	return false
}

// DrainQueuedRoomInvocations starts the next queued invocation for an agent when idle.
func (s *TaskService) DrainQueuedRoomInvocations(ctx context.Context, agentID pgtype.UUID) {
	running, err := s.Queries.CountRunningRoomInvocationsForAgent(ctx, agentID)
	if err != nil || running >= 1 {
		return
	}
	queued, err := s.Queries.ListQueuedRoomInvocationsForAgent(ctx, db.ListQueuedRoomInvocationsForAgentParams{
		AgentID: agentID, Limit: 1,
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
		ID: inv.SourceMessageID, RoomID: inv.RoomID,
	})
	if err != nil {
		s.failDrainingRoomInvocation(ctx, inv, "trigger message not found while draining queue")
		return
	}
	assignment, err := s.Queries.GetRoomAssignment(ctx, inv.AssignmentID)
	if err != nil {
		s.failDrainingRoomInvocation(ctx, inv, "assignment not found while draining queue")
		return
	}
	task, err := s.enqueueRoomGraphInvocationTask(ctx, room, msg, assignment, inv, agentID)
	if err != nil {
		s.failDrainingRoomInvocation(ctx, inv, err.Error())
		return
	}
	inv, err = s.Queries.UpdateRoomInvocationStatus(ctx, db.UpdateRoomInvocationStatusParams{
		ID: inv.ID, Status: "queued", TaskID: task.ID,
	})
	if err != nil {
		slog.Warn("drain queued invocation: status update failed",
			"invocation_id", util.UUIDToString(inv.ID), "error", err,
		)
		return
	}
	s.appendInvocationEvent(ctx, room, assignment, inv, "invocation_queued", "system", pgtype.UUID{}, nil)
	s.RefreshRoomSnapshot(ctx, inv.RoomID)
}

func (s *TaskService) failDrainingRoomInvocation(ctx context.Context, inv db.RoomInvocation, reason string) {
	slog.Warn("drain queued invocation failed",
		"invocation_id", util.UUIDToString(inv.ID),
		"room_id", util.UUIDToString(inv.RoomID),
		"reason", reason,
	)
	now := time.Now()
	_, err := s.Queries.UpdateRoomInvocationStatus(ctx, db.UpdateRoomInvocationStatusParams{
		ID:            inv.ID,
		Status:        "failed",
		FailureReason: pgtype.Text{String: reason, Valid: true},
		CompletedAt:   pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return
	}
	if room, roomErr := s.Queries.GetRoom(ctx, inv.RoomID); roomErr == nil {
		if assignment, aErr := s.Queries.GetRoomAssignment(ctx, inv.AssignmentID); aErr == nil {
			_ = s.FailAssignment(ctx, room, assignment, reason)
		}
	}
	s.RefreshRoomSnapshot(ctx, inv.RoomID)
}

// MaybeAutoRetryRoomInvocation retries a failed room invocation when the
// configured budget allows. For non-manager invocations it still requires
// the room to have no manager (legacy behaviour). For manager invocations
// the retry is allowed up to RoomManagerMaxRetries attempts per assignment,
// regardless of the per-invocation max_retries column.
func (s *TaskService) MaybeAutoRetryRoomInvocation(ctx context.Context, task db.AgentTaskQueue) bool {
	if !task.InvocationID.Valid || !task.RoomID.Valid {
		return false
	}
	inv, err := s.Queries.GetRoomInvocation(ctx, task.InvocationID)
	if err != nil {
		return false
	}
	room, err := s.Queries.GetRoom(ctx, task.RoomID)
	if err != nil {
		return false
	}

	isManager := room.ManagerAgentID.Valid && task.AgentID.Bytes == room.ManagerAgentID.Bytes
	if !isManager {
		if room.ManagerAgentID.Valid {
			return false
		}
		if inv.Intent != "ask" && inv.Intent != "execute" {
			return false
		}
		if inv.RetryCount >= inv.MaxRetries {
			return false
		}
		_, err = s.RetryRoomAssignment(ctx, room, inv.AssignmentID, pgtype.UUID{})
		return err == nil
	}

	budget := RoomManagerMaxRetries(room)
	if budget <= 0 {
		return false
	}
	prior, perr := s.Queries.ListRoomInvocationsByAssignment(ctx, inv.AssignmentID)
	if perr != nil {
		return false
	}
	if len(prior) > budget {
		return false
	}
	_, err = s.RetryRoomAssignment(ctx, room, inv.AssignmentID, pgtype.UUID{})
	return err == nil
}

