package handler

import (
	"context"
	"net/http"

	"github.com/multica-ai/multica/server/internal/util"
)

const roomManagerIssueMutationForbidden = "room manager agents cannot create or update issues"

// rejectIfRoomManagerAgentMutatesIssue blocks Issue create/update when the
// caller is a collaboration-room manager agent (orchestration-only role).
func (h *Handler) rejectIfRoomManagerAgentMutatesIssue(
	w http.ResponseWriter,
	r *http.Request,
	actorType, actorID string,
) bool {
	if actorType != "agent" || actorID == "" {
		return false
	}
	if h.isRoomManagerAgent(r.Context(), actorID) {
		writeError(w, http.StatusForbidden, roomManagerIssueMutationForbidden)
		return true
	}
	return false
}

func (h *Handler) isRoomManagerAgent(ctx context.Context, agentID string) bool {
	agentUUID, err := util.ParseUUID(agentID)
	if err != nil {
		return false
	}
	isManager, err := h.Queries.IsRoomManagerAgent(ctx, agentUUID)
	if err != nil {
		return true
	}
	return isManager
}
