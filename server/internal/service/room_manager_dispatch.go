package service

import (
	"context"
	"log/slog"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/redact"
)

func managerDispatchAction(kind string, decision ManagerDecision) string {
	switch kind {
	case "manager_route":
		return "route_to"
	case "manager_relay":
		return "relay_to"
	case "reassign":
		return "escalate"
	default:
		return "assign"
	}
}

func formatAgentMentionLink(agentName, agentID string) string {
	name := strings.TrimSpace(agentName)
	if name == "" {
		name = "Agent"
	}
	if !strings.HasPrefix(name, "@") {
		name = "@" + name
	}
	return fmt.Sprintf("[%s](mention://agent/%s)", name, agentID)
}

func (s *TaskService) postManagerDispatchMessage(
	ctx context.Context,
	room db.Room,
	decisionRecord db.RoomManagerDecision,
	assignment db.RoomAssignment,
	targetAgentID pgtype.UUID,
	sourceMsg db.RoomMessage,
	action, reason string,
) error {
	if !room.ManagerAgentID.Valid || !targetAgentID.Valid {
		return nil
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil
	}

	agentName := "Agent"
	if agent, err := s.Queries.GetAgent(ctx, targetAgentID); err == nil {
		if trimmed := strings.TrimSpace(agent.Name); trimmed != "" {
			agentName = trimmed
		}
	}

	var body string
	switch action {
	case "route_to":
		body = fmt.Sprintf("%s 请处理：%s", formatAgentMentionLink(agentName, util.UUIDToString(targetAgentID)), reason)
	case "relay_to":
		body = fmt.Sprintf("%s 请继续：%s", formatAgentMentionLink(agentName, util.UUIDToString(targetAgentID)), reason)
	default:
		body = fmt.Sprintf("%s %s", formatAgentMentionLink(agentName, util.UUIDToString(targetAgentID)), reason)
	}

	quoteID := sourceMsg.ID
	if sourceMsg.SenderType == "agent" && sourceMsg.QuoteMessageID.Valid {
		quoteID = sourceMsg.QuoteMessageID
	}

	meta, _ := json.Marshal(map[string]any{
		"manager_dispatch": true,
		"decision_id":      util.UUIDToString(decisionRecord.ID),
		"assignment_id":    util.UUIDToString(assignment.ID),
		"action":           action,
		"target_agent_id":  util.UUIDToString(targetAgentID),
		"reason":           reason,
	})

	msg, err := s.Queries.CreateRoomMessage(ctx, db.CreateRoomMessageParams{
		ID:             util.MustNewUUIDv7(),
		RoomID:         room.ID,
		SenderType:     "agent",
		SenderID:       room.ManagerAgentID,
		Content:        redact.Text(body),
		QuoteMessageID: quoteID,
		Metadata:       meta,
	})
	if err != nil {
		return err
	}
	mentions, err := s.ParseAndPersistMentions(ctx, room, msg, body)
	if err != nil {
		slog.Warn("parse manager dispatch mentions failed", "message_id", util.UUIDToString(msg.ID), "error", err)
	}
	for _, m := range mentions {
		if m.AssignmentID.Valid {
			continue
		}
		if m.TargetID != assignment.AssigneeID {
			continue
		}
		_, _ = s.Queries.UpdateRoomMessageMentionAssignment(ctx, db.UpdateRoomMessageMentionAssignmentParams{
			ID:           m.ID,
			AssignmentID: assignment.ID,
		})
	}
	s.publishRoomMessage(ctx, room, msg, db.AgentTaskQueue{})
	return nil
}

func (s *TaskService) shouldBlockManagerRelay(
	ctx context.Context,
	room db.Room,
	sourceMsg db.RoomMessage,
	targetAgent pgtype.UUID,
	reason string,
) (bool, string) {
	if sourceMsg.SenderType == "agent" && sourceMsg.SenderID.Valid &&
		sourceMsg.SenderID.Bytes == targetAgent.Bytes {
		return true, "cannot relay to the same agent who just completed"
	}

	normReason := strings.ToLower(strings.TrimSpace(reason))
	assignments, err := s.Queries.ListRoomAssignmentsBySourceMessage(ctx, sourceMsg.ID)
	if err != nil {
		return false, ""
	}
	for _, a := range assignments {
		if a.Kind != "manager_relay" {
			continue
		}
		if a.Status == "cancelled" || a.Status == "failed" {
			continue
		}
		if !a.AssigneeID.Valid || a.AssigneeID.Bytes != targetAgent.Bytes {
			continue
		}
		if !a.Reason.Valid {
			continue
		}
		if strings.ToLower(strings.TrimSpace(a.Reason.String)) == normReason {
			return true, "duplicate relay with same reason"
		}
	}
	return false, ""
}

func (s *TaskService) exceedsAgentChainDepth(
	ctx context.Context,
	room db.Room,
	outputMsg db.RoomMessage,
) bool {
	msgs, err := s.Queries.ListRoomMessages(ctx, db.ListRoomMessagesParams{
		RoomID: room.ID,
		Limit:  roomContextRecentLimit,
	})
	if err != nil {
		return false
	}
	byID := make(map[string]db.RoomMessage, len(msgs))
	for _, m := range msgs {
		byID[util.UUIDToString(m.ID)] = m
	}
	hops := CountAgentHopsSinceUserRoot(outputMsg, byID)
	return hops >= RoomMaxChainDepth(room)
}
