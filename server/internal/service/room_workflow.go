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

const RoomWorkflowContextType = "room_workflow"

// RoomWorkflowContext is stored on agent_task_queue.context for workflow runs.
type RoomWorkflowContext struct {
	Type       string `json:"type"`
	DeliveryID string `json:"delivery_id,omitempty"`
	TopicID    string `json:"topic_id,omitempty"`
	Intent     string `json:"intent"`
	PhaseKey   string `json:"phase_key,omitempty"`
	RoleKey    string `json:"role_key,omitempty"`
	OnFailure  string `json:"on_failure,omitempty"`
}

// WorkflowAction is the structured footer managers emit on task completion.
type WorkflowAction struct {
	Action    string              `json:"action"`
	Title     string              `json:"title,omitempty"`
	RoleKey   string              `json:"role_key,omitempty"`
	RoleKeys  []string            `json:"role_keys,omitempty"`
	AgentID   string              `json:"agent_id,omitempty"`
	AgentIDs  []string            `json:"agent_ids,omitempty"`
	PhaseKey  string              `json:"phase_key,omitempty"`
	Message   string              `json:"message,omitempty"`
	SyncIssue bool                `json:"sync_issue,omitempty"`
	Progress  []ProgressItemInput `json:"progress,omitempty"`
	// Router/Supervisor mode fields.
	RouteTo        string `json:"route_to,omitempty"`
	RelayTo        string `json:"relay_to,omitempty"`
	RelayReason    string `json:"relay_reason,omitempty"`
	EscalateTo     string `json:"escalate_to,omitempty"`
	EscalateReason string `json:"escalate_reason,omitempty"`
}

// ProgressItemInput is a workboard progress row from the manager.
type ProgressItemInput struct {
	Title  string `json:"title"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type workflowActionEnvelope struct {
	WorkflowAction WorkflowAction `json:"workflow_action"`
}

func (s *TaskService) parseRoomWorkflowContext(task db.AgentTaskQueue) (RoomWorkflowContext, bool) {
	if len(task.Context) == 0 {
		return RoomWorkflowContext{}, false
	}
	var ctx RoomWorkflowContext
	if err := json.Unmarshal(task.Context, &ctx); err != nil {
		return RoomWorkflowContext{}, false
	}
	if ctx.Type != RoomWorkflowContextType {
		return RoomWorkflowContext{}, false
	}
	return ctx, true
}

func marshalRoomWorkflowContext(ctx RoomWorkflowContext) []byte {
	ctx.Type = RoomWorkflowContextType
	b, _ := json.Marshal(ctx)
	return b
}

func (s *TaskService) loadMentionInvocation(ctx context.Context, id pgtype.UUID) (db.MentionInvocation, error) {
	inv, err := s.Queries.GetMentionInvocationExtended(ctx, id)
	if err == nil {
		return inv, nil
	}
	return s.Queries.GetMentionInvocation(ctx, id)
}

func parseWorkflowActionFromOutput(output string) (WorkflowAction, bool) {
	output = strings.TrimSpace(output)
	if output == "" {
		return WorkflowAction{}, false
	}
	// Try raw JSON first.
	var env workflowActionEnvelope
	if err := json.Unmarshal([]byte(output), &env); err == nil && env.WorkflowAction.Action != "" {
		return env.WorkflowAction, true
	}
	// Try fenced JSON block.
	if idx := strings.LastIndex(output, "```json"); idx >= 0 {
		rest := output[idx+7:]
		if end := strings.Index(rest, "```"); end > 0 {
			chunk := strings.TrimSpace(rest[:end])
			if err := json.Unmarshal([]byte(chunk), &env); err == nil && env.WorkflowAction.Action != "" {
				return env.WorkflowAction, true
			}
		}
	}
	// Also try plain ``` fence (without "json" language tag).
	if idx := strings.LastIndex(output, "```"); idx >= 0 {
		rest := output[idx+3:]
		if end := strings.Index(rest, "```"); end > 0 {
			chunk := strings.TrimSpace(rest[:end])
			if err := json.Unmarshal([]byte(chunk), &env); err == nil && env.WorkflowAction.Action != "" {
				return env.WorkflowAction, true
			}
		}
	}
	// Try last JSON object in output.
	if idx := strings.LastIndex(output, "{"); idx >= 0 {
		if err := json.Unmarshal([]byte(output[idx:]), &env); err == nil && env.WorkflowAction.Action != "" {
			return env.WorkflowAction, true
		}
	}
	// Text-based heuristic: look for workflow_action JSON anywhere in the text,
	// even if embedded in markdown or other content.
	re := regexp.MustCompile(`\{\s*"workflow_action"\s*:\s*\{[^}]+\}\s*\}`)
	if match := re.FindString(output); match != "" {
		if err := json.Unmarshal([]byte(match), &env); err == nil && env.WorkflowAction.Action != "" {
			return env.WorkflowAction, true
		}
	}
	return WorkflowAction{}, false
}

// ProcessRoomWorkflowOnComplete handles post-task workflow transitions.
func (s *TaskService) ProcessRoomWorkflowOnComplete(
	ctx context.Context,
	task db.AgentTaskQueue,
	inv db.MentionInvocation,
	room db.Room,
	output string,
	succeeded bool,
) {
	wfCtx, ok := s.parseRoomWorkflowContext(task)
	if !ok && inv.Intent != "orchestrate" && inv.Intent != "route" && inv.Intent != "execute" && inv.Intent != "review" && inv.Intent != "confirm" && inv.Intent != "escalate" {
		return
	}
	intent := inv.Intent
	if ok {
		intent = wfCtx.Intent
	}

	if !succeeded {
		// Only trigger Manager notification for agent execution failures.
		// Do NOT trigger for Manager intent failures (review/route/etc.)
		// to prevent infinite cascading failure loops.
		if intent == "execute" && room.ManagerAgentID.Valid {
			agentName := s.resolveAgentName(ctx, task.AgentID)
			if agentName == "" {
				agentName = "Agent"
			}
			// Create a visible failure notification.
			failContent := "\u26a0\ufe0f " + agentName + " \u56de\u7b54\u5931\u8d25\uff0c\u5df2\u901a\u77e5\u7ba1\u7406\u5458\u91cd\u65b0\u5206\u914d\u3002"
			if failMsg, createErr := s.Queries.CreateRoomMessageExtended(ctx, db.CreateRoomMessageExtendedParams{
				RoomID:     room.ID,
				SenderType: "system",
				Content:    failContent,
			}); createErr == nil {
				s.publishRoomMessage(ctx, room, failMsg, db.AgentTaskQueue{})
			}
			// Dispatch Manager to review the failure and decide next action.
			msg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
				ID: inv.MessageID, RoomID: room.ID,
			})
			if err == nil {
				mgrInv, mgrErr := s.dispatchRoomWorkflowInvocation(ctx, dispatchWorkflowInvocationParams{
					Room: room, Message: msg, AgentID: room.ManagerAgentID,
					Intent: "review", MaxDepth: RoomMaxChainDepth(room),
					TimeoutAt:  time.Now().Add(30 * time.Minute),
					DeliveryID: inv.DeliveryID, TopicID: inv.TopicID,
					OnFailure:          "manager_replan",
					ParentInvocationID: inv.ID,
				})
				if mgrErr == nil {
					s.RefreshRoomSnapshot(ctx, room.ID)
					s.drainRoomDispatchAgents(ctx, room, []db.MentionInvocation{mgrInv})
				}
			}
		}
		return
	}

	switch intent {
	case "execute":
		s.enqueueManagerReview(ctx, room, inv)
	case "orchestrate", "route", "review", "confirm":
		action, found := parseWorkflowActionFromOutput(output)
		if !found {
			// Text-based fallback: try to resolve agent name from output.
			action, found = s.tryResolveRouteFromText(ctx, room, output)
		}
		if !found {
			preview := output
			if len(preview) > 500 {
				preview = preview[:500]
			}
			slog.Warn("room workflow: no structured action in manager output",
				"invocation_id", util.UUIDToString(inv.ID),
				"intent", intent,
				"output_preview", preview,
			)
			// Notify users in chat that the manager failed to produce a routing decision.
			if notifyMsg, createErr := s.Queries.CreateRoomMessageExtended(ctx, db.CreateRoomMessageExtendedParams{
				RoomID:     room.ID,
				SenderType: "system",
				Content:    "⚠️ 群管理未能生成有效的路由指令，请重新发送消息以重试。",
			}); createErr == nil {
				s.publishRoomMessage(ctx, room, notifyMsg, db.AgentTaskQueue{})
			}
			return
		}
		if err := s.applyWorkflowAction(ctx, room, inv, action); err != nil {
			slog.Warn("room workflow: apply action failed",
				"action", action.Action,
				"error", err,
			)
		}
	case "relay", "escalate":
		// Relay and escalate intents complete without further workflow transitions.
	}
}

func (s *TaskService) enqueueManagerReview(ctx context.Context, room db.Room, inv db.MentionInvocation) {
	if !room.ManagerAgentID.Valid {
		return
	}
	// Dedup: check if a Manager review already exists for the same trigger message.
	existingInvs, err := s.Queries.ListRoomMentionInvocations(ctx, room.ID)
	if err == nil {
		for _, existing := range existingInvs {
			if existing.TargetID.Bytes != room.ManagerAgentID.Bytes {
				continue
			}
			if existing.MessageID.Bytes != inv.MessageID.Bytes {
				continue
			}
			// Skip if this is a review/confirm invocation for the same message
			// that hasn't completed yet or already succeeded.
			if (existing.Intent == "review" || existing.Intent == "confirm") && existing.ID.Bytes != inv.ID.Bytes {
				switch existing.Status {
				case "pending", "queued", "running", "delivered", "succeeded":
					slog.Info("enqueueManagerReview: skipped duplicate, existing review",
						"existing_id", util.UUIDToString(existing.ID),
						"status", existing.Status,
					)
					return
				}
			}
		}
	}
	msg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: inv.MessageID, RoomID: room.ID,
	})
	if err != nil {
		return
	}
	mgrInv, err := s.dispatchRoomWorkflowInvocation(ctx, dispatchWorkflowInvocationParams{
		Room: room, Message: msg, AgentID: room.ManagerAgentID,
		Intent: "review", MaxDepth: RoomMaxChainDepth(room),
		TimeoutAt:          time.Now().Add(30 * time.Minute),
		ParentInvocationID: inv.ID,
		DeliveryID:         inv.DeliveryID,
		TopicID:            inv.TopicID,
	})
	if err != nil {
		return
	}
	s.RefreshRoomSnapshot(ctx, room.ID)
	s.drainRoomDispatchAgents(ctx, room, []db.MentionInvocation{mgrInv})
}

func (s *TaskService) applyWorkflowAction(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	action WorkflowAction,
) error {
	policy := ParseRoomPolicy(room.Policy)
	switch action.Action {
	case "create_delivery":
		return s.workflowCreateDelivery(ctx, room, inv, policy, action)
	case "dispatch_role", "dispatch_agent":
		return s.workflowDispatchRole(ctx, room, inv, policy, action)
	case "advance_phase":
		return s.workflowAdvancePhase(ctx, room, inv, action)
	case "ask_user", "notify_user":
		return s.workflowNotifyUser(ctx, room, inv, action)
	case "update_progress":
		return s.workflowUpdateProgress(ctx, room, action)
	case "complete_delivery":
		return s.workflowCompleteDelivery(ctx, room, inv, action)
	// Router/Supervisor mode actions.
	case "route_to":
		return s.workflowRouteTo(ctx, room, inv, policy, action)
	case "relay_to":
		return s.workflowRelayTo(ctx, room, inv, policy, action)
	case "escalate":
		return s.workflowEscalate(ctx, room, inv, action)
	default:
		return nil
	}
}

func (s *TaskService) workflowCreateDelivery(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	policy RoomPolicy,
	action WorkflowAction,
) error {
	return s.workflowCreateTopic(ctx, room, inv, policy, action)
}

func (s *TaskService) workflowCreateTopic(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	policy RoomPolicy,
	action WorkflowAction,
) error {
	templateKey := policy.WorkflowTemplate
	if templateKey == "" {
		templateKey = "sqa_three_phase"
	}
	title := strings.TrimSpace(action.Title)
	if title == "" {
		title = "新话题"
	}
	tpl, _ := GetWorkflowTemplate(templateKey)
	rootTitle := tpl.Title
	if rootTitle == "" {
		rootTitle = title
	}
	topic, err := s.Queries.CreateRoomTopic(ctx, db.CreateRoomTopicParams{
		RoomID:   room.ID,
		Title:    rootTitle,
		Status:   "pending",
		PhaseKey: "root",
	})
	if err != nil {
		return err
	}
	_ = s.TouchRoomTopicLastMessage(ctx, topic.ID, inv.MessageID)

	cardMeta, _ := json.Marshal(map[string]any{
		"topic_id":          util.UUIDToString(topic.ID),
		"status":            "intake",
		"current_phase":     "",
		"workflow_template": templateKey,
		"checklist":         buildPhaseChecklist(tpl, ""),
	})
	card, err := s.Queries.CreateRoomMessageExtended(ctx, db.CreateRoomMessageExtendedParams{
		RoomID:      room.ID,
		SenderType:  "system",
		Content:     title,
		TopicID:     topic.ID,
		MessageKind: pgtype.Text{String: "card", Valid: true},
		Metadata:    cardMeta,
	})
	if err != nil {
		return err
	}
	_ = s.TouchRoomTopicLastMessage(ctx, topic.ID, card.ID)
	_, _ = s.Queries.UpdateRoomTopic(ctx, db.UpdateRoomTopicParams{
		ID: topic.ID, Status: pgtype.Text{String: "in_progress", Valid: true},
	})
	_ = s.Queries.TouchRoom(ctx, room.ID)
	s.RefreshRoomSnapshot(ctx, room.ID)
	return nil
}

// maybeMirrorDeliveryIssue optionally creates a parent Issue mirror (post-MVP).
func (s *TaskService) maybeMirrorDeliveryIssue(
	ctx context.Context,
	room db.Room,
	delivery db.RoomDelivery,
	title string,
	anchorMessageID pgtype.UUID,
) {
	// V1: linked_issue_id column is ready; full Issue create wiring lands when
	// product enables sync_issue on create_delivery actions.
	_ = ctx
	_ = room
	_ = delivery
	_ = title
	_ = anchorMessageID
}

func buildPhaseChecklist(tpl WorkflowTemplateDef, current string) []map[string]string {
	out := make([]map[string]string, 0, len(tpl.Phases))
	for _, ph := range tpl.Phases {
		status := "pending"
		if ph.Key == current {
			status = "in_progress"
		}
		out = append(out, map[string]string{
			"phase_key": ph.Key,
			"title":     ph.Title,
			"status":    status,
		})
	}
	return out
}

func (s *TaskService) ensureActiveDelivery(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	policy RoomPolicy,
	titleHint string,
) (pgtype.UUID, error) {
	if inv.DeliveryID.Valid {
		return inv.DeliveryID, nil
	}
	if inv.TopicID.Valid {
		if topic, err := s.Queries.GetRoomTopic(ctx, inv.TopicID); err == nil && topic.DeliveryID.Valid {
			return topic.DeliveryID, nil
		}
		return pgtype.UUID{}, nil
	}
	if active, ok := s.resolveActiveRoomTopicContext(ctx, room.ID); ok {
		if active.DeliveryID.Valid {
			return active.DeliveryID, nil
		}
		if active.Topic.ID.Valid {
			return pgtype.UUID{}, nil
		}
	}
	title := strings.TrimSpace(titleHint)
	if title == "" {
		title = "新话题"
	}
	if err := s.workflowCreateTopic(ctx, room, inv, policy, WorkflowAction{
		Action: "create_delivery",
		Title:  title,
	}); err != nil {
		return pgtype.UUID{}, err
	}
	if active, ok := s.resolveActiveRoomTopicContext(ctx, room.ID); ok && active.DeliveryID.Valid {
		return active.DeliveryID, nil
	}
	return pgtype.UUID{}, nil
}

func (s *TaskService) resolveWorkflowTopicID(ctx context.Context, room db.Room, inv db.MentionInvocation) pgtype.UUID {
	if inv.TopicID.Valid {
		return inv.TopicID
	}
	if active, ok := s.resolveActiveRoomTopicContext(ctx, room.ID); ok {
		return active.Topic.ID
	}
	return pgtype.UUID{}
}

func (s *TaskService) updateTopicCardMetadata(
	ctx context.Context,
	room db.Room,
	topicID pgtype.UUID,
	meta map[string]any,
) {
	if !topicID.Valid {
		return
	}
	cardID, err := s.Queries.GetRoomTopicCardMessageID(ctx, db.GetRoomTopicCardMessageIDParams{
		RoomID: room.ID, TopicID: topicID,
	})
	if err != nil {
		return
	}
	b, err := json.Marshal(meta)
	if err != nil {
		return
	}
	_ = s.Queries.UpdateRoomMessageMetadata(ctx, db.UpdateRoomMessageMetadataParams{
		ID: cardID, Metadata: b,
	})
}

func deliveryTitleFromManagerMessage(content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	if idx := strings.Index(content, "```"); idx > 0 {
		content = strings.TrimSpace(content[:idx])
	}
	if idx := strings.LastIndex(content, "{"); idx > 0 && strings.Contains(content[idx:], "workflow_action") {
		content = strings.TrimSpace(content[:idx])
	}
	runes := []rune(content)
	if len(runes) > 80 {
		content = string(runes[:80])
	}
	return strings.TrimSpace(content)
}

func (s *TaskService) workflowDispatchRole(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	policy RoomPolicy,
	action WorkflowAction,
) error {
	roleKeys := action.RoleKeys
	if action.RoleKey != "" {
		roleKeys = append(roleKeys, action.RoleKey)
	}
	if len(roleKeys) == 0 && action.AgentID == "" && len(action.AgentIDs) == 0 {
		return nil
	}

	msg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: inv.MessageID, RoomID: room.ID,
	})
	if err != nil {
		return err
	}

	deliveryID, err := s.ensureActiveDelivery(ctx, room, inv, policy, deliveryTitleFromManagerMessage(msg.Content))
	if err != nil {
		slog.Warn("workflow ensure delivery failed", "error", err)
		return err
	}

	agentIDs := action.AgentIDs
	if action.AgentID != "" {
		agentIDs = append(agentIDs, action.AgentID)
	}
	if len(agentIDs) == 0 {
		for _, roleKey := range roleKeys {
			if id, ok := s.resolveDispatchAgentID(ctx, room, policy, roleKey); ok {
				agentIDs = append(agentIDs, util.UUIDToString(id))
			}
		}
	}

	for _, agentIDStr := range agentIDs {
		agentID := parseUUID(agentIDStr)
		if !agentID.Valid {
			continue
		}
		roleKey := action.RoleKey
		if roleKey == "" && len(roleKeys) > 0 {
			roleKey = roleKeys[0]
		}
		topic, _ := s.Queries.CreateRoomTopic(ctx, db.CreateRoomTopicParams{
			RoomID: room.ID, DeliveryID: deliveryID, Title: roleKey,
			Status: "in_progress", PhaseKey: action.PhaseKey,
			AssigneeAgentID: agentID,
		})
		_, err = s.dispatchRoomWorkflowInvocation(ctx, dispatchWorkflowInvocationParams{
			Room: room, Message: msg, AgentID: agentID,
			Intent: "execute", RoleKey: roleKey, PhaseKey: action.PhaseKey,
			MaxDepth: RoomMaxChainDepth(room), TimeoutAt: time.Now().Add(30 * time.Minute),
			DeliveryID: deliveryID, TopicID: topic.ID,
		})
		if err != nil {
			slog.Warn("workflow dispatch failed", "agent_id", agentIDStr, "role", roleKey, "error", err)
		}
	}
	s.RefreshRoomSnapshot(ctx, room.ID)
	s.MaybeTriggerManagerProgressScan(ctx, room)
	return nil
}

func (s *TaskService) resolveDispatchAgentID(
	ctx context.Context,
	room db.Room,
	policy RoomPolicy,
	roleKey string,
) (pgtype.UUID, bool) {
	if id, ok := policy.ResolveRoleAgentID(roleKey); ok {
		return parseUUID(id), parseUUID(id).Valid
	}
	members, err := s.Queries.ListRoomMembers(ctx, room.ID)
	if err != nil {
		return pgtype.UUID{}, false
	}
	needle := strings.ToLower(strings.TrimSpace(roleKey))
	for _, m := range members {
		if m.PrincipalType != "agent" {
			continue
		}
		if room.ManagerAgentID.Valid && m.PrincipalID.Bytes == room.ManagerAgentID.Bytes {
			continue
		}
		agent, err := s.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
			ID: m.PrincipalID, WorkspaceID: room.WorkspaceID,
		})
		if err != nil {
			continue
		}
		name := strings.ToLower(strings.TrimSpace(agent.Name))
		if name == "" {
			continue
		}
		if strings.Contains(name, needle) || strings.Contains(needle, name) {
			return agent.ID, true
		}
		if label, ok := roleKeyDisplayLabel(roleKey); ok && strings.Contains(name, strings.ToLower(label)) {
			return agent.ID, true
		}
	}
	return pgtype.UUID{}, false
}

func roleKeyDisplayLabel(roleKey string) (string, bool) {
	labels := map[string]string{
		"requirement_analyst": "需求",
		"architect":           "架构",
		"ui_designer":         "设计",
		"frontend":            "前端",
		"backend":             "后端",
		"qa":                  "测试",
	}
	if l, ok := labels[roleKey]; ok {
		return l, true
	}
	return "", false
}

func (s *TaskService) workflowAdvancePhase(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	action WorkflowAction,
) error {
	policy := ParseRoomPolicy(room.Policy)
	topicID := s.resolveWorkflowTopicID(ctx, room, inv)
	if topicID.Valid {
		topic, err := s.Queries.UpdateRoomTopic(ctx, db.UpdateRoomTopicParams{
			ID:     topicID,
			Status: pgtype.Text{String: "in_progress", Valid: true},
		})
		if err != nil {
			return err
		}
		templateKey := policy.WorkflowTemplate
		if templateKey == "" {
			templateKey = "sqa_three_phase"
		}
		tpl, _ := GetWorkflowTemplate(templateKey)
		phaseKey := action.PhaseKey
		if phaseKey == "" {
			phaseKey = topic.PhaseKey
		}
		s.updateTopicCardMetadata(ctx, room, topicID, map[string]any{
			"topic_id":          util.UUIDToString(topic.ID),
			"status":            topic.Status,
			"current_phase":     phaseKey,
			"workflow_template": templateKey,
			"checklist":         buildPhaseChecklist(tpl, phaseKey),
			"room_event":        "phase_advanced",
		})
		s.RefreshRoomSnapshot(ctx, room.ID)
		return nil
	}
	deliveryID, err := s.ensureActiveDelivery(ctx, room, inv, policy, "")
	if err != nil {
		return err
	}
	if !deliveryID.Valid {
		return nil
	}
	inv.DeliveryID = deliveryID
	delivery, err := s.Queries.UpdateRoomDelivery(ctx, db.UpdateRoomDeliveryParams{
		ID:           inv.DeliveryID,
		CurrentPhase: pgtype.Text{String: action.PhaseKey, Valid: action.PhaseKey != ""},
		Status:       pgtype.Text{String: "in_progress", Valid: true},
	})
	if err != nil {
		return err
	}
	if delivery.CardMessageID.Valid {
		tpl, _ := GetWorkflowTemplate(delivery.WorkflowTemplate)
		meta, _ := json.Marshal(map[string]any{
			"delivery_id":       util.UUIDToString(delivery.ID),
			"status":            delivery.Status,
			"current_phase":     delivery.CurrentPhase,
			"workflow_template": delivery.WorkflowTemplate,
			"checklist":         buildPhaseChecklist(tpl, delivery.CurrentPhase),
			"room_event":        "phase_advanced",
		})
		_ = s.Queries.UpdateRoomMessageMetadata(ctx, db.UpdateRoomMessageMetadataParams{
			ID: delivery.CardMessageID, Metadata: meta,
		})
	}
	s.RefreshRoomSnapshot(ctx, room.ID)
	return nil
}

func (s *TaskService) workflowNotifyUser(ctx context.Context, room db.Room, inv db.MentionInvocation, action WorkflowAction) error {
	// Create a visible system message for the Manager's direct response.
	if action.Message != "" {
		content := action.Message
		if action.Title != "" {
			content = action.Title + ": " + action.Message
		}
		if notifyMsg, err := s.Queries.CreateRoomMessageExtended(ctx, db.CreateRoomMessageExtendedParams{
			RoomID:     room.ID,
			SenderType: "system",
			Content:    content,
		}); err == nil {
			s.publishRoomMessage(ctx, room, notifyMsg, db.AgentTaskQueue{})
		}
	}
	// Also update progress.
	return s.workflowUpdateProgress(ctx, room, action)
}

func (s *TaskService) workflowUpdateProgress(ctx context.Context, room db.Room, action WorkflowAction) error {
	if len(action.Progress) == 0 {
		return nil
	}
	items := make([]map[string]string, 0, len(action.Progress))
	for _, p := range action.Progress {
		items = append(items, map[string]string{
			"title":  p.Title,
			"status": p.Status,
			"detail": p.Detail,
		})
	}
	s.mergeRoomProgressSnapshot(ctx, room.ID, items)
	return nil
}

func (s *TaskService) workflowCompleteDelivery(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	action WorkflowAction,
) error {
	topicID := s.resolveWorkflowTopicID(ctx, room, inv)
	if topicID.Valid {
		topic, err := s.Queries.UpdateRoomTopic(ctx, db.UpdateRoomTopicParams{
			ID: topicID, Status: pgtype.Text{String: "done", Valid: true},
		})
		if err != nil {
			return err
		}
		s.updateTopicCardMetadata(ctx, room, topicID, map[string]any{
			"topic_id":   util.UUIDToString(topic.ID),
			"status":     "done",
			"room_event": "topic_completed",
		})
		s.RefreshRoomSnapshot(ctx, room.ID)
		return nil
	}
	if !inv.DeliveryID.Valid {
		if active, ok := s.resolveActiveRoomTopicContext(ctx, room.ID); ok && active.DeliveryID.Valid {
			inv.DeliveryID = active.DeliveryID
		}
	}
	if !inv.DeliveryID.Valid {
		return nil
	}
	delivery, err := s.Queries.UpdateRoomDelivery(ctx, db.UpdateRoomDeliveryParams{
		ID: inv.DeliveryID, Status: pgtype.Text{String: "done", Valid: true},
	})
	if err != nil {
		return err
	}
	if delivery.CardMessageID.Valid {
		meta, _ := json.Marshal(map[string]any{
			"delivery_id": util.UUIDToString(delivery.ID),
			"status":      "done",
			"room_event":  "delivery_completed",
		})
		_ = s.Queries.UpdateRoomMessageMetadata(ctx, db.UpdateRoomMessageMetadataParams{
			ID: delivery.CardMessageID, Metadata: meta,
		})
	}
	s.RefreshRoomSnapshot(ctx, room.ID)
	return nil
}

// ─── Router / Supervisor mode actions ──────────────────────────────────────────

// resolveAgentName fetches the display name for an agent ID.
func (s *TaskService) resolveAgentName(ctx context.Context, agentID pgtype.UUID) string {
	if !agentID.Valid {
		return ""
	}
	agent, err := s.Queries.GetAgent(ctx, agentID)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(agent.Name)
}

// workflowRouteTo records a RouteStep and dispatches the target agent. It does
// not create chat-visible route hint messages; routing is shown only in the
// workboard event graph.
func (s *TaskService) workflowRouteTo(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	policy RoomPolicy,
	action WorkflowAction,
) error {
	targetID := parseUUID(action.RouteTo)
	if !targetID.Valid {
		targetID = parseUUID(action.AgentID)
	}
	// Fallback: resolve role key (e.g. "requirement_analyst") to agent ID.
	if !targetID.Valid && action.RouteTo != "" {
		if id, ok := s.resolveDispatchAgentID(ctx, room, policy, action.RouteTo); ok {
			targetID = id
		}
	}
	if !targetID.Valid {
		return nil
	}

	topicID := s.ensureTopicForMessage(ctx, room, inv.MessageID)

	// Guard: skip if the target agent already has an active or recently completed
	// invocation for the same message chain (prevents Manager review loops).
	if s.agentRecentlyHandled(ctx, room, targetID, inv.MessageID) {
		slog.Info("workflow route_to: skipped duplicate route to agent",
			"agent_id", util.UUIDToString(targetID),
			"message_id", util.UUIDToString(inv.MessageID),
		)
		return nil
	}

	targetName := s.resolveAgentName(ctx, targetID)
	if targetName == "" {
		targetName = "Agent"
	}

	s.recordLabeledWorkflowFlowEvent(ctx, room, inv, "manager_route_succeeded", "群管 → 路由给 "+targetName, map[string]string{
		"target_agent_id":   util.UUIDToString(targetID),
		"target_agent_name": targetName,
	})

	msg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: inv.MessageID, RoomID: room.ID,
	})
	if err != nil {
		return err
	}

	newInv, err := s.dispatchRoomWorkflowInvocation(ctx, dispatchWorkflowInvocationParams{
		Room: room, Message: msg, AgentID: targetID,
		Intent: "execute", MaxDepth: RoomMaxChainDepth(room),
		TimeoutAt: time.Now().Add(30 * time.Minute),
		TopicID:   topicID,
	})
	if err != nil {
		slog.Warn("workflow route_to: dispatch failed", "agent_id", util.UUIDToString(targetID), "error", err)
		return err
	}
	s.RefreshRoomSnapshot(ctx, room.ID)
	s.drainRoomDispatchAgents(ctx, room, []db.MentionInvocation{newInv})
	s.MaybeTriggerManagerProgressScan(ctx, room)
	return nil
}

// workflowRelayTo records a RelayStep and dispatches the next agent. It does
// not create chat-visible relay hint messages.
func (s *TaskService) workflowRelayTo(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	policy RoomPolicy,
	action WorkflowAction,
) error {
	targetID := parseUUID(action.RelayTo)
	if !targetID.Valid {
		targetID = parseUUID(action.AgentID)
	}
	if !targetID.Valid && action.RelayTo != "" {
		if id, ok := s.resolveDispatchAgentID(ctx, room, policy, action.RelayTo); ok {
			targetID = id
		}
	}
	if !targetID.Valid {
		return nil
	}
	topicID := s.ensureTopicForMessage(ctx, room, inv.MessageID)
	// Guard: prevent relay loops to the same agent for the same message.
	if s.agentRecentlyHandled(ctx, room, targetID, inv.MessageID) {
		slog.Info("workflow relay_to: skipped duplicate relay to agent",
			"agent_id", util.UUIDToString(targetID),
		)
		return nil
	}
	fromName := s.resolveAgentName(ctx, inv.TargetID)
	toName := s.resolveAgentName(ctx, targetID)
	if fromName == "" {
		fromName = "Agent"
	}
	if toName == "" {
		toName = "Agent"
	}

	relayLabel := fromName + " → " + toName
	if action.RelayReason != "" {
		relayLabel += " · " + action.RelayReason
	}
	s.recordLabeledWorkflowFlowEvent(ctx, room, inv, "manager_relay_succeeded", relayLabel, map[string]string{
		"from_agent_id":   util.UUIDToString(inv.TargetID),
		"from_agent_name": fromName,
		"to_agent_id":     util.UUIDToString(targetID),
		"to_agent_name":   toName,
		"reason":          action.RelayReason,
	})

	msg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: inv.MessageID, RoomID: room.ID,
	})
	if err != nil {
		return err
	}

	newInv, err := s.dispatchRoomWorkflowInvocation(ctx, dispatchWorkflowInvocationParams{
		Room: room, Message: msg, AgentID: targetID,
		Intent: "execute", MaxDepth: RoomMaxChainDepth(room),
		TimeoutAt:          time.Now().Add(30 * time.Minute),
		ParentInvocationID: inv.ID,
		TopicID:            topicID,
	})
	if err != nil {
		slog.Warn("workflow relay_to: dispatch failed", "agent_id", util.UUIDToString(targetID), "error", err)
		return err
	}
	s.RefreshRoomSnapshot(ctx, room.ID)
	s.drainRoomDispatchAgents(ctx, room, []db.MentionInvocation{newInv})
	s.MaybeTriggerManagerProgressScan(ctx, room)
	return nil
}

// workflowEscalate creates an escalation system message and dispatches the expert agent.
func (s *TaskService) workflowEscalate(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	action WorkflowAction,
) error {
	targetID := parseUUID(action.EscalateTo)
	if !targetID.Valid {
		targetID = parseUUID(action.AgentID)
	}
	if !targetID.Valid && action.EscalateTo != "" {
		policy := ParseRoomPolicy(room.Policy)
		if id, ok := s.resolveDispatchAgentID(ctx, room, policy, action.EscalateTo); ok {
			targetID = id
		}
	}
	if !targetID.Valid {
		return nil
	}
	topicID := s.ensureTopicForMessage(ctx, room, inv.MessageID)
	targetName := s.resolveAgentName(ctx, targetID)
	if targetName == "" {
		targetName = "Agent"
	}

	relayMeta, _ := json.Marshal(map[string]string{
		"target_agent_id":   util.UUIDToString(targetID),
		"target_agent_name": targetName,
		"reason":            action.EscalateReason,
	})
	content := "\U0001F6A8 \u5347\u7ea7\u4ecb\u5165\uff1a" + targetName
	if action.EscalateReason != "" {
		content += " \u2014 " + action.EscalateReason
	} else if action.Message != "" {
		content += " \u2014 " + action.Message
	}

	escalateMsg, err := s.Queries.CreateRoomMessageExtended(ctx, db.CreateRoomMessageExtendedParams{
		RoomID:         room.ID,
		SenderType:     "system",
		Content:        content,
		QuoteMessageID: inv.MessageID,
		MessageKind:    pgtype.Text{String: "escalate_hint", Valid: true},
		RelayMetadata:  relayMeta,
	})
	if err != nil {
		slog.Warn("workflow escalate: create message failed", "error", err)
	} else {
		s.publishRoomMessage(ctx, room, escalateMsg, db.AgentTaskQueue{})
		escalateTitle := targetName + " 升级介入"
		if action.EscalateReason != "" {
			escalateTitle = action.EscalateReason
		}
		s.recordLabeledWorkflowFlowEvent(ctx, room, inv, "manager_escalate", escalateTitle, map[string]string{
			"target_agent_id":   util.UUIDToString(targetID),
			"target_agent_name": targetName,
			"reason":            action.EscalateReason,
		})
	}

	msg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: inv.MessageID, RoomID: room.ID,
	})
	if err != nil {
		return err
	}

	_, err = s.dispatchRoomWorkflowInvocation(ctx, dispatchWorkflowInvocationParams{
		Room: room, Message: msg, AgentID: targetID,
		Intent: "execute", MaxDepth: RoomMaxChainDepth(room),
		TimeoutAt:          time.Now().Add(30 * time.Minute),
		ParentInvocationID: inv.ID,
		TopicID:            topicID,
	})
	if err != nil {
		slog.Warn("workflow escalate: dispatch failed", "agent_id", util.UUIDToString(targetID), "error", err)
		return err
	}
	s.RefreshRoomSnapshot(ctx, room.ID)
	return nil
}

// tryResolveRouteFromText is a last-resort fallback that scans the manager's
// free-text output for routing patterns ("路由给 XXX", "@XXX", "dispatch to XXX")
// and resolves the agent name against the room member list.
func (s *TaskService) tryResolveRouteFromText(
	ctx context.Context,
	room db.Room,
	output string,
) (WorkflowAction, bool) {
	if output == "" {
		return WorkflowAction{}, false
	}

	// Build name→ID map from room agent members.
	members, err := s.Queries.ListRoomMembers(ctx, room.ID)
	if err != nil || len(members) == 0 {
		return WorkflowAction{}, false
	}
	nameToID := make(map[string]string, len(members))
	for _, m := range members {
		if m.PrincipalType != "agent" || m.Role == "manager" {
			continue
		}
		ag, agErr := s.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
			ID: m.PrincipalID, WorkspaceID: room.WorkspaceID,
		})
		if agErr != nil {
			continue
		}
		nameToID[ag.Name] = util.UUIDToString(m.PrincipalID)
	}
	if len(nameToID) == 0 {
		return WorkflowAction{}, false
	}

	// Try common routing patterns against known agent names.
	for name, id := range nameToID {
		patterns := []string{
			"路由给 " + name,
			"路由给" + name,
			"route to " + name,
			"dispatch to " + name,
			"@" + name,
			"**" + name + "**",
		}
		for _, p := range patterns {
			if strings.Contains(output, p) {
				slog.Info("room workflow: resolved route from text fallback",
					"agent_name", name, "agent_id", id,
				)
				return WorkflowAction{
					Action:  "route_to",
					RouteTo: id,
					Title:   "auto-resolved from text: " + name,
				}, true
			}
		}
	}
	return WorkflowAction{}, false
}

// agentRecentlyHandled checks if the target agent already has an active or
// recently succeeded invocation linked to the same trigger message.
// Failed invocations are ignored so the Manager can re-route for retry.
func (s *TaskService) agentRecentlyHandled(
	ctx context.Context,
	room db.Room,
	agentID pgtype.UUID,
	messageID pgtype.UUID,
) bool {
	invs, err := s.Queries.ListRoomMentionInvocations(ctx, room.ID)
	if err != nil {
		return false
	}
	for _, inv := range invs {
		if inv.TargetID.Bytes != agentID.Bytes {
			continue
		}
		if inv.MessageID.Bytes != messageID.Bytes {
			continue
		}
		switch inv.Status {
		case "pending", "queued", "running", "delivered", "succeeded":
			return true
			// "failed" and "cancelled" — allow re-routing for retry.
		}
	}
	return false
}
