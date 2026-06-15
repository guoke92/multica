package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// RouteRoomMessage dispatches room messages: @mentions go direct; unmentioned
// messages route to the room manager when configured.
func (s *TaskService) RouteRoomMessage(ctx context.Context, p RoomMentionDispatchParams) ([]db.MentionInvocation, error) {
	mentionSource := p.Message.Content
	if strings.TrimSpace(p.MentionContent) != "" {
		mentionSource = p.MentionContent
	}
	mentions, err := s.collectRoomMentions(ctx, p.Room, mentionSource)
	if err != nil {
		return nil, err
	}

	var agentMentions []util.Mention
	for _, m := range mentions {
		if m.Type == "agent" || m.Type == "squad" {
			agentMentions = append(agentMentions, m)
		}
	}
	if len(agentMentions) > 0 {
		return s.DispatchRoomMentions(ctx, p)
	}

	if !p.Room.ManagerAgentID.Valid {
		return nil, nil
	}
	policy := ParseRoomPolicy(p.Room.Policy)
	if policy.Routing.Unmentioned != "manager" {
		return nil, nil
	}
	if p.AuthorType == "agent" && p.AuthorID == util.UUIDToString(p.Room.ManagerAgentID) {
		return nil, nil
	}

	// Auto-backfill: ensure the manager is a room member (covers rooms
	// created before the CreateRoom fix that adds the manager on creation).
	if _, err := s.Queries.GetRoomMember(ctx, db.GetRoomMemberParams{
		RoomID:        p.Room.ID,
		PrincipalType: "agent",
		PrincipalID:   p.Room.ManagerAgentID,
	}); err != nil {
		_, _ = s.Queries.AddRoomMember(ctx, db.AddRoomMemberParams{
			RoomID:        p.Room.ID,
			PrincipalType: "agent",
			PrincipalID:   p.Room.ManagerAgentID,
			Role:          "manager",
		})
	}

	if policy.Routing.ManagerAgentMustBeMember {
		if _, err := s.Queries.GetRoomMember(ctx, db.GetRoomMemberParams{
			RoomID:        p.Room.ID,
			PrincipalType: "agent",
			PrincipalID:   p.Room.ManagerAgentID,
		}); err != nil {
			return nil, fmt.Errorf("manager agent is not a room member")
		}
	}

	maxDepth := p.MaxChainDepth
	if maxDepth <= 0 {
		maxDepth = 5
	}
	timeout := p.DefaultTimeout
	if timeout <= 0 {
		timeout = 5 * time.Minute
	}
	timeoutAt := time.Now().Add(timeout)

	var deliveryID, topicID pgtype.UUID
	if active, ok := s.resolveActiveRoomTopicContext(ctx, p.Room.ID); ok {
		topicID = active.Topic.ID
		deliveryID = active.DeliveryID
	}

	inv, err := s.dispatchRoomWorkflowInvocation(ctx, dispatchWorkflowInvocationParams{
		Room:           p.Room,
		Message:        p.Message,
		AgentID:        p.Room.ManagerAgentID,
		Intent:         "route",
		MaxDepth:       maxDepth,
		TimeoutAt:      timeoutAt,
		ParentInvocationID: p.ParentInvocationID,
		DeliveryID:     deliveryID,
		TopicID:        topicID,
		CanAccessAgent: p.CanAccessAgent,
		AuthorType:     p.AuthorType,
		AuthorID:       p.AuthorID,
		WorkspaceID:    p.WorkspaceID,
	})
	if err != nil {
		return nil, err
	}
	if inv.ID.Valid {
		s.RefreshRoomSnapshot(ctx, p.Room.ID)
		s.drainRoomDispatchAgents(ctx, p.Room, []db.MentionInvocation{inv})
		return []db.MentionInvocation{inv}, nil
	}
	return nil, nil
}

type dispatchWorkflowInvocationParams struct {
	Room               db.Room
	Message            db.RoomMessage
	AgentID            pgtype.UUID
	Intent             string
	RoleKey            string
	PhaseKey           string
	MaxDepth           int
	TimeoutAt          time.Time
	ParentInvocationID pgtype.UUID
	DeliveryID         pgtype.UUID
	TopicID            pgtype.UUID
	CanAccessAgent     PrivateAgentGate
	AuthorType         string
	AuthorID           string
	WorkspaceID        string
	OnFailure          string
}

func (s *TaskService) dispatchRoomWorkflowInvocation(
	ctx context.Context,
	p dispatchWorkflowInvocationParams,
) (db.MentionInvocation, error) {
	agent, err := s.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
		ID:          p.AgentID,
		WorkspaceID: p.Room.WorkspaceID,
	})
	if err != nil || !agent.RuntimeID.Valid || agent.ArchivedAt.Valid {
		return db.MentionInvocation{}, fmt.Errorf("agent not ready")
	}
	if p.CanAccessAgent != nil && !p.CanAccessAgent(ctx, agent, p.AuthorType, p.AuthorID, p.WorkspaceID) {
		return db.MentionInvocation{}, fmt.Errorf("agent access denied")
	}

	status := "pending"
	chainDepth, parentInv := s.resolveRoomMentionChain(ctx, p.Message.QuoteMessageID, p.ParentInvocationID)
	if p.MaxDepth > 0 && int(chainDepth) >= p.MaxDepth {
		status = "paused"
	}

	inv, err := s.Queries.CreateMentionInvocationExtended(ctx, db.CreateMentionInvocationExtendedParams{
		RoomID:             p.Room.ID,
		MessageID:          p.Message.ID,
		TargetType:         "agent",
		TargetID:           p.AgentID,
		Intent:             p.Intent,
		Status:             status,
		Priority:           "normal",
		MaxRetries:         1,
		ChainDepth:         chainDepth,
		ParentInvocationID: parentInv,
		TimeoutAt:          pgtype.Timestamptz{Time: p.TimeoutAt, Valid: true},
		DeliveryID:         p.DeliveryID,
		TopicID:            p.TopicID,
	})
	if err != nil {
		return db.MentionInvocation{}, err
	}
	if status == "paused" {
		return inv, nil
	}
	s.MaybeRecordInvocationStatusFlowEvent(ctx, p.Room, inv, "pending")

	running, err := s.Queries.CountRunningInvocationsForAgent(ctx, p.AgentID)
	if err == nil && running >= 1 {
		inv, err = s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
			ID:     inv.ID,
			Status: "queued",
		})
		if err == nil {
			s.MaybeRecordInvocationStatusFlowEvent(ctx, p.Room, inv, "queued")
		}
		return inv, err
	}

	task, err := s.EnqueueRoomInvocationTask(ctx, EnqueueRoomInvocationParams{
		Room:       p.Room,
		Message:    p.Message,
		Invocation: inv,
		AgentID:    p.AgentID,
		RoleKey:    p.RoleKey,
		PhaseKey:   p.PhaseKey,
		OnFailure:  p.OnFailure,
	})
	if err != nil {
		_, _ = s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
			ID:            inv.ID,
			Status:        "failed",
			FailureReason: pgtype.Text{String: err.Error(), Valid: true},
		})
		return db.MentionInvocation{}, err
	}

	now := time.Now()
	inv, err = s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
		ID:          inv.ID,
		Status:      "queued",
		TaskID:      task.ID,
		DeliveredAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err == nil {
		s.MaybeRecordInvocationStatusFlowEvent(ctx, p.Room, inv, "queued")
	}
	return inv, err
}

func (s *TaskService) roomMentionIntent(room db.Room) string {
	if !room.ManagerAgentID.Valid {
		return "ask"
	}
	policy := ParseRoomPolicy(room.Policy)
	if policy.Routing.ExplicitAgentMention == "direct" {
		return "execute"
	}
	return "ask"
}
