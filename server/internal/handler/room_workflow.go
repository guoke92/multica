package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func (h *Handler) ListRoomDeliveries(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, "deliveries API removed; use GET /rooms/:id/graph")
}

func (h *Handler) ListRoomDeliveryTopics(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, "delivery topics API removed; use GET /rooms/:id/graph")
}

func (h *Handler) GetRoomWorkboard(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, "workboard API removed; use GET /rooms/:id/graph")
}

func (h *Handler) ListRoomTopics(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	if _, _, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID); !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"topics": []any{}})
}

func (h *Handler) ListRoomFlowEvents(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, "flow events API removed; use GET /rooms/:id/graph")
}

func (h *Handler) DecideRoomHumanAction(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, "human actions API removed; use room graph assignments")
}

func (h *Handler) PatchRoomMessageCard(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	messageID := chi.URLParam(r, "messageId")
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	if !roomMemberCanManage(member) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	msgUUID, ok := parseUUIDOrBadRequest(w, messageID, "message id")
	if !ok {
		return
	}
	var req struct {
		Metadata json.RawMessage `json:"metadata"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Metadata) == 0 {
		writeError(w, http.StatusBadRequest, "metadata is required")
		return
	}
	if err := h.Queries.UpdateRoomMessageMetadata(r.Context(), db.UpdateRoomMessageMetadataParams{
		ID: msgUUID, Metadata: req.Metadata,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update card")
		return
	}
	msg, err := h.Queries.GetRoomMessageInRoom(r.Context(), db.GetRoomMessageInRoomParams{
		ID: msgUUID, RoomID: room.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	h.TaskService.RefreshRoomSnapshot(r.Context(), room.ID)
	h.publishRoom(protocol.EventRoomMessage, workspaceID, "system", "", map[string]any{
		"room_id":    uuidToString(room.ID),
		"message_id": uuidToString(msg.ID),
	})
	writeJSON(w, http.StatusOK, map[string]string{"message_id": uuidToString(msg.ID)})
}
