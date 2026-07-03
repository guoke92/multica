package service

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// shouldBlockManagerRelay prevents the manager from relaying work back to the same agent
// or creating duplicate relay assignments with the same reason.
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

// exceedsAgentChainDepth caps agent-to-agent @ chains to prevent runaway loops.
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
