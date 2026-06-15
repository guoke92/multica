package service

import (
	"context"
	"encoding/json"

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
	base["pending_count"] = int(counts.PendingCount)
	base["queued_count"] = int(counts.QueuedCount)
	base["running_count"] = int(counts.RunningCount)
	base["failed_count"] = int(counts.FailedCount)
	base["timed_out_count"] = int(counts.TimedOutCount)

	summaries, activeTopicID := s.listTopicSummariesForSnapshot(ctx, room.ID)
	if len(summaries) > 0 {
		base["topic_summaries"] = summaries
	}
	if activeTopicID != "" {
		base["active_topic_id"] = activeTopicID
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
		"topic_id":   util.UUIDToString(event.TopicID),
		"event_id":   util.UUIDToString(event.ID),
		"type":       event.Type,
		"created_at": event.CreatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
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
	event, err := s.Queries.InsertRoomFlowEvent(ctx, params)
	if err != nil {
		return
	}
	_, _ = s.Queries.IncrementRoomTopicEventCount(ctx, params.TopicID)
	if params.MessageID.Valid {
		_ = s.TouchRoomTopicLastMessage(ctx, params.TopicID, params.MessageID)
	}
	s.publishRoomFlowEventCreated(ctx, room, event)
	s.patchSnapshotLatestEventID(ctx, room.ID, event.ID)
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
	rows, err := s.Queries.ListRoomTopicsByRoom(ctx, db.ListRoomTopicsByRoomParams{
		RoomID: roomID,
		Limit:  1,
	})
	if err == nil && len(rows) > 0 {
		return rows[0].ID
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
	if !topicID.Valid {
		return
	}
	payloadBytes := []byte("{}")
	if len(payload) > 0 {
		if b, err := json.Marshal(payload); err == nil {
			payloadBytes = b
		}
	}
	s.RecordRoomFlowEvent(ctx, room, db.InsertRoomFlowEventParams{
		RoomID:       room.ID,
		TopicID:      topicID,
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
	if inv.FailureReason.Valid {
		payload["failure_reason"] = inv.FailureReason.String
	}
	s.RecordInvocationFlowEvent(ctx, room, inv, eventType, actorType, actorID, payload)
}
