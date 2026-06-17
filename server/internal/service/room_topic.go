package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func topicTitleFromContent(content string) string {
	content = strings.TrimSpace(content)
	runes := []rune(content)
	if len(runes) > 40 {
		content = string(runes[:40]) + "…"
	}
	if content == "" {
		return "新话题"
	}
	return content
}

// ensureTopicForMessage resolves an existing compressed-stage topic for a room
// message. Flow events must not depend on a topic existing; Topic is a later
// compression/projection, not the source of truth.
func (s *TaskService) ensureTopicForMessage(ctx context.Context, room db.Room, messageID pgtype.UUID) pgtype.UUID {
	if !messageID.Valid {
		return pgtype.UUID{}
	}
	msg, err := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: messageID, RoomID: room.ID,
	})
	if err != nil {
		return pgtype.UUID{}
	}
	if msg.TopicID.Valid {
		return msg.TopicID
	}
	if msg.QuoteMessageID.Valid {
		parent, perr := s.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
			ID: msg.QuoteMessageID, RoomID: room.ID,
		})
		if perr == nil && parent.TopicID.Valid {
			_ = s.Queries.UpdateRoomMessageTopicID(ctx, db.UpdateRoomMessageTopicIDParams{
				ID: msg.ID, TopicID: parent.TopicID, RoomID: room.ID,
			})
			_ = s.TouchRoomTopicLastMessage(ctx, parent.TopicID, msg.ID)
			return parent.TopicID
		}
	}
	return pgtype.UUID{}
}

// repairRoomTopicsIfEmpty is intentionally a no-op. The event graph model does
// not create topics eagerly; topics are produced only by phase compression.
func (s *TaskService) repairRoomTopicsIfEmpty(ctx context.Context, room db.Room) {
	_ = ctx
	_ = room
}

func (s *TaskService) backfillInvocationFlowEvents(ctx context.Context, room db.Room, topicID pgtype.UUID) {
	invs, err := s.Queries.ListRoomMentionInvocations(ctx, room.ID)
	if err != nil {
		return
	}
	for i := len(invs) - 1; i >= 0; i-- {
		inv := invs[i]
		if inv.Intent != "execute" {
			continue
		}
		eventType := invocationStatusFlowEventType(inv.Status)
		if eventType == "" || eventType == "invocation_pending" || eventType == "invocation_queued" || eventType == "invocation_running" {
			continue
		}
		agentName := s.resolveAgentName(ctx, inv.TargetID)
		if agentName == "" {
			agentName = "Agent"
		}
		label := agentName + " · "
		switch eventType {
		case "invocation_succeeded":
			label += "完成"
		case "invocation_failed":
			label += "失败"
		case "invocation_timed_out":
			label += "超时"
		case "invocation_cancelled":
			label += "已取消"
		default:
			continue
		}
		payload, _ := json.Marshal(map[string]string{"label": label, "status": inv.Status})
		actorType := "agent"
		actorID := inv.TargetID
		s.RecordRoomFlowEvent(ctx, room, db.InsertRoomFlowEventParams{
			RoomID:       room.ID,
			TopicID:      topicID,
			Type:         eventType,
			MessageID:    inv.MessageID,
			InvocationID: inv.ID,
			ActorType:    actorType,
			ActorID:      actorID,
			Payload:      payload,
		})
	}
}
