package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func (s *TaskService) mergeRoomProgressSnapshot(ctx context.Context, roomID pgtype.UUID, items []map[string]string) {
	room, err := s.Queries.GetRoom(ctx, roomID)
	if err != nil {
		return
	}
	snap := map[string]any{}
	if len(room.Snapshot) > 0 {
		_ = json.Unmarshal(room.Snapshot, &snap)
	}
	snap["progress_items"] = items
	snap["progress_updated_at"] = time.Now().UTC().Format(time.RFC3339)
	b, err := json.Marshal(snap)
	if err != nil {
		return
	}
	_ = s.Queries.UpdateRoomSnapshot(ctx, db.UpdateRoomSnapshotParams{
		ID: roomID, Snapshot: b,
	})
}

// MaybeTriggerManagerProgressScan enqueues a manager review when work finished
// and nothing is actively running, so the user does not need to ask for status.
func (s *TaskService) MaybeTriggerManagerProgressScan(ctx context.Context, room db.Room) {
	if !room.ManagerAgentID.Valid {
		return
	}
	invocations, err := s.Queries.ListRoomMentionInvocations(ctx, room.ID)
	if err != nil {
		return
	}
	hasActive := false
	hasManagerActive := false
	for _, inv := range invocations {
		switch inv.Status {
		case "pending", "queued", "running", "delivered":
			hasActive = true
			if inv.TargetType == "agent" && inv.TargetID.Bytes == room.ManagerAgentID.Bytes {
				hasManagerActive = true
			}
		}
	}
	if hasActive || hasManagerActive {
		return
	}
	activeTopic, ok := s.resolveActiveRoomTopicContext(ctx, room.ID)
	if !ok || !activeTopic.AnchorMessageID.Valid {
		return
	}
	msg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: activeTopic.AnchorMessageID, RoomID: room.ID,
	})
	if err != nil {
		return
	}
	_, err = s.dispatchRoomWorkflowInvocation(ctx, dispatchWorkflowInvocationParams{
		Room: room, Message: msg, AgentID: room.ManagerAgentID,
		Intent: "review", MaxDepth: RoomMaxChainDepth(room),
		TimeoutAt:  time.Now().Add(30 * time.Minute),
		DeliveryID: activeTopic.DeliveryID,
		TopicID:    activeTopic.Topic.ID,
	})
	if err != nil {
		slog.Warn("manager progress scan failed",
			"room_id", util.UUIDToString(room.ID),
			"error", err,
		)
	}
}
