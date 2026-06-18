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

func (s *TaskService) buildRoomSnapshotJSON(ctx context.Context, room db.Room, counts db.CountRoomAssignmentStatusByRoomRow) []byte {
	base := map[string]any{}
	if len(room.Snapshot) > 0 {
		_ = json.Unmarshal(room.Snapshot, &base)
	}
	base["pending_count"] = int(counts.PendingCount)
	base["blocked_count"] = int(counts.BlockedCount)
	base["queued_count"] = 0
	base["running_count"] = int(counts.RunningCount)
	base["failed_count"] = int(counts.FailedCount)
	base["completed_count"] = int(counts.CompletedCount)

	events, _ := s.Queries.ListRoomInvocationEventsByRoom(ctx, db.ListRoomInvocationEventsByRoomParams{
		RoomID: room.ID, Limit: 1,
	})
	if len(events) > 0 {
		base["latest_event_id"] = util.UUIDToString(events[0].ID)
	}

	b, err := json.Marshal(base)
	if err != nil {
		return jsonMarshalAssignmentSnapshot(counts)
	}
	return b
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

func (s *TaskService) RefreshRoomSnapshot(ctx context.Context, roomID pgtype.UUID) {
	counts, err := s.Queries.CountRoomAssignmentStatusByRoom(ctx, roomID)
	if err != nil {
		return
	}
	room, roomErr := s.Queries.GetRoom(ctx, roomID)
	var snap []byte
	if roomErr == nil {
		snap = s.buildRoomSnapshotJSON(ctx, room, counts)
	} else {
		snap = jsonMarshalAssignmentSnapshot(counts)
	}
	_ = s.Queries.UpdateRoomSnapshot(ctx, db.UpdateRoomSnapshotParams{
		ID: roomID, Snapshot: snap,
	})
	if roomErr == nil {
		room.Snapshot = snap
		s.publishRoomSnapshotUpdated(ctx, room)
	}
}

func jsonMarshalAssignmentSnapshot(c db.CountRoomAssignmentStatusByRoomRow) []byte {
	payload := map[string]int{
		"pending_count":   int(c.PendingCount),
		"blocked_count":   int(c.BlockedCount),
		"running_count":   int(c.RunningCount),
		"failed_count":    int(c.FailedCount),
		"completed_count": int(c.CompletedCount),
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return []byte("{}")
	}
	return b
}

func (s *TaskService) RecordUserMessageFlowEvent(ctx context.Context, room db.Room, msg db.RoomMessage, userID pgtype.UUID) {
	senderName := s.resolveUserDisplayName(ctx, userID)
	preview := msg.Content
	if runes := []rune(preview); len(runes) > 48 {
		preview = string(runes[:48]) + "…"
	}
	// User messages don't create assignments in the event log until processed;
	// append a lightweight meta event on a synthetic assignment is skipped.
	_ = senderName
	_ = preview
}

func (s *TaskService) resolveUserDisplayName(ctx context.Context, userID pgtype.UUID) string {
	if user, err := s.Queries.GetUser(ctx, userID); err == nil {
		if name := user.Name; name != "" {
			return name
		}
	}
	return "用户"
}

func (s *TaskService) resolveAgentName(ctx context.Context, agentID pgtype.UUID) string {
	if agent, err := s.Queries.GetAgent(ctx, agentID); err == nil {
		return agent.Name
	}
	return ""
}
