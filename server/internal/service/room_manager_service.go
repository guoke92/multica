package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// ManagerDecision is the structured decision a manager agent emits.
type ManagerDecision struct {
	Action      string                   `json:"action"`
	RouteTo     string                   `json:"route_to,omitempty"`
	RelayTo     string                   `json:"relay_to,omitempty"`
	AgentID     string                   `json:"agent_id,omitempty"`
	Message     string                   `json:"message,omitempty"`
	Reason      string                   `json:"reason,omitempty"`
	Retry       bool                     `json:"retry,omitempty"`
	Reassign    string                   `json:"reassign_to,omitempty"`
	Options     []HumanInteractionOption `json:"options,omitempty"`
	AllowCustom bool                     `json:"allow_custom,omitempty"`
}

// WorkflowAction is the legacy structured footer managers may still emit.
type WorkflowAction struct {
	Action         string                   `json:"action"`
	Title          string                   `json:"title,omitempty"`
	AgentID        string                   `json:"agent_id,omitempty"`
	AgentIDs       []string                 `json:"agent_ids,omitempty"`
	RouteTo        string                   `json:"route_to,omitempty"`
	RelayTo        string                   `json:"relay_to,omitempty"`
	RelayReason    string                   `json:"relay_reason,omitempty"`
	EscalateTo     string                   `json:"escalate_to,omitempty"`
	EscalateReason string                   `json:"escalate_reason,omitempty"`
	Message        string                   `json:"message,omitempty"`
	Options        []HumanInteractionOption `json:"options,omitempty"`
	AllowCustom    bool                     `json:"allow_custom,omitempty"`
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
	case "ask_user":
		return ManagerDecision{
			Action: "ask_user", Message: wa.Message,
			Options: wa.Options, AllowCustom: wa.AllowCustom,
		}
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


// ApplyManagerDecision records the decision, writes the invocation outcome, and creates downstream assignments.
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

	var outcome RoomInvocationOutcome
	dispatchMentionErr := false

	switch decision.Action {
	case "assign":
		targetID, kind := decision.RouteTo, "manager_route"
		if decision.RelayTo != "" {
			targetID, kind = decision.RelayTo, "manager_relay"
		}
		if targetID == "" {
			targetID = decision.AgentID
		}
		agentUUID := parseUUID(targetID)
		if !agentUUID.Valid {
			outcome = failedOutcome("invalid assign target")
			_ = s.writeInvocationOutcome(ctx, inv, outcome)
			return s.FailAssignment(ctx, room, assignment, "invalid assign target")
		}
		if kind == "manager_relay" {
			if blocked, blockReason := s.shouldBlockManagerRelay(ctx, room, sourceMsg, agentUUID, decision.Reason); blocked {
				outcome = failedOutcome(blockReason)
				_ = s.writeInvocationOutcome(ctx, inv, outcome)
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
			WorkspaceID:    util.UUIDToString(room.WorkspaceID),
		})
		if err != nil {
			outcome = failedOutcome("failed to create downstream assignment: " + err.Error())
			break
		}
		createdAssignmentIDs = append(createdAssignmentIDs, a.ID)
		if kind == "manager_relay" {
			outcome = RoomInvocationOutcome{Type: string(ManagerOutcomeRelay), TargetAgentID: targetID, Reason: decision.Reason}
		} else {
			outcome = RoomInvocationOutcome{Type: string(ManagerOutcomeDispatch), TargetAgentID: targetID, Reason: decision.Reason}
		}
		if _, mErr := s.createManagerDispatchMention(ctx, room, sourceMsg, agentUUID, a); mErr != nil {
			slog.Warn("create manager dispatch mention failed", "error", mErr)
			dispatchMentionErr = true
		}
		s.recoverySupersedeForNewAssignment(ctx, room, a, parseEscalationFailedAssignmentID(assignment.Reason))
		s.DrainQueuedRoomInvocations(ctx, newInv.AgentID)
	case "complete":
		outcome = RoomInvocationOutcome{Type: string(ManagerOutcomeReviewComplete), Conclusion: decision.Message}
	case "wait":
		outcome = RoomInvocationOutcome{Type: string(ManagerOutcomeWait), Conclusion: decision.Message}
	case "skip":
		outcome = RoomInvocationOutcome{Type: string(ManagerOutcomeSkip)}
	case "ask_user":
		outcome = RoomInvocationOutcome{Type: string(ManagerOutcomeAskUser), Conclusion: decision.Message}
	case "retry":
		targetID := assignment.ID
		if esc, ok := parseAssignmentEscalationReason(assignment.Reason); ok && esc.FailedAssignmentID != "" {
			targetID = parseUUID(esc.FailedAssignmentID)
		}
		if !targetID.Valid {
			outcome = failedOutcome("retry target not found")
			_ = s.writeInvocationOutcome(ctx, inv, outcome)
			return s.FailAssignment(ctx, room, assignment, "retry target not found")
		}
		outcome = RoomInvocationOutcome{Type: string(ManagerOutcomeRetry), TargetAssignmentID: util.UUIDToString(targetID)}
		if _, err := s.RetryRoomAssignment(ctx, room, targetID, pgtype.UUID{}); err != nil {
			outcome = failedOutcome("retry failed: " + err.Error())
		}
	case "reassign":
		if esc, ok := parseAssignmentEscalationReason(assignment.Reason); ok && !esc.AllowReassign {
			outcome = failedOutcome("reassign not allowed for explicit mention assignment")
			_ = s.writeInvocationOutcome(ctx, inv, outcome)
			return s.FailAssignment(ctx, room, assignment, "reassign not allowed for explicit mention assignment")
		}
		agentUUID := parseUUID(decision.Reassign)
		if !agentUUID.Valid {
			outcome = failedOutcome("invalid reassign target")
			break
		}
		a, newInv, err := s.createAssignmentWithInvocation(ctx, createAssignmentParams{
			Room: room, SourceMessage: sourceMsg,
			AssigneeType: "agent", AssigneeID: agentUUID, Kind: "reassign",
			Reason: decision.Reason, CreatedByType: "agent", CreatedByID: room.ManagerAgentID,
			Intent: "execute", TimeoutAt: time.Now().Add(30 * time.Minute),
			CanAccessAgent: func(_ context.Context, _ db.Agent, _, _, _ string) bool { return true },
			AuthorType:     "agent", AuthorID: util.UUIDToString(room.ManagerAgentID),
			WorkspaceID:    util.UUIDToString(room.WorkspaceID),
		})
		if err != nil {
			outcome = failedOutcome("failed to create reassign assignment: " + err.Error())
			break
		}
		createdAssignmentIDs = append(createdAssignmentIDs, a.ID)
		outcome = RoomInvocationOutcome{Type: string(ManagerOutcomeReassign), TargetAgentID: decision.Reassign, Reason: decision.Reason}
		if _, mErr := s.createManagerDispatchMention(ctx, room, sourceMsg, agentUUID, a); mErr != nil {
			slog.Warn("create manager dispatch mention failed", "error", mErr)
			dispatchMentionErr = true
		}
		s.recoverySupersedeForNewAssignment(ctx, room, a, parseEscalationFailedAssignmentID(assignment.Reason))
		s.DrainQueuedRoomInvocations(ctx, newInv.AgentID)
	default:
		slog.Warn("unknown manager decision action", "action", decision.Action)
		outcome = failedOutcome("unknown decision action: " + decision.Action)
	}

	if dispatchMentionErr {
		slog.Warn("manager dispatch mention failed; keeping successful dispatch outcome",
			"invocation_id", util.UUIDToString(inv.ID))
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
	if wErr := s.writeInvocationOutcome(ctx, inv, outcome); wErr != nil {
		slog.Warn("write manager invocation outcome failed", "invocation_id", util.UUIDToString(inv.ID), "error", wErr)
	}
	if err := s.createManagerDecisionHumanInteraction(ctx, room, inv, assignment, record, decision); err != nil {
		slog.Warn("create manager human interaction failed", "error", err)
	}
	s.RefreshRoomSnapshot(ctx, room.ID)
	return nil
}


type assignmentEscalationReason struct {
	Escalation         string `json:"escalation"`
	FailedAssignmentID string `json:"failed_assignment_id"`
	FailedAgentID        string `json:"failed_agent_id"`
	AllowReassign        bool   `json:"allow_reassign"`
	FailureReason        string `json:"failure_reason,omitempty"`
}

func (s *TaskService) createManagerDispatchMention(
	ctx context.Context,
	room db.Room,
	sourceMsg db.RoomMessage,
	_ pgtype.UUID,
	assignment db.RoomAssignment,
) (db.RoomMessageMention, error) {
	mention, err := s.Queries.CreateRoomMessageMention(ctx, db.CreateRoomMessageMentionParams{
		ID:              util.MustNewUUIDv7(),
		MessageID:       sourceMsg.ID,
		TargetType:      assignment.AssigneeType,
		TargetID:        assignment.AssigneeID,
		SourceType:      "manager_dispatch",
		SourceMessageID: sourceMsg.ID,
		AssignmentID:   assignment.ID,
	})
	if err != nil {
		return db.RoomMessageMention{}, err
	}
	return mention, nil
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

	escAsgn, inv, err := s.createAssignmentWithInvocation(ctx, createAssignmentParams{
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
		// Assignment may already be persisted before enqueue/CAS fails — close it
		// so the flow UI does not stick on assignment_created forever.
		if escAsgn.ID.Valid {
			_ = s.FailAssignment(ctx, room, escAsgn, err.Error())
		}
		return err
	}
	s.DrainQueuedRoomInvocations(ctx, inv.AgentID)
	return nil
}
