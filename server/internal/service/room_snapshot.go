package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type roomTopicSummaryJSON struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Status        string `json:"status"`
	RootMessageID string `json:"root_message_id,omitempty"`
	LastMessageID string `json:"last_message_id,omitempty"`
	EventCount    int    `json:"event_count"`
	UpdatedAt     string `json:"updated_at"`
}

func (s *TaskService) buildRoomSnapshotJSON(ctx context.Context, room db.Room, counts db.CountInvocationStatusByRoomRow) []byte {
	base := map[string]any{}
	if len(room.Snapshot) > 0 {
		_ = json.Unmarshal(room.Snapshot, &base)
	}
	pendingCount := int(counts.PendingCount)
	if humanPending, err := s.Queries.CountPendingRoomHumanActions(ctx, room.ID); err == nil {
		pendingCount = int(humanPending)
	}
	base["pending_count"] = pendingCount
	base["queued_count"] = int(counts.QueuedCount)
	base["running_count"] = int(counts.RunningCount)
	base["failed_count"] = int(counts.FailedCount)
	base["timed_out_count"] = int(counts.TimedOutCount)

	summaries, activeTopicID := s.listTopicSummariesForSnapshot(ctx, room.ID)
	if len(summaries) > 0 {
		base["topic_summaries"] = summaries
		base["compressed_topics"] = summaries
	}
	if activeTopicID != "" {
		base["active_topic_id"] = activeTopicID
		base["active_graph_id"] = activeTopicID
	}
	if eventID, err := s.Queries.GetLatestRoomFlowEventID(ctx, room.ID); err == nil && eventID.Valid {
		base["latest_event_id"] = util.UUIDToString(eventID)
	}

	b, err := json.Marshal(base)
	if err != nil {
		return jsonMarshalRoomSnapshot(counts)
	}
	return b
}

func (s *TaskService) listTopicSummariesForSnapshot(ctx context.Context, roomID pgtype.UUID) ([]roomTopicSummaryJSON, string) {
	rows, err := s.Queries.ListRoomTopicSummaries(ctx, db.ListRoomTopicSummariesParams{
		RoomID: roomID,
		Limit:  20,
	})
	if err != nil {
		return nil, ""
	}
	out := make([]roomTopicSummaryJSON, 0, len(rows))
	var activeTopicID string
	for _, row := range rows {
		item := roomTopicSummaryJSON{
			ID:         util.UUIDToString(row.ID),
			Title:      row.Title,
			Status:     row.Status,
			EventCount: int(row.EventCount),
			UpdatedAt:  row.UpdatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		}
		if row.RootMessageID.Valid {
			item.RootMessageID = util.UUIDToString(row.RootMessageID)
		}
		if row.LastMessageID.Valid {
			item.LastMessageID = util.UUIDToString(row.LastMessageID)
		}
		out = append(out, item)
		if activeTopicID == "" && isActiveTopicStatus(row.Status) {
			activeTopicID = item.ID
		}
	}
	return out, activeTopicID
}

func isActiveTopicStatus(status string) bool {
	switch status {
	case "open", "in_progress", "closing", "pending":
		return true
	default:
		return false
	}
}

// ActiveRoomTopicContext is the topic-first replacement for GetActiveRoomDelivery.
type ActiveRoomTopicContext struct {
	Topic           db.RoomTopic
	DeliveryID      pgtype.UUID
	AnchorMessageID pgtype.UUID
}

func (s *TaskService) resolveActiveRoomTopicContext(ctx context.Context, roomID pgtype.UUID) (ActiveRoomTopicContext, bool) {
	_, activeTopicID := s.listTopicSummariesForSnapshot(ctx, roomID)
	if activeTopicID == "" {
		rows, err := s.Queries.ListRoomTopicsByRoom(ctx, db.ListRoomTopicsByRoomParams{
			RoomID: roomID,
			Limit:  1,
		})
		if err != nil || len(rows) == 0 {
			return ActiveRoomTopicContext{}, false
		}
		activeTopicID = util.UUIDToString(rows[0].ID)
	}
	topic, err := s.Queries.GetRoomTopic(ctx, util.MustParseUUID(activeTopicID))
	if err != nil {
		return ActiveRoomTopicContext{}, false
	}
	out := ActiveRoomTopicContext{Topic: topic}
	if topic.DeliveryID.Valid {
		out.DeliveryID = topic.DeliveryID
	}
	if topic.RootMessageID.Valid {
		out.AnchorMessageID = topic.RootMessageID
	} else if topic.DeliveryID.Valid {
		if delivery, derr := s.Queries.GetRoomDelivery(ctx, topic.DeliveryID); derr == nil && delivery.AnchorMessageID.Valid {
			out.AnchorMessageID = delivery.AnchorMessageID
		}
	}
	return out, true
}

func (s *TaskService) publishRoomSnapshotUpdated(ctx context.Context, room db.Room) {
	if s.Bus == nil {
		return
	}
	var snap map[string]any
	if len(room.Snapshot) > 0 {
		_ = json.Unmarshal(room.Snapshot, &snap)
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomSnapshotUpdated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		Payload: map[string]any{
			"room_id":  util.UUIDToString(room.ID),
			"snapshot": snap,
		},
	})
}

func (s *TaskService) publishRoomFlowEventCreated(ctx context.Context, room db.Room, event db.RoomFlowEvent) {
	if s.Bus == nil {
		return
	}
	payload := map[string]any{
		"room_id":    util.UUIDToString(room.ID),
		"event_id":   util.UUIDToString(event.ID),
		"category":   event.Category,
		"type":       event.Type,
		"created_at": event.CreatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
	}
	if event.TopicID.Valid {
		payload["topic_id"] = util.UUIDToString(event.TopicID)
	}
	if event.StepID.Valid {
		payload["step_id"] = event.StepID.String
	}
	if event.FromMessageID.Valid {
		payload["from_message_id"] = util.UUIDToString(event.FromMessageID)
	}
	if event.ToMessageID.Valid {
		payload["to_message_id"] = util.UUIDToString(event.ToMessageID)
	}
	if event.MessageID.Valid {
		payload["message_id"] = util.UUIDToString(event.MessageID)
	}
	if event.InvocationID.Valid {
		payload["invocation_id"] = util.UUIDToString(event.InvocationID)
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomFlowEventCreated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		Payload:     payload,
	})
}

func (s *TaskService) RecordRoomFlowEvent(ctx context.Context, room db.Room, params db.InsertRoomFlowEventParams) {
	if !params.ID.Valid {
		id, err := util.NewUUIDv7()
		if err != nil {
			return
		}
		params.ID = id
	}
	params = normalizeRoomFlowEventParams(params)
	event, err := s.Queries.InsertRoomFlowEvent(ctx, params)
	if err != nil {
		return
	}
	if params.TopicID.Valid {
		_, _ = s.Queries.IncrementRoomTopicEventCount(ctx, params.TopicID)
	}
	if params.TopicID.Valid && params.MessageID.Valid {
		_ = s.TouchRoomTopicLastMessage(ctx, params.TopicID, params.MessageID)
	}
	s.publishRoomFlowEventCreated(ctx, room, event)
	s.patchSnapshotLatestEventID(ctx, room.ID, event.ID)
}

func normalizeRoomFlowEventParams(params db.InsertRoomFlowEventParams) db.InsertRoomFlowEventParams {
	if !params.Category.Valid {
		params.Category = pgtype.Text{String: inferRoomFlowEventCategory(params.Type), Valid: true}
	}
	if !params.StepID.Valid {
		if stepID := inferRoomFlowEventStepID(params.Type, params.MessageID, params.InvocationID); stepID != "" {
			params.StepID = pgtype.Text{String: stepID, Valid: true}
		}
	}
	if !params.FromMessageID.Valid && params.MessageID.Valid {
		params.FromMessageID = params.MessageID
	}
	return params
}

func inferRoomFlowEventCategory(eventType string) string {
	switch {
	case strings.HasPrefix(eventType, "invocation_"), eventType == "user_intent":
		return "message"
	case strings.HasPrefix(eventType, "human_confirm_"), strings.HasPrefix(eventType, "approval_"):
		return "confirm"
	case strings.HasPrefix(eventType, "topic_"):
		return "phase"
	case eventType == "notification_sent", eventType == "todo_created":
		return "meta"
	default:
		return "control"
	}
}

func inferRoomFlowEventStepID(eventType string, messageID, invocationID pgtype.UUID) string {
	var prefix string
	switch {
	case strings.HasPrefix(eventType, "manager_route"):
		prefix = "route"
	case strings.HasPrefix(eventType, "manager_relay"), eventType == "agent_at":
		prefix = "relay"
	case strings.HasPrefix(eventType, "manager_retry"):
		prefix = "retry"
	case strings.HasPrefix(eventType, "manager_escalate"):
		prefix = "escalate"
	case strings.HasPrefix(eventType, "human_confirm_"):
		prefix = "confirm"
	case strings.HasPrefix(eventType, "approval_"):
		prefix = "approval"
	default:
		return ""
	}
	if invocationID.Valid {
		return prefix + ":" + util.UUIDToString(invocationID)
	}
	if messageID.Valid {
		return prefix + ":" + util.UUIDToString(messageID)
	}
	return prefix
}

func (s *TaskService) TouchRoomTopicLastMessage(ctx context.Context, topicID, messageID pgtype.UUID) error {
	_, err := s.Queries.UpdateRoomTopicLastMessage(ctx, db.UpdateRoomTopicLastMessageParams{
		ID: topicID, LastMessageID: messageID,
	})
	return err
}

func (s *TaskService) patchSnapshotLatestEventID(ctx context.Context, roomID, eventID pgtype.UUID) {
	counts, err := s.Queries.CountInvocationStatusByRoom(ctx, roomID)
	if err != nil {
		return
	}
	room, roomErr := s.Queries.GetRoom(ctx, roomID)
	if roomErr != nil {
		return
	}
	snap := s.buildRoomSnapshotJSON(ctx, room, counts)
	var base map[string]any
	_ = json.Unmarshal(snap, &base)
	base["latest_event_id"] = util.UUIDToString(eventID)
	if b, err := json.Marshal(base); err == nil {
		snap = b
	}
	_ = s.Queries.UpdateRoomSnapshot(ctx, db.UpdateRoomSnapshotParams{ID: roomID, Snapshot: snap})
	room.Snapshot = snap
	s.publishRoomSnapshotUpdated(ctx, room)
}

func (s *TaskService) refreshSnapshotLatestEventID(ctx context.Context, roomID pgtype.UUID) {
	eventID, err := s.Queries.GetLatestRoomFlowEventID(ctx, roomID)
	if err != nil || !eventID.Valid {
		return
	}
	s.patchSnapshotLatestEventID(ctx, roomID, eventID)
}

func invocationStatusFlowEventType(status string) string {
	switch status {
	case "pending":
		return "invocation_pending"
	case "queued":
		return "invocation_queued"
	case "running":
		return "invocation_running"
	case "succeeded":
		return "invocation_succeeded"
	case "failed":
		return "invocation_failed"
	case "timed_out":
		return "invocation_timed_out"
	case "cancelled":
		return "invocation_cancelled"
	default:
		return ""
	}
}

func invocationStatusDisplayToken(status string) string {
	switch status {
	case "pending":
		return "待调度"
	case "queued":
		return "排队中"
	case "running":
		return "思考中"
	case "succeeded":
		return "完成"
	case "failed":
		return "失败"
	case "timed_out":
		return "超时"
	case "cancelled":
		return "已取消"
	default:
		return ""
	}
}

func (s *TaskService) resolveFlowEventTopicID(ctx context.Context, roomID pgtype.UUID, inv db.MentionInvocation) pgtype.UUID {
	if inv.TopicID.Valid {
		return inv.TopicID
	}
	msg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: inv.MessageID, RoomID: roomID,
	})
	if err == nil && msg.TopicID.Valid {
		return msg.TopicID
	}
	return pgtype.UUID{}
}

func (s *TaskService) RecordInvocationFlowEvent(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	eventType, actorType string,
	actorID pgtype.UUID,
	payload map[string]any,
) {
	topicID := s.resolveFlowEventTopicID(ctx, room.ID, inv)
	payloadBytes := []byte("{}")
	if len(payload) > 0 {
		if b, err := json.Marshal(payload); err == nil {
			payloadBytes = b
		}
	}
	s.RecordRoomFlowEvent(ctx, room, db.InsertRoomFlowEventParams{
		RoomID:       room.ID,
		TopicID:      topicID,
		Category:     pgtype.Text{String: "message", Valid: true},
		Type:         eventType,
		MessageID:    inv.MessageID,
		InvocationID: inv.ID,
		ActorType:    actorType,
		ActorID:      actorID,
		Payload:      payloadBytes,
	})
}

func (s *TaskService) MaybeRecordInvocationStatusFlowEvent(ctx context.Context, room db.Room, inv db.MentionInvocation, newStatus string) {
	eventType := invocationStatusFlowEventType(newStatus)
	if eventType == "" {
		return
	}
	actorType := "system"
	var actorID pgtype.UUID
	if inv.TargetType == "agent" && inv.TargetID.Valid {
		actorType = "agent"
		actorID = inv.TargetID
	}
	payload := map[string]any{"status": newStatus}
	if inv.TargetType == "agent" && inv.TargetID.Valid {
		agentName := s.resolveAgentName(ctx, inv.TargetID)
		if agentName == "" {
			agentName = "Agent"
		}
		payload["agent_name"] = agentName
		payload["target_agent_id"] = util.UUIDToString(inv.TargetID)
		if token := invocationStatusDisplayToken(newStatus); token != "" {
			payload["label"] = agentName + " · " + token
		}
	}
	if inv.FailureReason.Valid {
		payload["failure_reason"] = inv.FailureReason.String
	}
	s.RecordInvocationFlowEvent(ctx, room, inv, eventType, actorType, actorID, payload)
}

func (s *TaskService) resolveUserDisplayName(ctx context.Context, userID pgtype.UUID) string {
	if user, err := s.Queries.GetUser(ctx, userID); err == nil {
		if name := strings.TrimSpace(user.Name); name != "" {
			return name
		}
	}
	return "用户"
}

func (s *TaskService) resolveInvocationAgentName(ctx context.Context, inv db.MentionInvocation) string {
	if inv.TargetType != "agent" || !inv.TargetID.Valid {
		return "Agent"
	}
	name := s.resolveAgentName(ctx, inv.TargetID)
	if name == "" {
		return "Agent"
	}
	return name
}

// RecordManualInvocationCancelFlowEvent records a user-initiated stop on an agent invocation.
func (s *TaskService) RecordManualInvocationCancelFlowEvent(ctx context.Context, room db.Room, inv db.MentionInvocation, userID pgtype.UUID) {
	actorName := s.resolveUserDisplayName(ctx, userID)
	agentName := s.resolveInvocationAgentName(ctx, inv)
	payload := map[string]any{
		"label":           actorName + " · 手动取消",
		"agent_name":      agentName,
		"manual_cancel":   true,
		"target_agent_id": util.UUIDToString(inv.TargetID),
	}
	s.RecordInvocationFlowEvent(ctx, room, inv, "invocation_manual_cancel", "user", userID, payload)
}

// RecordManualInvocationRetryFlowEvent records a user-initiated retry on an agent invocation.
func (s *TaskService) RecordManualInvocationRetryFlowEvent(ctx context.Context, room db.Room, inv db.MentionInvocation, userID pgtype.UUID) {
	actorName := s.resolveUserDisplayName(ctx, userID)
	agentName := s.resolveInvocationAgentName(ctx, inv)
	payload := map[string]any{
		"label":           actorName + " · 手动重试",
		"agent_name":      agentName,
		"manual_retry":    true,
		"target_agent_id": util.UUIDToString(inv.TargetID),
	}
	s.RecordInvocationFlowEvent(ctx, room, inv, "invocation_manual_retry", "user", userID, payload)
}

func (s *TaskService) RecordUserMessageFlowEvent(ctx context.Context, room db.Room, msg db.RoomMessage, userID pgtype.UUID) {
	senderName := s.resolveUserDisplayName(ctx, userID)
	preview := strings.TrimSpace(msg.Content)
	if runes := []rune(preview); len(runes) > 48 {
		preview = string(runes[:48]) + "…"
	}
	payload, err := json.Marshal(map[string]string{
		"label":       senderName + " · 发送消息",
		"preview":     preview,
		"sender_name": senderName,
	})
	if err != nil {
		payload = []byte("{}")
	}
	s.RecordRoomFlowEvent(ctx, room, db.InsertRoomFlowEventParams{
		RoomID:    room.ID,
		Type:      "user_intent",
		MessageID: msg.ID,
		ActorType: "user",
		ActorID:   userID,
		Payload:   payload,
	})
}

// recordLabeledWorkflowFlowEvent appends a topic flow event with a human-readable label (v2.3).
func (s *TaskService) recordLabeledWorkflowFlowEvent(
	ctx context.Context,
	room db.Room,
	inv db.MentionInvocation,
	eventType string,
	label string,
	extra map[string]string,
) {
	topicID := s.resolveFlowEventTopicID(ctx, room.ID, inv)
	payload := map[string]any{"label": label}
	for k, v := range extra {
		payload[k] = v
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		payloadBytes = []byte("{}")
	}
	actorType := "agent"
	actorID := room.ManagerAgentID
	if !actorID.Valid && inv.TargetType == "agent" && inv.TargetID.Valid {
		actorID = inv.TargetID
	}
	s.RecordRoomFlowEvent(ctx, room, db.InsertRoomFlowEventParams{
		RoomID:       room.ID,
		TopicID:      topicID,
		Category:     pgtype.Text{String: inferRoomFlowEventCategory(eventType), Valid: true},
		Type:         eventType,
		MessageID:    inv.MessageID,
		InvocationID: inv.ID,
		ActorType:    actorType,
		ActorID:      actorID,
		Payload:      payloadBytes,
	})
}
