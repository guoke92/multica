package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
	"github.com/multica-ai/multica/server/pkg/redact"
)

const roomMessageSummaryMaxLen = 320

func (s *TaskService) writeInvocationOutcome(ctx context.Context, inv db.RoomInvocation, outcome RoomInvocationOutcome) error {
	b, _ := json.Marshal(outcome)
	_, err := s.Queries.UpdateRoomInvocationOutcome(ctx, db.UpdateRoomInvocationOutcomeParams{
		ID:      inv.ID,
		Outcome: b,
	})
	return err
}

// CompleteAssignment marks an assignment completed and resolves join dependencies.
func (s *TaskService) CompleteAssignment(
	ctx context.Context,
	room db.Room,
	assignment db.RoomAssignment,
	outputMessageID pgtype.UUID,
) error {
	updated, err := s.Queries.UpdateRoomAssignmentStatus(ctx, db.UpdateRoomAssignmentStatusParams{
		ID:              assignment.ID,
		Status:          "completed",
		OutputMessageID: outputMessageID,
	})
	if err != nil {
		return err
	}
	s.publishRoomAssignmentUpdated(ctx, room, updated)
	s.appendInvocationEvent(ctx, room, updated, db.RoomInvocation{}, "assignment_completed", "system", pgtype.UUID{}, nil)
	return s.ResolveBlockedAssignments(ctx, room, updated.ID)
}

// FailAssignment marks an assignment failed.
func (s *TaskService) FailAssignment(ctx context.Context, room db.Room, assignment db.RoomAssignment, reason string) error {
	updated, err := s.Queries.UpdateRoomAssignmentStatus(ctx, db.UpdateRoomAssignmentStatusParams{
		ID:     assignment.ID,
		Status: "failed",
		Reason: pgtype.Text{String: reason, Valid: reason != ""},
	})
	if err != nil {
		return err
	}
	s.publishRoomAssignmentUpdated(ctx, room, updated)
	s.appendInvocationEvent(ctx, room, updated, db.RoomInvocation{}, "assignment_failed", "system", pgtype.UUID{}, map[string]any{
		"reason": reason,
	})
	if err := s.handleFailedDependencyAssignments(ctx, room, updated.ID); err != nil {
		return err
	}
	return s.maybeEscalateFailedAssignmentToManager(ctx, room, updated, reason)
}

// CancelAssignment cancels an assignment and its active invocation.
func (s *TaskService) CancelAssignment(ctx context.Context, room db.Room, assignmentID pgtype.UUID, userID pgtype.UUID) error {
	assignment, err := s.Queries.GetRoomAssignmentInRoom(ctx, db.GetRoomAssignmentInRoomParams{
		ID: assignmentID, RoomID: room.ID,
	})
	if err != nil {
		return err
	}
	if assignment.Status == "completed" || assignment.Status == "cancelled" {
		return nil
	}
	var cancelledInv *db.RoomInvocation
	if inv, invErr := s.Queries.GetActiveRoomInvocationForAssignment(ctx, assignment.ID); invErr == nil {
		cancelledInv = &inv
		if inv.TaskID.Valid {
			_, _ = s.CancelTask(ctx, inv.TaskID)
		}
		_, _ = s.Queries.CancelRoomInvocation(ctx, db.CancelRoomInvocationParams{
			ID: inv.ID, CancelledBy: userID,
		})
	}
	updated, err := s.Queries.UpdateRoomAssignmentStatus(ctx, db.UpdateRoomAssignmentStatusParams{
		ID: assignment.ID, Status: "cancelled",
	})
	if err != nil {
		return err
	}
	if cancelledInv != nil {
		_ = s.writeInvocationOutcome(ctx, *cancelledInv, cancelledOutcome())
	}
	if err != nil {
		return err
	}
	s.publishRoomAssignmentUpdated(ctx, room, updated)
	s.appendInvocationEvent(ctx, room, updated, db.RoomInvocation{}, "assignment_cancelled", "user", userID, nil)
	s.RefreshRoomSnapshot(ctx, room.ID)
	return s.handleFailedDependencyAssignments(ctx, room, updated.ID)
}

// ResolveBlockedAssignments checks join dependencies after a prerequisite completes.
func (s *TaskService) ResolveBlockedAssignments(ctx context.Context, room db.Room, completedAssignmentID pgtype.UUID) error {
	blocked, err := s.Queries.LockBlockedAssignmentsDependingOn(ctx, completedAssignmentID)
	if err != nil {
		return err
	}
	for _, assignment := range blocked {
		incomplete, err := s.Queries.ListIncompleteDependenciesForAssignment(ctx, assignment.ID)
		if err != nil || len(incomplete) > 0 {
			continue
		}
		sourceMsg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
			ID: assignment.SourceMessageID, RoomID: room.ID,
		})
		if err != nil {
			continue
		}
		updated, err := s.Queries.UnblockRoomAssignmentIfBlocked(ctx, assignment.ID)
		if err != nil {
			continue
		}
		s.publishRoomAssignmentUpdated(ctx, room, updated)
		intent := "ask"
		if assignment.Kind == "join" {
			intent = "execute"
		}
		inv, err := s.createInvocationForAssignment(ctx, room, updated, sourceMsg, intent, time.Now().Add(30*time.Minute),
			func(_ context.Context, _ db.Agent, _, _, _ string) bool { return true },
			"system", "", util.UUIDToString(room.WorkspaceID),
		)
		if err != nil {
			slog.Warn("resolve blocked assignment invocation failed", "assignment_id", util.UUIDToString(assignment.ID), "error", err)
			continue
		}
		s.DrainQueuedRoomInvocations(ctx, inv.AgentID)
	}
	s.RefreshRoomSnapshot(ctx, room.ID)
	return nil
}

type CreateRoomAssignmentParams struct {
	Room                   db.Room
	SourceMessageID        pgtype.UUID
	AssigneeType           string
	AssigneeID             pgtype.UUID
	Kind                   string
	Reason                 string
	CreatedByType          string
	CreatedByID            pgtype.UUID
	DependsOnAssignmentIDs []pgtype.UUID
	CanAccessAgent         PrivateAgentGate
	AuthorType             string
	AuthorID               string
	WorkspaceID            string
}

// CreateRoomAssignment creates a manual assignment. When dependencies are
// provided, it creates a blocked join-style assignment without enqueuing work.
func (s *TaskService) CreateRoomAssignment(ctx context.Context, p CreateRoomAssignmentParams) (db.RoomAssignment, db.RoomInvocation, error) {
	sourceMsg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: p.SourceMessageID, RoomID: p.Room.ID,
	})
	if err != nil {
		return db.RoomAssignment{}, db.RoomInvocation{}, err
	}
	kind := p.Kind
	if kind == "" {
		kind = "manager_route"
	}
	blocked := len(p.DependsOnAssignmentIDs) > 0 || kind == "join"
	assignment, inv, err := s.createAssignmentWithInvocation(ctx, createAssignmentParams{
		Room: p.Room, SourceMessage: sourceMsg,
		AssigneeType: p.AssigneeType, AssigneeID: p.AssigneeID,
		Kind: kind, Reason: p.Reason,
		CreatedByType: p.CreatedByType, CreatedByID: p.CreatedByID,
		Intent: "execute", TimeoutAt: time.Now().Add(30 * time.Minute),
		CanAccessAgent: p.CanAccessAgent,
		AuthorType:     p.AuthorType, AuthorID: p.AuthorID, WorkspaceID: p.WorkspaceID,
		Blocked: blocked,
	})
	if err != nil {
		return db.RoomAssignment{}, db.RoomInvocation{}, err
	}
	for _, depID := range p.DependsOnAssignmentIDs {
		if !depID.Valid {
			continue
		}
		if _, err := s.Queries.CreateRoomAssignmentDependency(ctx, db.CreateRoomAssignmentDependencyParams{
			AssignmentID: assignment.ID, DependsOnAssignmentID: depID,
		}); err != nil {
			return assignment, inv, err
		}
		s.publishRoomAssignmentDependencyUpdated(ctx, p.Room, assignment.ID, depID)
	}
	s.RefreshRoomSnapshot(ctx, p.Room.ID)
	return assignment, inv, nil
}

func (s *TaskService) handleFailedDependencyAssignments(ctx context.Context, room db.Room, terminalAssignmentID pgtype.UUID) error {
	blocked, err := s.Queries.LockBlockedAssignmentsDependingOn(ctx, terminalAssignmentID)
	if err != nil {
		return err
	}
	for _, assignment := range blocked {
		updated, err := s.Queries.UpdateRoomAssignmentStatus(ctx, db.UpdateRoomAssignmentStatusParams{
			ID:     assignment.ID,
			Status: "failed",
			Reason: pgtype.Text{String: "dependency failed or cancelled", Valid: true},
		})
		if err != nil {
			continue
		}
		s.publishRoomAssignmentUpdated(ctx, room, updated)
		s.appendInvocationEvent(ctx, room, updated, db.RoomInvocation{}, "assignment_failed", "system", pgtype.UUID{}, map[string]any{
			"reason": "dependency_failed",
		})
	}
	s.RefreshRoomSnapshot(ctx, room.ID)
	return nil
}

// CreateJoinAssignments creates parallel assignments with a blocked join continuation.
func (s *TaskService) CreateJoinAssignments(
	ctx context.Context,
	room db.Room,
	sourceMessage db.RoomMessage,
	prerequisiteMentions []util.Mention,
	continuationAgentID pgtype.UUID,
	authorType, authorID, workspaceID string,
	canAccessAgent PrivateAgentGate,
) ([]db.RoomAssignment, error) {
	timeoutAt := time.Now().Add(30 * time.Minute)
	var prereqAssignments []db.RoomAssignment

	for _, m := range prerequisiteMentions {
		assigneeID := parseMentionTargetID(m)
		if !assigneeID.Valid {
			continue
		}
		a, _, err := s.createAssignmentWithInvocation(ctx, createAssignmentParams{
			Room: room, SourceMessage: sourceMessage,
			AssigneeType: m.Type, AssigneeID: assigneeID, Kind: "mention",
			CreatedByType: authorType, CreatedByID: parseOptionalActorID(authorID),
			Intent: s.roomMentionIntent(room), TimeoutAt: timeoutAt,
			CanAccessAgent: canAccessAgent, AuthorType: authorType,
			AuthorID: authorID, WorkspaceID: workspaceID,
		})
		if err != nil {
			return nil, err
		}
		prereqAssignments = append(prereqAssignments, a)
	}

	joinAssignment, _, err := s.createAssignmentWithInvocation(ctx, createAssignmentParams{
		Room: room, SourceMessage: sourceMessage,
		AssigneeType: "agent", AssigneeID: continuationAgentID, Kind: "join",
		CreatedByType: authorType, CreatedByID: parseOptionalActorID(authorID),
		Blocked: true, Intent: "execute", TimeoutAt: timeoutAt,
		CanAccessAgent: canAccessAgent, AuthorType: authorType,
		AuthorID: authorID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return nil, err
	}

	for _, prereq := range prereqAssignments {
		_, err := s.Queries.CreateRoomAssignmentDependency(ctx, db.CreateRoomAssignmentDependencyParams{
			AssignmentID: joinAssignment.ID, DependsOnAssignmentID: prereq.ID,
		})
		if err != nil {
			return nil, err
		}
		s.publishRoomAssignmentDependencyUpdated(ctx, room, joinAssignment.ID, prereq.ID)
	}

	out := append(prereqAssignments, joinAssignment)
	s.RefreshRoomSnapshot(ctx, room.ID)
	return out, nil
}

// CompleteInvocationWithOutput finalizes an invocation, posts agent output, and continues the graph.
func (s *TaskService) CompleteInvocationWithOutput(
	ctx context.Context,
	task db.AgentTaskQueue,
	inv db.RoomInvocation,
	room db.Room,
	body string,
) error {
	assignment, err := s.Queries.GetRoomAssignment(ctx, inv.AssignmentID)
	if err != nil {
		return err
	}

	now := time.Now()
	short := truncateForSummary(body, roomMessageSummaryMaxLen)
	meta, _ := json.Marshal(map[string]string{
		"detailed_explanation": body,
		"task_id":              util.UUIDToString(task.ID),
		"invocation_id":        util.UUIDToString(inv.ID),
		"assignment_id":        util.UUIDToString(assignment.ID),
		"trigger_message_id":   util.UUIDToString(inv.SourceMessageID),
	})

	isManagerRun := room.ManagerAgentID.Valid &&
		task.AgentID.Bytes == room.ManagerAgentID.Bytes &&
		(assignment.Kind == "auto_review" || assignment.Kind == "manager_route" || assignment.Kind == "manager_relay")

	var outputMsg db.RoomMessage
	if !isManagerRun {
		msg, err := s.Queries.CreateRoomMessage(ctx, db.CreateRoomMessageParams{
			ID:             util.MustNewUUIDv7(),
			RoomID:         room.ID,
			SenderType:     "agent",
			SenderID:       pgtype.UUID{Bytes: task.AgentID.Bytes, Valid: true},
			Content:        redact.Text(short),
			Metadata:       meta,
			QuoteMessageID: inv.SourceMessageID,
		})
		if err != nil {
			return err
		}
		outputMsg = msg
		s.publishRoomMessage(ctx, room, msg, task)
	}

	_, _ = s.Queries.UpdateRoomInvocationStatus(ctx, db.UpdateRoomInvocationStatusParams{
		ID: inv.ID, Status: "succeeded",
		OutputMessageID: outputMsg.ID,
		CompletedAt:     pgtype.Timestamptz{Time: now, Valid: true},
	})
	s.appendInvocationEvent(ctx, room, assignment, inv, "invocation_succeeded", "agent", task.AgentID, nil)

	if err := s.CompleteAssignment(ctx, room, assignment, outputMsg.ID); err != nil {
		return err
	}

	if isManagerRun {
		return s.ApplyManagerDecisionFromOutput(ctx, room, inv, assignment, body)
	}

	if outputMsg.ID.Valid {
		if err := s.writeInvocationOutcome(ctx, inv, roleOutcome(util.UUIDToString(outputMsg.ID))); err != nil {
			slog.Warn("write role agent invocation outcome failed", "invocation_id", util.UUIDToString(inv.ID), "error", err)
		}
		return s.continueGraphAfterAgentOutput(ctx, room, outputMsg, task.AgentID)
	}
	return nil
}

func (s *TaskService) continueGraphAfterAgentOutput(
	ctx context.Context,
	room db.Room,
	outputMsg db.RoomMessage,
	agentID pgtype.UUID,
) error {
	mentions, err := s.collectRoomMentions(ctx, room, outputMsg.Content)
	if err != nil {
		return err
	}
	var agentMentions []util.Mention
	for _, m := range mentions {
		if m.Type == "agent" || m.Type == "squad" {
			if m.Type == "agent" && m.ID == util.UUIDToString(agentID) {
				continue
			}
			agentMentions = append(agentMentions, m)
		}
	}

	p := RoomMentionDispatchParams{
		Room: room, Message: outputMsg,
		AuthorType: "agent", AuthorID: util.UUIDToString(agentID),
		WorkspaceID:    util.UUIDToString(room.WorkspaceID),
		CanAccessAgent: func(_ context.Context, _ db.Agent, _, _, _ string) bool { return true },
		MaxChainDepth:  RoomMaxChainDepth(room), DefaultTimeout: 30 * time.Minute,
		MentionContent: outputMsg.Content,
	}

	if len(agentMentions) > 0 {
		_, _ = s.ParseAndPersistMentions(ctx, room, outputMsg, outputMsg.Content)
		_, _, err := s.createMentionAssignments(ctx, p, agentMentions, 30*time.Minute)
		return err
	}
	if s.exceedsAgentChainDepth(ctx, room, outputMsg) {
		return nil
	}
	_, _, err = s.maybeCreateManagerAutoReview(ctx, p, 30*time.Minute)
	return err
}

func (s *TaskService) appendInvocationEvent(
	ctx context.Context,
	room db.Room,
	assignment db.RoomAssignment,
	inv db.RoomInvocation,
	eventType, actorType string,
	actorID pgtype.UUID,
	payload map[string]any,
) {
	payloadBytes := []byte("{}")
	if len(payload) > 0 {
		if b, err := json.Marshal(payload); err == nil {
			payloadBytes = b
		}
	}
	var invID pgtype.UUID
	if inv.ID.Valid {
		invID = inv.ID
	}
	event, err := s.Queries.AppendRoomInvocationEvent(ctx, db.AppendRoomInvocationEventParams{
		ID:           util.MustNewUUIDv7(),
		RoomID:       room.ID,
		AssignmentID: assignment.ID,
		InvocationID: invID,
		Type:         eventType,
		ActorType:    actorType,
		ActorID:      actorID,
		Payload:      payloadBytes,
	})
	if err != nil {
		return
	}
	s.publishRoomInvocationEventCreated(ctx, room, event)
}

func (s *TaskService) publishRoomAssignmentUpdated(ctx context.Context, room db.Room, a db.RoomAssignment) {
	if s.Bus == nil {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomAssignmentUpdated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		Payload: map[string]string{
			"room_id":       util.UUIDToString(room.ID),
			"assignment_id": util.UUIDToString(a.ID),
			"status":        a.Status,
			"kind":          a.Kind,
		},
	})
}

func (s *TaskService) publishRoomAssignmentDependencyUpdated(ctx context.Context, room db.Room, assignmentID, dependsOnID pgtype.UUID) {
	if s.Bus == nil {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomAssignmentDependencyUpdated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		Payload: map[string]string{
			"room_id":                  util.UUIDToString(room.ID),
			"assignment_id":            util.UUIDToString(assignmentID),
			"depends_on_assignment_id": util.UUIDToString(dependsOnID),
		},
	})
}

func (s *TaskService) publishRoomInvocationEventCreated(ctx context.Context, room db.Room, event db.RoomInvocationEvent) {
	if s.Bus == nil {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomInvocationEventCreated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		Payload: map[string]string{
			"room_id":       util.UUIDToString(room.ID),
			"event_id":      util.UUIDToString(event.ID),
			"assignment_id": util.UUIDToString(event.AssignmentID),
			"type":          event.Type,
		},
	})
}

func (s *TaskService) publishRoomManagerDecisionCreated(ctx context.Context, room db.Room, decision db.RoomManagerDecision) {
	if s.Bus == nil {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomManagerDecisionCreated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		Payload: map[string]string{
			"room_id":     util.UUIDToString(room.ID),
			"decision_id": util.UUIDToString(decision.ID),
			"action":      decision.Action,
		},
	})
}

// RetryRoomAssignment creates a new invocation attempt for a failed assignment.
func (s *TaskService) RetryRoomAssignment(ctx context.Context, room db.Room, assignmentID pgtype.UUID, userID pgtype.UUID) (db.RoomInvocation, error) {
	assignment, err := s.Queries.GetRoomAssignmentInRoom(ctx, db.GetRoomAssignmentInRoomParams{
		ID: assignmentID, RoomID: room.ID,
	})
	if err != nil {
		return db.RoomInvocation{}, err
	}
	if assignment.Status != "failed" && assignment.Status != "cancelled" {
		return db.RoomInvocation{}, fmt.Errorf("assignment is not retryable")
	}
	sourceMsg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: assignment.SourceMessageID, RoomID: room.ID,
	})
	if err != nil {
		return db.RoomInvocation{}, err
	}
	updated, err := s.Queries.UpdateRoomAssignmentStatus(ctx, db.UpdateRoomAssignmentStatusParams{
		ID: assignment.ID, Status: "running",
	})
	if err != nil {
		return db.RoomInvocation{}, err
	}
	intent := "ask"
	if assignment.Kind == "auto_review" {
		intent = "review"
	}
	inv, err := s.createInvocationForAssignment(ctx, room, updated, sourceMsg, intent, time.Now().Add(30*time.Minute),
		func(_ context.Context, _ db.Agent, _, _, _ string) bool { return true },
		"user", util.UUIDToString(userID), util.UUIDToString(room.WorkspaceID),
	)
	if err != nil {
		return db.RoomInvocation{}, err
	}
	s.appendInvocationEvent(ctx, room, updated, inv, "assignment_retry", "user", userID, nil)
	s.RefreshRoomSnapshot(ctx, room.ID)
	s.DrainQueuedRoomInvocations(ctx, inv.AgentID)
	return inv, nil
}

func truncateAssignmentReason(s string) string {
	s = strings.TrimSpace(s)
	if runes := []rune(s); len(runes) > 200 {
		return string(runes[:200]) + "…"
	}
	return s
}
