package service

import (
	"context"
)

// RouteRoomMessage dispatches room messages via the room graph model.
// Kept as a thin alias for handler compatibility.
func (s *TaskService) RouteRoomMessageLegacy(ctx context.Context, p RoomMentionDispatchParams) (RoomGraphProcessResult, error) {
	return s.RouteRoomMessage(ctx, p)
}
