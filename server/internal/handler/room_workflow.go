package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
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
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	room, _, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	h.TaskService.RefreshRoomSnapshot(r.Context(), room.ID)
	room, _ = h.Queries.GetRoom(r.Context(), room.ID)

	resp := map[string]any{
		"pending_count":   0,
		"blocked_count":   0,
		"running_count":   0,
		"failed_count":    0,
		"completed_count": 0,
	}
	if len(room.Snapshot) > 0 {
		var snap map[string]any
		if err := json.Unmarshal(room.Snapshot, &snap); err == nil {
			for _, key := range []string{
				"pending_count", "blocked_count", "running_count",
				"failed_count", "completed_count", "latest_event_id",
			} {
				if v, ok := snap[key]; ok {
					resp[key] = v
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, resp)
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
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	room, _, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	limit := int32(50)
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = int32(n)
		}
	}
	var before pgtype.UUID
	if b := r.URL.Query().Get("before"); b != "" {
		var ok bool
		before, ok = parseUUIDOrBadRequest(w, b, "before")
		if !ok {
			return
		}
	}
	assignmentID := chi.URLParam(r, "topicId")
	var rows []db.RoomInvocationEvent
	var err error
	if assignmentID != "" {
		assignmentUUID, ok := parseUUIDOrBadRequest(w, assignmentID, "assignment id")
		if !ok {
			return
		}
		rows, err = h.Queries.ListRoomInvocationEventsByAssignment(r.Context(), assignmentUUID)
	} else {
		rows, err = h.Queries.ListRoomInvocationEventsByRoom(r.Context(), db.ListRoomInvocationEventsByRoomParams{
			RoomID:   room.ID,
			BeforeID: before,
			Limit:    limit,
		})
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list invocation events")
		return
	}
	type flowEventResp struct {
		ID           string          `json:"id"`
		RoomID       string          `json:"room_id"`
		AssignmentID string          `json:"assignment_id"`
		InvocationID *string         `json:"invocation_id,omitempty"`
		Type         string          `json:"type"`
		ActorType    string          `json:"actor_type"`
		ActorID      *string         `json:"actor_id,omitempty"`
		Payload      json.RawMessage `json:"payload"`
		CreatedAt    string          `json:"created_at"`
	}
	out := make([]flowEventResp, 0, len(rows))
	for _, e := range rows {
		item := flowEventResp{
			ID:           uuidToString(e.ID),
			RoomID:       uuidToString(e.RoomID),
			AssignmentID: uuidToString(e.AssignmentID),
			Type:         e.Type,
			ActorType:    e.ActorType,
			CreatedAt:    timestampToString(e.CreatedAt),
		}
		if e.InvocationID.Valid {
			s := uuidToString(e.InvocationID)
			item.InvocationID = &s
		}
		if e.ActorID.Valid {
			s := uuidToString(e.ActorID)
			item.ActorID = &s
		}
		if len(e.Payload) > 0 {
			item.Payload = e.Payload
		} else {
			item.Payload = json.RawMessage("{}")
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": out})
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
