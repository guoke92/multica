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

// PrivateAgentGate checks whether an actor may trigger a private agent.
type PrivateAgentGate func(ctx context.Context, agent db.Agent, authorType, authorID, workspaceID string) bool

// RoomMentionDispatchParams bundles inputs for processing @mentions on a room message.
type RoomMentionDispatchParams struct {
	Room           db.Room
	Message        db.RoomMessage
	AuthorType     string
	AuthorID       string
	WorkspaceID    string
	CanAccessAgent PrivateAgentGate
	MaxChainDepth  int
	DefaultTimeout time.Duration
	// ParentInvocationID links agent-to-agent chains (reply @delegation).
	ParentInvocationID pgtype.UUID
	// MentionContent overrides Message.Content when parsing mentions (e.g. full
	// agent body while the stored room_message may be truncated).
	MentionContent string
}

// DispatchRoomMentions parses mentions, creates invocations, and enqueues agent work.
func (s *TaskService) DispatchRoomMentions(ctx context.Context, p RoomMentionDispatchParams) ([]db.MentionInvocation, error) {
	mentionSource := p.Message.Content
	if strings.TrimSpace(p.MentionContent) != "" {
		mentionSource = p.MentionContent
	}
	mentions, err := s.collectRoomMentions(ctx, p.Room, mentionSource)
	if err != nil {
		return nil, err
	}
	if len(mentions) == 0 {
		return nil, nil
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

	var created []db.MentionInvocation
	for _, m := range mentions {
		switch m.Type {
		case "agent", "squad":
			inv, err := s.dispatchRoomAgentMention(ctx, p, m, maxDepth, timeoutAt)
			if err != nil {
				slog.Warn("room mention dispatch failed",
					"room_id", util.UUIDToString(p.Room.ID),
					"mention_type", m.Type,
					"mention_id", m.ID,
					"error", err,
				)
				continue
			}
			created = append(created, inv)
		case "member", "issue", "all":
			// MVP: member/all/issue mentions do not create invocations or tasks.
			continue
		}
	}
	if len(created) > 0 {
		s.RefreshRoomSnapshot(ctx, p.Room.ID)
		s.drainRoomDispatchAgents(ctx, p.Room, created)
	}
	return created, nil
}

func (s *TaskService) drainRoomDispatchAgents(ctx context.Context, room db.Room, invocations []db.MentionInvocation) {
	seen := make(map[string]struct{})
	for _, inv := range invocations {
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

func (s *TaskService) dispatchRoomAgentMention(
	ctx context.Context,
	p RoomMentionDispatchParams,
	m util.Mention,
	maxDepth int,
	timeoutAt time.Time,
) (db.MentionInvocation, error) {
	agentID, isLeader, err := s.ResolveRoomMentionAgent(ctx, p.Room.WorkspaceID, m)
	if err != nil {
		return db.MentionInvocation{}, err
	}
	agent, err := s.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
		ID:          agentID,
		WorkspaceID: p.Room.WorkspaceID,
	})
	if err != nil || !agent.RuntimeID.Valid || agent.ArchivedAt.Valid {
		return db.MentionInvocation{}, fmt.Errorf("agent not ready")
	}
	memberType := "agent"
	memberID := agentID
	if m.Type == "squad" {
		memberType = "squad"
		memberID = parseMentionTargetID(m)
	}
	if _, err := s.Queries.GetRoomMember(ctx, db.GetRoomMemberParams{
		RoomID:        p.Room.ID,
		PrincipalType: memberType,
		PrincipalID:   memberID,
	}); err != nil {
		return db.MentionInvocation{}, fmt.Errorf("mention target is not a room member")
	}
	if p.CanAccessAgent != nil && !p.CanAccessAgent(ctx, agent, p.AuthorType, p.AuthorID, p.WorkspaceID) {
		return db.MentionInvocation{}, fmt.Errorf("agent access denied")
	}
	if p.AuthorType == "agent" && p.AuthorID != "" && m.Type == "agent" && m.ID == p.AuthorID {
		return db.MentionInvocation{}, fmt.Errorf("self-mention skipped")
	}

	status := "pending"
	chainDepth, parentInv := s.resolveRoomMentionChain(ctx, p.Message.QuoteMessageID, p.ParentInvocationID)
	if maxDepth > 0 && int(chainDepth) >= maxDepth {
		status = "paused"
	}

	intent := s.roomMentionIntent(p.Room)
	inv, err := s.Queries.CreateMentionInvocation(ctx, db.CreateMentionInvocationParams{
		RoomID:             p.Room.ID,
		MessageID:          p.Message.ID,
		TargetType:         m.Type,
		TargetID:           parseMentionTargetID(m),
		Intent:             intent,
		Status:             status,
		Priority:           "normal",
		MaxRetries:         1,
		ChainDepth:         chainDepth,
		ParentInvocationID: parentInv,
		TimeoutAt:          pgtype.Timestamptz{Time: timeoutAt, Valid: true},
	})
	if err != nil {
		return db.MentionInvocation{}, err
	}
	if status == "paused" {
		s.maybeEscalateManagerOnChainDepth(ctx, p.Room, inv)
		return inv, nil
	}
	s.MaybeRecordInvocationStatusFlowEvent(ctx, p.Room, inv, "pending")

	running, err := s.Queries.CountRunningInvocationsForAgent(ctx, agentID)
	if err == nil && running >= 1 {
		inv, err = s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
			ID:     inv.ID,
			Status: "queued",
		})
		if err != nil {
			return db.MentionInvocation{}, err
		}
		s.MaybeRecordInvocationStatusFlowEvent(ctx, p.Room, inv, "queued")
		return inv, nil
	}

	task, err := s.EnqueueRoomInvocationTask(ctx, EnqueueRoomInvocationParams{
		Room:        p.Room,
		Message:     p.Message,
		Invocation:  inv,
		AgentID:     agentID,
		IsLeader:    isLeader,
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

// ResolveRoomMentionAgent maps a mention to the agent that should run the task.
func (s *TaskService) ResolveRoomMentionAgent(ctx context.Context, workspaceID pgtype.UUID, m util.Mention) (pgtype.UUID, bool, error) {
	if m.Type == "squad" {
		squad, err := s.Queries.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{
			ID:          parseUUID(m.ID),
			WorkspaceID: workspaceID,
		})
		if err != nil {
			return pgtype.UUID{}, false, err
		}
		return squad.LeaderID, true, nil
	}
	return parseUUID(m.ID), false, nil
}

func (s *TaskService) maybeEscalateManagerOnChainDepth(ctx context.Context, room db.Room, inv db.MentionInvocation) {
	policy := ParseRoomPolicy(room.Policy)
	if policy.Routing.OnChainDepthLimit != "escalate_manager" || !room.ManagerAgentID.Valid {
		return
	}
	s.enqueueManagerReview(ctx, room, inv)
}

func parseMentionTargetID(m util.Mention) pgtype.UUID {
	if m.Type == "all" {
		return pgtype.UUID{}
	}
	return parseUUID(m.ID)
}

func (s *TaskService) resolveRoomMentionChain(
	ctx context.Context,
	quoteMessageID pgtype.UUID,
	parentInvocationID pgtype.UUID,
) (int32, pgtype.UUID) {
	if parentInvocationID.Valid {
		parent, err := s.Queries.GetMentionInvocation(ctx, parentInvocationID)
		if err == nil {
			return parent.ChainDepth + 1, parent.ID
		}
	}
	if !quoteMessageID.Valid {
		return 0, pgtype.UUID{}
	}
	parent, err := s.Queries.GetLatestInvocationForMessage(ctx, quoteMessageID)
	if err != nil {
		return 0, pgtype.UUID{}
	}
	return parent.ChainDepth + 1, parent.ID
}

func parseUUID(s string) pgtype.UUID {
	u, err := util.ParseUUID(s)
	if err != nil {
		return pgtype.UUID{}
	}
	return u
}

// EnqueueRoomInvocationParams identifies a room @mention task.
type EnqueueRoomInvocationParams struct {
	Room       db.Room
	Message    db.RoomMessage
	Invocation db.MentionInvocation
	AgentID    pgtype.UUID
	IsLeader   bool
	RoleKey    string
	PhaseKey   string
	OnFailure  string
}

// EnqueueRoomInvocationTask creates an agent_task_queue row for a room invocation.
func (s *TaskService) EnqueueRoomInvocationTask(ctx context.Context, p EnqueueRoomInvocationParams) (db.AgentTaskQueue, error) {
	agent, err := s.Queries.GetAgent(ctx, p.AgentID)
	if err != nil {
		return db.AgentTaskQueue{}, fmt.Errorf("load agent: %w", err)
	}
	if agent.ArchivedAt.Valid {
		return db.AgentTaskQueue{}, fmt.Errorf("agent is archived")
	}
	if !agent.RuntimeID.Valid {
		return db.AgentTaskQueue{}, fmt.Errorf("agent has no runtime")
	}

	summary := truncateForSummary(p.Message.Content, triggerSummaryMaxLen)
	var task db.AgentTaskQueue
	wfCtx := RoomWorkflowContext{
		Intent: p.Invocation.Intent,
	}
	if p.Invocation.TopicID.Valid {
		wfCtx.TopicID = util.UUIDToString(p.Invocation.TopicID)
	} else if p.Message.TopicID.Valid {
		wfCtx.TopicID = util.UUIDToString(p.Message.TopicID)
	}
	// Topic-first daemon context: new tasks expose topic_id only.
	if wfCtx.TopicID != "" {
		wfCtx.DeliveryID = ""
	} else if p.Invocation.DeliveryID.Valid {
		wfCtx.DeliveryID = util.UUIDToString(p.Invocation.DeliveryID)
	}
	if p.RoleKey != "" {
		wfCtx.RoleKey = p.RoleKey
	}
	if p.PhaseKey != "" {
		wfCtx.PhaseKey = p.PhaseKey
	}
	if p.OnFailure != "" {
		wfCtx.OnFailure = p.OnFailure
	}
	if p.Invocation.Intent != "ask" || wfCtx.DeliveryID != "" {
		task, err = s.Queries.CreateRoomTaskWithContext(ctx, db.CreateRoomTaskWithContextParams{
			AgentID:        p.AgentID,
			RuntimeID:      agent.RuntimeID,
			Priority:       2,
			RoomID:         p.Room.ID,
			RoomMessageID:  p.Message.ID,
			InvocationID:   p.Invocation.ID,
			Context:        marshalRoomWorkflowContext(wfCtx),
			TriggerSummary: pgtype.Text{String: summary, Valid: summary != ""},
		})
	} else {
		task, err = s.Queries.CreateRoomTask(ctx, db.CreateRoomTaskParams{
			AgentID:       p.AgentID,
			RuntimeID:     agent.RuntimeID,
			Priority:      2,
			RoomID:        p.Room.ID,
			RoomMessageID: p.Message.ID,
			InvocationID:  p.Invocation.ID,
		})
	}
	if err != nil {
		return db.AgentTaskQueue{}, fmt.Errorf("create room task: %w", err)
	}

	slog.Info("room invocation task enqueued",
		"task_id", util.UUIDToString(task.ID),
		"room_id", util.UUIDToString(p.Room.ID),
		"invocation_id", util.UUIDToString(p.Invocation.ID),
	)
	s.broadcastTaskEvent(ctx, protocol.EventTaskQueued, task)
	s.NotifyTaskEnqueued(ctx, task)
	return task, nil
}

// RefreshRoomSnapshot recomputes active invocation counts and topic summaries on the room.
func (s *TaskService) RefreshRoomSnapshot(ctx context.Context, roomID pgtype.UUID) {
	counts, err := s.Queries.CountInvocationStatusByRoom(ctx, roomID)
	if err != nil {
		return
	}
	room, roomErr := s.Queries.GetRoom(ctx, roomID)
	var snap []byte
	if roomErr == nil {
		s.repairRoomTopicsIfEmpty(ctx, room)
		snap = s.buildRoomSnapshotJSON(ctx, room, counts)
	} else {
		snap = jsonMarshalRoomSnapshot(counts)
	}
	_ = s.Queries.UpdateRoomSnapshot(ctx, db.UpdateRoomSnapshotParams{
		ID:       roomID,
		Snapshot: snap,
	})
	if roomErr == nil {
		room.Snapshot = snap
		s.publishRoomSnapshotUpdated(ctx, room)
	}
}

func jsonMarshalRoomSnapshot(c db.CountInvocationStatusByRoomRow) []byte {
	payload := map[string]int{
		"pending_count":   int(c.PendingCount),
		"queued_count":    int(c.QueuedCount),
		"running_count":   int(c.RunningCount),
		"failed_count":    int(c.FailedCount),
		"timed_out_count": int(c.TimedOutCount),
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return []byte("{}")
	}
	return b
}

func mergeSnapshotPreserveProgress(existing []byte, counts db.CountInvocationStatusByRoomRow) []byte {
	base := map[string]any{}
	if len(existing) > 0 {
		_ = json.Unmarshal(existing, &base)
	}
	base["pending_count"] = int(counts.PendingCount)
	base["queued_count"] = int(counts.QueuedCount)
	base["running_count"] = int(counts.RunningCount)
	base["failed_count"] = int(counts.FailedCount)
	base["timed_out_count"] = int(counts.TimedOutCount)
	b, err := json.Marshal(base)
	if err != nil {
		return jsonMarshalRoomSnapshot(counts)
	}
	return b
}
