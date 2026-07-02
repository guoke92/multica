package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/redact"
)

// ManagerDecision is the structured decision a manager agent emits.
type ManagerDecision struct {
	Action   string `json:"action"`
	RouteTo  string `json:"route_to,omitempty"`
	RelayTo  string `json:"relay_to,omitempty"`
	AgentID  string `json:"agent_id,omitempty"`
	Message  string `json:"message,omitempty"`
	Reason   string `json:"reason,omitempty"`
	Retry    bool   `json:"retry,omitempty"`
	Reassign string `json:"reassign_to,omitempty"`
}

// WorkflowAction is the legacy structured footer managers may still emit.
type WorkflowAction struct {
	Action         string   `json:"action"`
	Title          string   `json:"title,omitempty"`
	AgentID        string   `json:"agent_id,omitempty"`
	AgentIDs       []string `json:"agent_ids,omitempty"`
	RouteTo        string   `json:"route_to,omitempty"`
	RelayTo        string   `json:"relay_to,omitempty"`
	RelayReason    string   `json:"relay_reason,omitempty"`
	EscalateTo     string   `json:"escalate_to,omitempty"`
	EscalateReason string   `json:"escalate_reason,omitempty"`
	Message        string   `json:"message,omitempty"`
}

type managerDecisionEnvelope struct {
	WorkflowAction WorkflowAction  `json:"workflow_action"`
	ManagerAction  ManagerDecision `json:"manager_action"`
}

func parseManagerDecisionFromOutput(output string) (ManagerDecision, bool) {
	output = strings.TrimSpace(output)
	if output == "" {
		return ManagerDecision{}, false
	}

	var env managerDecisionEnvelope
	for _, chunk := range extractJSONChunks(output) {
		if err := json.Unmarshal([]byte(chunk), &env); err != nil {
			continue
		}
		if env.ManagerAction.Action != "" {
			return env.ManagerAction, true
		}
		if wa := env.WorkflowAction; wa.Action != "" {
			return workflowActionToDecision(wa), true
		}
	}
	return ManagerDecision{}, false
}

func workflowActionToDecision(wa WorkflowAction) ManagerDecision {
	switch wa.Action {
	case "route_to":
		id := wa.RouteTo
		if id == "" {
			id = wa.AgentID
		}
		return ManagerDecision{Action: "assign", RouteTo: id, Reason: wa.Title}
	case "relay_to":
		id := wa.RelayTo
		if id == "" {
			id = wa.AgentID
		}
		return ManagerDecision{Action: "assign", RelayTo: id, Reason: wa.RelayReason}
	case "notify_user", "complete_delivery", "done":
		return ManagerDecision{Action: "complete", Message: wa.Message}
	case "escalate":
		id := wa.EscalateTo
		if id == "" {
			id = wa.AgentID
		}
		return ManagerDecision{Action: "reassign", Reassign: id, Reason: wa.EscalateReason}
	case "dispatch_agent":
		id := wa.AgentID
		if id == "" && len(wa.AgentIDs) > 0 {
			id = wa.AgentIDs[0]
		}
		return ManagerDecision{Action: "assign", RouteTo: id, Reason: wa.Title}
	default:
		return ManagerDecision{Action: "wait", Message: wa.Message}
	}
}

func extractJSONChunks(output string) []string {
	var chunks []string
	if err := json.Unmarshal([]byte(output), &map[string]any{}); err == nil {
		chunks = append(chunks, output)
	}
	for _, marker := range []string{"```json", "```"} {
		idx := strings.LastIndex(output, marker)
		if idx < 0 {
			continue
		}
		rest := output[idx+len(marker):]
		if end := strings.Index(rest, "```"); end > 0 {
			chunks = append(chunks, strings.TrimSpace(rest[:end]))
		}
	}
	if idx := strings.LastIndex(output, "{"); idx >= 0 {
		chunks = append(chunks, output[idx:])
	}
	re := regexp.MustCompile(`\{\s*"(workflow_action|manager_action)"\s*:\s*\{[^}]+\}\s*\}`)
	for _, m := range re.FindAllString(output, -1) {
		chunks = append(chunks, m)
	}
	return chunks
}

// ApplyManagerDecisionFromOutput parses and applies a manager agent's structured decision.
func (s *TaskService) ApplyManagerDecisionFromOutput(
	ctx context.Context,
	room db.Room,
	inv db.RoomInvocation,
	assignment db.RoomAssignment,
	output string,
) error {
	decision, found := parseManagerDecisionFromOutput(output)
	if !found {
		slog.Warn("manager decision parse failed", "room_id", util.UUIDToString(room.ID))
		return s.FailAssignment(ctx, room, assignment, "manager decision parse failed")
	}
	if err := s.ApplyManagerDecision(ctx, room, inv, assignment, decision); err != nil {
		return err
	}
	if decision.Action == "complete" || decision.Action == "ask_user" {
		if err := s.postManagerUserNotifyMessage(ctx, room, assignment, output, decision); err != nil {
			slog.Warn("post manager notify_user message failed",
				"room_id", util.UUIDToString(room.ID),
				"error", err,
			)
		}
	}
	return nil
}

func stripManagerWorkflowFooter(output string) string {
	s := strings.TrimSpace(output)
	for {
		end := strings.LastIndex(s, "```")
		if end < 0 {
			break
		}
		start := strings.LastIndex(s[:end], "```")
		if start < 0 {
			break
		}
		s = strings.TrimSpace(s[:start])
	}
	if idx := strings.LastIndex(s, "{"); idx >= 0 {
		tail := strings.TrimSpace(s[idx:])
		if json.Valid([]byte(tail)) {
			var env managerDecisionEnvelope
			if json.Unmarshal([]byte(tail), &env) == nil &&
				(env.WorkflowAction.Action != "" || env.ManagerAction.Action != "") {
				s = strings.TrimSpace(s[:idx])
			}
		}
	}
	return strings.TrimSpace(s)
}

func managerUserNotifyContent(output string, decision ManagerDecision) string {
	if prose := stripManagerWorkflowFooter(output); prose != "" {
		return prose
	}
	return strings.TrimSpace(decision.Message)
}

func formatMemberMentionLink(displayName, memberID string) string {
	name := strings.TrimSpace(displayName)
	if name == "" {
		name = "你"
	}
	return fmt.Sprintf("[@%s](mention://member/%s)", name, memberID)
}

func (s *TaskService) postManagerUserNotifyMessage(
	ctx context.Context,
	room db.Room,
	assignment db.RoomAssignment,
	output string,
	decision ManagerDecision,
) error {
	if !room.ManagerAgentID.Valid {
		return nil
	}
	body := managerUserNotifyContent(output, decision)
	if body == "" {
		body = "当前阶段已完成，如需继续请直接回复。"
	}

	sourceMsg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: assignment.SourceMessageID, RoomID: room.ID,
	})
	if err != nil {
		return err
	}

	if sourceMsg.SenderType == "user" && sourceMsg.SenderID.Valid && !strings.Contains(body, "mention://member/") {
		userID := util.UUIDToString(sourceMsg.SenderID)
		name := "你"
		if user, uErr := s.Queries.GetUser(ctx, sourceMsg.SenderID); uErr == nil {
			if trimmed := strings.TrimSpace(user.Name); trimmed != "" {
				name = trimmed
			}
		}
		body = formatMemberMentionLink(name, userID) + " " + body
	}

	notifyMeta, _ := json.Marshal(map[string]any{
		"manager_notify_user": true,
	})

	msg, err := s.Queries.CreateRoomMessage(ctx, db.CreateRoomMessageParams{
		ID:             util.MustNewUUIDv7(),
		RoomID:         room.ID,
		SenderType:     "agent",
		SenderID:       room.ManagerAgentID,
		Content:        redact.Text(body),
		QuoteMessageID: sourceMsg.ID,
		Metadata:       notifyMeta,
	})
	if err != nil {
		return err
	}
	_, _ = s.ParseAndPersistMentions(ctx, room, msg, "")
	s.publishRoomMessage(ctx, room, msg, db.AgentTaskQueue{})
	s.RefreshRoomSnapshot(ctx, room.ID)
	return nil
}

// ApplyManagerDecision records the decision and creates downstream assignments.
func (s *TaskService) ApplyManagerDecision(
	ctx context.Context,
	room db.Room,
	inv db.RoomInvocation,
	assignment db.RoomAssignment,
	decision ManagerDecision,
) error {
	payload, _ := json.Marshal(decision)
	record, err := s.Queries.CreateRoomManagerDecision(ctx, db.CreateRoomManagerDecisionParams{
		ID:              util.MustNewUUIDv7(),
		RoomID:          room.ID,
		SourceMessageID: assignment.SourceMessageID,
		InvocationID:    inv.ID,
		Action:          decision.Action,
		Payload:         payload,
		CreatedByType:   "agent",
		CreatedByID:     room.ManagerAgentID,
	})
	if err != nil {
		return err
	}
	s.publishRoomManagerDecisionCreated(ctx, room, record)
	var createdAssignmentIDs []pgtype.UUID

	sourceMsg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: assignment.SourceMessageID, RoomID: room.ID,
	})
	if err != nil {
		return err
	}

	switch decision.Action {
	case "assign":
		targetID := decision.RouteTo
		kind := "manager_route"
		if decision.RelayTo != "" {
			targetID = decision.RelayTo
			kind = "manager_relay"
		}
		if targetID == "" {
			targetID = decision.AgentID
		}
		agentUUID := parseUUID(targetID)
		if !agentUUID.Valid {
			return s.FailAssignment(ctx, room, assignment, "invalid assign target")
		}
		if kind == "manager_relay" {
			if blocked, blockReason := s.shouldBlockManagerRelay(ctx, room, sourceMsg, agentUUID, decision.Reason); blocked {
				return s.FailAssignment(ctx, room, assignment, blockReason)
			}
		}
		a, newInv, err := s.createAssignmentWithInvocation(ctx, createAssignmentParams{
			Room: room, SourceMessage: sourceMsg,
			AssigneeType: "agent", AssigneeID: agentUUID, Kind: kind,
			Reason: decision.Reason, CreatedByType: "agent", CreatedByID: room.ManagerAgentID,
			Intent: "execute", TimeoutAt: time.Now().Add(30 * time.Minute),
			CanAccessAgent: func(_ context.Context, _ db.Agent, _, _, _ string) bool { return true },
			AuthorType:     "agent", AuthorID: util.UUIDToString(room.ManagerAgentID),
			WorkspaceID: util.UUIDToString(room.WorkspaceID),
		})
		if err != nil {
			return err
		}
		createdAssignmentIDs = append(createdAssignmentIDs, a.ID)
		if err := s.postManagerDispatchMessage(ctx, room, record, a, agentUUID, sourceMsg, managerDispatchAction(kind, decision), decision.Reason); err != nil {
			slog.Warn("post manager dispatch message failed", "error", err)
		}
		s.recoverySupersedeForNewAssignment(ctx, room, a, parseEscalationFailedAssignmentID(assignment.Reason))
		s.DrainQueuedRoomInvocations(ctx, newInv.AgentID)
	case "complete", "wait", "skip":
		// Terminal — no further auto_review until next message.
	case "retry":
		targetID := assignment.ID
		if esc, ok := parseAssignmentEscalationReason(assignment.Reason); ok && esc.FailedAssignmentID != "" {
			targetID = parseUUID(esc.FailedAssignmentID)
		}
		if !targetID.Valid {
			return s.FailAssignment(ctx, room, assignment, "retry target not found")
		}
		_, err := s.RetryRoomAssignment(ctx, room, targetID, pgtype.UUID{})
		return err
	case "reassign":
		if esc, ok := parseAssignmentEscalationReason(assignment.Reason); ok && !esc.AllowReassign {
			return s.FailAssignment(ctx, room, assignment, "reassign not allowed for explicit mention assignment")
		}
		agentUUID := parseUUID(decision.Reassign)
		if !agentUUID.Valid {
			return s.FailAssignment(ctx, room, assignment, "invalid reassign target")
		}
		a, newInv, err := s.createAssignmentWithInvocation(ctx, createAssignmentParams{
			Room: room, SourceMessage: sourceMsg,
			AssigneeType: "agent", AssigneeID: agentUUID, Kind: "reassign",
			Reason: decision.Reason, CreatedByType: "agent", CreatedByID: room.ManagerAgentID,
			Intent: "execute", TimeoutAt: time.Now().Add(30 * time.Minute),
			CanAccessAgent: func(_ context.Context, _ db.Agent, _, _, _ string) bool { return true },
			AuthorType:     "agent", AuthorID: util.UUIDToString(room.ManagerAgentID),
			WorkspaceID: util.UUIDToString(room.WorkspaceID),
		})
		if err != nil {
			return err
		}
		createdAssignmentIDs = append(createdAssignmentIDs, a.ID)
		if err := s.postManagerDispatchMessage(ctx, room, record, a, agentUUID, sourceMsg, "escalate", decision.Reason); err != nil {
			slog.Warn("post manager dispatch message failed", "error", err)
		}
		s.recoverySupersedeForNewAssignment(ctx, room, a, parseEscalationFailedAssignmentID(assignment.Reason))
		s.DrainQueuedRoomInvocations(ctx, newInv.AgentID)
	case "ask_user":
		// No-op: manager already posted output if needed.
	default:
		slog.Warn("unknown manager decision action", "action", decision.Action)
	}
	if len(createdAssignmentIDs) > 0 {
		if updated, err := s.Queries.UpdateRoomManagerDecisionCreatedAssignments(ctx, db.UpdateRoomManagerDecisionCreatedAssignmentsParams{
			ID:                   record.ID,
			CreatedAssignmentIds: createdAssignmentIDs,
		}); err == nil {
			record = updated
			s.publishRoomManagerDecisionCreated(ctx, room, record)
		}
	}
	s.RefreshRoomSnapshot(ctx, room.ID)
	return nil
}

type assignmentEscalationReason struct {
	Escalation         string `json:"escalation"`
	FailedAssignmentID string `json:"failed_assignment_id"`
	FailedAgentID      string `json:"failed_agent_id,omitempty"`
	AllowReassign      bool   `json:"allow_reassign"`
	FailureReason      string `json:"failure_reason,omitempty"`
}

func parseAssignmentEscalationReason(reason pgtype.Text) (assignmentEscalationReason, bool) {
	if !reason.Valid || strings.TrimSpace(reason.String) == "" {
		return assignmentEscalationReason{}, false
	}
	var esc assignmentEscalationReason
	if err := json.Unmarshal([]byte(reason.String), &esc); err != nil {
		return assignmentEscalationReason{}, false
	}
	if esc.Escalation != "role_failure" || esc.FailedAssignmentID == "" {
		return assignmentEscalationReason{}, false
	}
	return esc, true
}

// maybeEscalateFailedAssignmentToManager triggers a manager auto_review when a role assignment fails.
func (s *TaskService) maybeEscalateFailedAssignmentToManager(
	ctx context.Context,
	room db.Room,
	assignment db.RoomAssignment,
	reason string,
) error {
	if !room.ManagerAgentID.Valid {
		return nil
	}
	policy := ParseRoomPolicy(room.Policy)
	if policy.Fallback.OnRoleFailure != "manager_replan" {
		return nil
	}
	switch assignment.Kind {
	case "auto_review", "join", "reassign":
		return nil
	}
	if assignment.AssigneeType == "agent" && assignment.AssigneeID.Valid &&
		assignment.AssigneeID.Bytes == room.ManagerAgentID.Bytes {
		return nil
	}

	failedID := util.UUIDToString(assignment.ID)
	existing, err := s.Queries.ListRoomAssignmentsBySourceMessage(ctx, assignment.SourceMessageID)
	if err == nil {
		for _, a := range existing {
			if a.Kind != "auto_review" {
				continue
			}
			if a.Status != "pending" && a.Status != "running" && a.Status != "blocked" {
				continue
			}
			if esc, ok := parseAssignmentEscalationReason(a.Reason); ok && esc.FailedAssignmentID == failedID {
				return nil
			}
		}
	}

	sourceMsg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: assignment.SourceMessageID, RoomID: room.ID,
	})
	if err != nil {
		return err
	}

	allowReassign := assignment.Kind != "mention"
	escPayload, _ := json.Marshal(assignmentEscalationReason{
		Escalation:         "role_failure",
		FailedAssignmentID: failedID,
		FailedAgentID:      util.UUIDToString(assignment.AssigneeID),
		AllowReassign:      allowReassign,
		FailureReason:      truncateAssignmentReason(reason),
	})

	_, inv, err := s.createAssignmentWithInvocation(ctx, createAssignmentParams{
		Room:           room,
		SourceMessage:  sourceMsg,
		AssigneeType:   "agent",
		AssigneeID:     room.ManagerAgentID,
		Kind:           "auto_review",
		Reason:         string(escPayload),
		CreatedByType:  "system",
		Intent:         "escalate",
		TimeoutAt:      time.Now().Add(30 * time.Minute),
		CanAccessAgent: func(_ context.Context, _ db.Agent, _, _, _ string) bool { return true },
		AuthorType:     "system",
		AuthorID:       util.UUIDToString(room.ManagerAgentID),
		WorkspaceID:    util.UUIDToString(room.WorkspaceID),
	})
	if err != nil {
		slog.Warn("escalate failed assignment to manager failed",
			"room_id", util.UUIDToString(room.ID),
			"assignment_id", failedID,
			"error", err,
		)
		return err
	}
	s.DrainQueuedRoomInvocations(ctx, inv.AgentID)
	return nil
}
