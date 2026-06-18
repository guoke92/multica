package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// RoomGraphProcessResult is returned after creating a message and running assignment logic.
type RoomGraphProcessResult struct {
	Assignments []db.RoomAssignment
	Invocations []db.RoomInvocation
}

// RoomGraphSnapshot aggregates the room collaboration graph for the API.
type RoomGraphSnapshot struct {
	Messages               []db.RoomMessage
	Mentions               []db.RoomMessageMention
	Assignments            []db.RoomAssignment
	AssignmentDependencies []db.RoomAssignmentDependency
	Invocations            []db.RoomInvocation
	Decisions              []db.RoomManagerDecision
	InvocationEvents       []db.RoomInvocationEvent
}

const roomGraphContextType = "room_graph"

type roomGraphTaskContext struct {
	Type         string `json:"type"`
	AssignmentID string `json:"assignment_id"`
	Intent       string `json:"intent"`
	Kind         string `json:"kind,omitempty"`
}

func marshalRoomGraphContext(ctx roomGraphTaskContext) []byte {
	ctx.Type = roomGraphContextType
	b, _ := json.Marshal(ctx)
	return b
}

// ProcessRoomMessageAfterCreate parses mentions and creates assignments + invocations.
func (s *TaskService) ProcessRoomMessageAfterCreate(
	ctx context.Context,
	p RoomMentionDispatchParams,
) (RoomGraphProcessResult, error) {
	if err := s.ParseAndPersistMentions(ctx, p.Room, p.Message, p.MentionContent); err != nil {
		return RoomGraphProcessResult{}, err
	}
	return s.ProcessMessageForAssignments(ctx, p)
}

// ParseAndPersistMentions stores structured mentions for a message.
func (s *TaskService) ParseAndPersistMentions(
	ctx context.Context,
	room db.Room,
	msg db.RoomMessage,
	mentionContentOverride string,
) error {
	source := msg.Content
	if strings.TrimSpace(mentionContentOverride) != "" {
		source = mentionContentOverride
	}
	structured := util.ParseMentions(source)
	plain, err := s.plainAgentMentionsInRoom(ctx, room, source)
	if err != nil {
		return err
	}
	mentions := append(structured, plain...)
	seen := make(map[string]struct{})
	for _, m := range mentions {
		if m.Type != "agent" && m.Type != "squad" && m.Type != "member" && m.Type != "all" {
			continue
		}
		key := m.Type + ":" + m.ID
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		targetID := parseMentionTargetID(m)
		if !targetID.Valid && m.Type != "all" {
			continue
		}
		_, err := s.Queries.CreateRoomMessageMention(ctx, db.CreateRoomMessageMentionParams{
			ID:         util.MustNewUUIDv7(),
			MessageID:  msg.ID,
			TargetType: m.Type,
			TargetID:   targetID,
		})
		if err != nil {
			slog.Warn("persist room mention failed", "message_id", util.UUIDToString(msg.ID), "error", err)
		}
	}
	return nil
}

// ProcessMessageForAssignments creates mention or auto_review assignments from a message.
func (s *TaskService) ProcessMessageForAssignments(
	ctx context.Context,
	p RoomMentionDispatchParams,
) (RoomGraphProcessResult, error) {
	mentionSource := p.Message.Content
	if strings.TrimSpace(p.MentionContent) != "" {
		mentionSource = p.MentionContent
	}
	mentions, err := s.collectRoomMentions(ctx, p.Room, mentionSource)
	if err != nil {
		return RoomGraphProcessResult{}, err
	}

	var agentMentions []util.Mention
	for _, m := range mentions {
		if m.Type == "agent" || m.Type == "squad" {
			agentMentions = append(agentMentions, m)
		}
	}

	timeout := p.DefaultTimeout
	if timeout <= 0 {
		timeout = 30 * time.Minute
	}

	var result RoomGraphProcessResult
	if len(agentMentions) > 0 {
		assignments, invocations, err := s.createMentionAssignments(ctx, p, agentMentions, timeout)
		if err != nil {
			return result, err
		}
		result.Assignments = assignments
		result.Invocations = invocations
	} else {
		assignments, invocations, err := s.maybeCreateManagerAutoReview(ctx, p, timeout)
		if err != nil {
			return result, err
		}
		result.Assignments = assignments
		result.Invocations = invocations
	}

	if len(result.Invocations) > 0 {
		s.RefreshRoomSnapshot(ctx, p.Room.ID)
		s.drainRoomGraphAgents(ctx, p.Room, result.Invocations)
	}
	return result, nil
}

func (s *TaskService) createMentionAssignments(
	ctx context.Context,
	p RoomMentionDispatchParams,
	mentions []util.Mention,
	timeout time.Duration,
) ([]db.RoomAssignment, []db.RoomInvocation, error) {
	var assignments []db.RoomAssignment
	var invocations []db.RoomInvocation
	timeoutAt := time.Now().Add(timeout)

	for _, m := range mentions {
		assigneeType := m.Type
		assigneeID := parseMentionTargetID(m)
		if !assigneeID.Valid {
			continue
		}
		assignment, inv, err := s.createAssignmentWithInvocation(ctx, createAssignmentParams{
			Room:           p.Room,
			SourceMessage:  p.Message,
			AssigneeType:   assigneeType,
			AssigneeID:     assigneeID,
			Kind:           "mention",
			CreatedByType:  p.AuthorType,
			CreatedByID:    parseOptionalActorID(p.AuthorID),
			Intent:         s.roomMentionIntent(p.Room),
			TimeoutAt:      timeoutAt,
			CanAccessAgent: p.CanAccessAgent,
			AuthorType:     p.AuthorType,
			AuthorID:       p.AuthorID,
			WorkspaceID:    p.WorkspaceID,
		})
		if err != nil {
			slog.Warn("create mention assignment failed", "error", err)
			continue
		}
		assignments = append(assignments, assignment)
		if inv.ID.Valid {
			invocations = append(invocations, inv)
		}
	}
	return assignments, invocations, nil
}

func (s *TaskService) maybeCreateManagerAutoReview(
	ctx context.Context,
	p RoomMentionDispatchParams,
	timeout time.Duration,
) ([]db.RoomAssignment, []db.RoomInvocation, error) {
	if !p.Room.ManagerAgentID.Valid {
		return nil, nil, nil
	}
	policy := ParseRoomPolicy(p.Room.Policy)
	if policy.Routing.Unmentioned != "manager" && policy.Routing.Unmentioned != "" {
		return nil, nil, nil
	}
	if p.AuthorType == "agent" && p.AuthorID == util.UUIDToString(p.Room.ManagerAgentID) {
		return nil, nil, nil
	}

	if _, err := s.Queries.GetRoomMember(ctx, db.GetRoomMemberParams{
		RoomID: p.Room.ID, PrincipalType: "agent", PrincipalID: p.Room.ManagerAgentID,
	}); err != nil {
		_, _ = s.Queries.AddRoomMember(ctx, db.AddRoomMemberParams{
			RoomID: p.Room.ID, PrincipalType: "agent", PrincipalID: p.Room.ManagerAgentID, Role: "manager",
		})
	}

	assignment, inv, err := s.createAssignmentWithInvocation(ctx, createAssignmentParams{
		Room:          p.Room,
		SourceMessage: p.Message,
		AssigneeType:  "agent",
		AssigneeID:    p.Room.ManagerAgentID,
		Kind:          "auto_review",
		CreatedByType: "system",
		Intent:        "review",
		TimeoutAt:     time.Now().Add(timeout),
		CanAccessAgent: func(_ context.Context, _ db.Agent, _, _, _ string) bool {
			return true
		},
		AuthorType:  p.AuthorType,
		AuthorID:    p.AuthorID,
		WorkspaceID: p.WorkspaceID,
	})
	if err != nil {
		return nil, nil, err
	}
	var assignments []db.RoomAssignment
	var invocations []db.RoomInvocation
	if assignment.ID.Valid {
		assignments = append(assignments, assignment)
	}
	if inv.ID.Valid {
		invocations = append(invocations, inv)
	}
	return assignments, invocations, nil
}

type createAssignmentParams struct {
	Room           db.Room
	SourceMessage  db.RoomMessage
	AssigneeType   string
	AssigneeID     pgtype.UUID
	Kind           string
	Status         string
	Reason         string
	CreatedByType  string
	CreatedByID    pgtype.UUID
	Intent         string
	TimeoutAt      time.Time
	CanAccessAgent PrivateAgentGate
	AuthorType     string
	AuthorID       string
	WorkspaceID    string
	Blocked                  bool
	RecoveryFailedAssignmentID pgtype.UUID
}

func parseOptionalActorID(id string) pgtype.UUID {
	if strings.TrimSpace(id) == "" {
		return pgtype.UUID{}
	}
	return parseUUID(id)
}

func (s *TaskService) createAssignmentWithInvocation(
	ctx context.Context,
	p createAssignmentParams,
) (db.RoomAssignment, db.RoomInvocation, error) {
	status := p.Status
	if status == "" {
		status = "pending"
	}
	if p.Blocked {
		status = "blocked"
	}

	assignment, err := s.Queries.CreateRoomAssignment(ctx, db.CreateRoomAssignmentParams{
		ID:              util.MustNewUUIDv7(),
		RoomID:          p.Room.ID,
		SourceMessageID: p.SourceMessage.ID,
		AssigneeType:    p.AssigneeType,
		AssigneeID:      p.AssigneeID,
		Kind:            p.Kind,
		Status:          status,
		Reason:          pgtype.Text{String: p.Reason, Valid: p.Reason != ""},
		CreatedByType:   p.CreatedByType,
		CreatedByID:     p.CreatedByID,
	})
	if err != nil {
		return db.RoomAssignment{}, db.RoomInvocation{}, err
	}
	s.publishRoomAssignmentUpdated(ctx, p.Room, assignment)
	s.appendInvocationEvent(ctx, p.Room, assignment, db.RoomInvocation{}, "assignment_created", "system", pgtype.UUID{}, map[string]any{
		"kind":   p.Kind,
		"status": status,
	})

	if status == "blocked" {
		s.recoverySupersedeForNewAssignment(ctx, p.Room, assignment, p.RecoveryFailedAssignmentID)
		return assignment, db.RoomInvocation{}, nil
	}

	inv, err := s.createInvocationForAssignment(ctx, p.Room, assignment, p.SourceMessage, p.Intent, p.TimeoutAt, p.CanAccessAgent, p.AuthorType, p.AuthorID, p.WorkspaceID)
	if err != nil {
		return assignment, db.RoomInvocation{}, err
	}
	s.recoverySupersedeForNewAssignment(ctx, p.Room, assignment, p.RecoveryFailedAssignmentID)
	return assignment, inv, nil
}

func (s *TaskService) createInvocationForAssignment(
	ctx context.Context,
	room db.Room,
	assignment db.RoomAssignment,
	sourceMessage db.RoomMessage,
	intent string,
	timeoutAt time.Time,
	canAccessAgent PrivateAgentGate,
	authorType, authorID, workspaceID string,
) (db.RoomInvocation, error) {
	agentID, _, err := s.ResolveRoomMentionAgent(ctx, room.WorkspaceID, util.Mention{
		Type: assignment.AssigneeType,
		ID:   util.UUIDToString(assignment.AssigneeID),
	})
	if err != nil {
		return db.RoomInvocation{}, err
	}
	agent, err := s.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
		ID: agentID, WorkspaceID: room.WorkspaceID,
	})
	if err != nil || !agent.RuntimeID.Valid || agent.ArchivedAt.Valid {
		return db.RoomInvocation{}, fmt.Errorf("agent not ready")
	}
	if canAccessAgent != nil && !canAccessAgent(ctx, agent, authorType, authorID, workspaceID) {
		return db.RoomInvocation{}, fmt.Errorf("agent access denied")
	}

	inv, err := s.Queries.CreateRoomInvocation(ctx, db.CreateRoomInvocationParams{
		ID:              util.MustNewUUIDv7(),
		RoomID:          room.ID,
		AssignmentID:    assignment.ID,
		SourceMessageID: sourceMessage.ID,
		AgentID:         agentID,
		Intent:          intent,
		Status:          "pending",
		MaxRetries:      1,
		TimeoutAt:       pgtype.Timestamptz{Time: timeoutAt, Valid: true},
	})
	if err != nil {
		return db.RoomInvocation{}, err
	}

	_, _ = s.Queries.UpdateRoomAssignmentStatus(ctx, db.UpdateRoomAssignmentStatusParams{
		ID: assignment.ID, Status: "running",
	})

	s.appendInvocationEvent(ctx, room, assignment, inv, "invocation_created", "system", pgtype.UUID{}, map[string]any{
		"intent": intent,
	})

	running, err := s.Queries.CountRunningRoomInvocationsForAgent(ctx, agentID)
	if err == nil && running >= 1 {
		inv, err = s.Queries.UpdateRoomInvocationStatus(ctx, db.UpdateRoomInvocationStatusParams{
			ID: inv.ID, Status: "queued",
		})
		if err == nil {
			s.appendInvocationEvent(ctx, room, assignment, inv, "invocation_queued", "system", pgtype.UUID{}, nil)
		}
		return inv, err
	}

	task, err := s.enqueueRoomGraphInvocationTask(ctx, room, sourceMessage, assignment, inv, agentID)
	if err != nil {
		_, _ = s.Queries.UpdateRoomInvocationStatus(ctx, db.UpdateRoomInvocationStatusParams{
			ID: inv.ID, Status: "failed",
			FailureReason: pgtype.Text{String: err.Error(), Valid: true},
		})
		return db.RoomInvocation{}, err
	}
	inv, _ = s.Queries.UpdateRoomInvocationStatus(ctx, db.UpdateRoomInvocationStatusParams{
		ID: inv.ID, Status: "queued", TaskID: task.ID,
	})
	s.appendInvocationEvent(ctx, room, assignment, inv, "invocation_queued", "system", pgtype.UUID{}, nil)
	return inv, nil
}

func (s *TaskService) enqueueRoomGraphInvocationTask(
	ctx context.Context,
	room db.Room,
	sourceMessage db.RoomMessage,
	assignment db.RoomAssignment,
	inv db.RoomInvocation,
	agentID pgtype.UUID,
) (db.AgentTaskQueue, error) {
	agent, err := s.Queries.GetAgent(ctx, agentID)
	if err != nil {
		return db.AgentTaskQueue{}, err
	}
	summary := truncateForSummary(sourceMessage.Content, triggerSummaryMaxLen)
	taskCtx := marshalRoomGraphContext(roomGraphTaskContext{
		AssignmentID: util.UUIDToString(assignment.ID),
		Intent:       inv.Intent,
		Kind:         assignment.Kind,
	})
	task, err := s.Queries.CreateRoomTaskForInvocation(ctx, db.CreateRoomTaskForInvocationParams{
		AgentID:        agentID,
		RuntimeID:      agent.RuntimeID,
		Priority:       2,
		RoomID:         room.ID,
		RoomMessageID:  sourceMessage.ID,
		InvocationID:   inv.ID,
		Context:        taskCtx,
		TriggerSummary: pgtype.Text{String: summary, Valid: summary != ""},
	})
	if err != nil {
		return db.AgentTaskQueue{}, err
	}
	s.broadcastTaskEvent(ctx, protocol.EventTaskQueued, task)
	s.NotifyTaskEnqueued(ctx, task)
	return task, nil
}

func (s *TaskService) drainRoomGraphAgents(ctx context.Context, room db.Room, invocations []db.RoomInvocation) {
	seen := make(map[string]struct{})
	for _, inv := range invocations {
		key := util.UUIDToString(inv.AgentID)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		s.DrainQueuedRoomInvocations(ctx, inv.AgentID)
	}
}

// BuildRoomGraphSnapshot loads the full collaboration graph for a room.
func (s *TaskService) BuildRoomGraphSnapshot(ctx context.Context, roomID pgtype.UUID) (RoomGraphSnapshot, error) {
	var snap RoomGraphSnapshot
	msgs, err := s.Queries.ListRoomMessages(ctx, db.ListRoomMessagesParams{
		RoomID: roomID, Limit: 500,
	})
	if err != nil {
		return snap, err
	}
	snap.Messages = msgs

	snap.Mentions, _ = s.Queries.ListRoomMessageMentionsByRoom(ctx, roomID)
	snap.Assignments, _ = s.Queries.ListRoomAssignmentsByRoom(ctx, roomID)
	snap.AssignmentDependencies, _ = s.Queries.ListRoomAssignmentDependenciesByRoom(ctx, roomID)
	snap.Invocations, _ = s.Queries.ListRoomInvocationsByRoom(ctx, roomID)
	snap.Decisions, _ = s.Queries.ListRoomManagerDecisionsByRoom(ctx, roomID)
	snap.InvocationEvents, _ = s.Queries.ListRoomInvocationEventsByRoom(ctx, db.ListRoomInvocationEventsByRoomParams{
		RoomID: roomID, Limit: 200,
	})
	return snap, nil
}

// RouteRoomMessage is the entry point for message routing (replaces old mention_invocation path).
func (s *TaskService) RouteRoomMessage(ctx context.Context, p RoomMentionDispatchParams) (RoomGraphProcessResult, error) {
	return s.ProcessRoomMessageAfterCreate(ctx, p)
}
