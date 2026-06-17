package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type RoomDeliveryResponse struct {
	ID               string  `json:"id"`
	RoomID           string  `json:"room_id"`
	Title            string  `json:"title"`
	Status           string  `json:"status"`
	WorkflowTemplate string  `json:"workflow_template"`
	CurrentPhase     string  `json:"current_phase"`
	CardMessageID    *string `json:"card_message_id,omitempty"`
	AnchorMessageID  *string `json:"anchor_message_id,omitempty"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

type RoomTopicResponse struct {
	ID              string  `json:"id"`
	RoomID          string  `json:"room_id"`
	DeliveryID      *string `json:"delivery_id,omitempty"`
	ParentTopicID   *string `json:"parent_topic_id,omitempty"`
	Title           string  `json:"title"`
	Status          string  `json:"status"`
	PhaseKey        string  `json:"phase_key"`
	AssigneeAgentID *string `json:"assignee_agent_id,omitempty"`
	CreatedAt       string  `json:"created_at"`
	UpdatedAt       string  `json:"updated_at"`
}

func roomDeliveryToResponse(d db.RoomDelivery) RoomDeliveryResponse {
	resp := RoomDeliveryResponse{
		ID:               uuidToString(d.ID),
		RoomID:           uuidToString(d.RoomID),
		Title:            d.Title,
		Status:           d.Status,
		WorkflowTemplate: d.WorkflowTemplate,
		CurrentPhase:     d.CurrentPhase,
		CreatedAt:        timestampToString(d.CreatedAt),
		UpdatedAt:        timestampToString(d.UpdatedAt),
	}
	if d.CardMessageID.Valid {
		s := uuidToString(d.CardMessageID)
		resp.CardMessageID = &s
	}
	if d.AnchorMessageID.Valid {
		s := uuidToString(d.AnchorMessageID)
		resp.AnchorMessageID = &s
	}
	return resp
}

func topicToResponse(t db.RoomTopic) RoomTopicResponse {
	resp := RoomTopicResponse{
		ID:        uuidToString(t.ID),
		RoomID:    uuidToString(t.RoomID),
		Title:     t.Title,
		Status:    t.Status,
		PhaseKey:  t.PhaseKey,
		CreatedAt: timestampToString(t.CreatedAt),
		UpdatedAt: timestampToString(t.UpdatedAt),
	}
	if t.DeliveryID.Valid {
		s := uuidToString(t.DeliveryID)
		resp.DeliveryID = &s
	}
	if t.ParentTopicID.Valid {
		s := uuidToString(t.ParentTopicID)
		resp.ParentTopicID = &s
	}
	if t.AssigneeAgentID.Valid {
		s := uuidToString(t.AssigneeAgentID)
		resp.AssigneeAgentID = &s
	}
	return resp
}

func (h *Handler) ListRoomDeliveries(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, "deliveries API removed; use GET /rooms/:id/topics")
}

func (h *Handler) ListRoomDeliveryTopics(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, "delivery topics API removed; use GET /rooms/:id/topics")
}

type RoomProgressItem struct {
	Title  string `json:"title"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
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
		"queued_count":    0,
		"running_count":   0,
		"failed_count":    0,
		"timed_out_count": 0,
	}
	if len(room.Snapshot) > 0 {
		var snap map[string]any
		if err := json.Unmarshal(room.Snapshot, &snap); err == nil {
			for _, key := range []string{
				"pending_count", "queued_count", "running_count",
				"failed_count", "timed_out_count", "active_topic_id",
				"topic_summaries", "latest_event_id", "progress_items",
			} {
				if v, ok := snap[key]; ok {
					resp[key] = v
				}
			}
		}
	}
	// Deprecated fields kept for older clients during transition.
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ListRoomTopics(w http.ResponseWriter, r *http.Request) {
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
	rows, err := h.Queries.ListRoomTopicsByRoom(r.Context(), db.ListRoomTopicsByRoomParams{
		RoomID: room.ID,
		Limit:  limit,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list topics")
		return
	}
	out := make([]RoomTopicResponse, 0, len(rows))
	for _, t := range rows {
		out = append(out, topicToResponse(t))
	}
	writeJSON(w, http.StatusOK, map[string]any{"topics": out})
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
	var before pgtype.Timestamptz
	if b := r.URL.Query().Get("before"); b != "" {
		if t, err := time.Parse(time.RFC3339, b); err == nil {
			before = pgtype.Timestamptz{Time: t, Valid: true}
		}
	}
	topicID := chi.URLParam(r, "topicId")
	var rows []db.RoomFlowEvent
	var err error
	if topicID != "" {
		topicUUID, ok := parseUUIDOrBadRequest(w, topicID, "topic id")
		if !ok {
			return
		}
		rows, err = h.Queries.ListRoomFlowEventsByTopic(r.Context(), db.ListRoomFlowEventsByTopicParams{
			RoomID:          room.ID,
			TopicID:         topicUUID,
			BeforeCreatedAt: before,
			Limit:           limit,
		})
	} else {
		rows, err = h.Queries.ListRoomFlowEventsByRoom(r.Context(), db.ListRoomFlowEventsByRoomParams{
			RoomID:          room.ID,
			BeforeCreatedAt: before,
			Limit:           limit,
		})
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list flow events")
		return
	}
	type flowEventResp struct {
		ID            string          `json:"id"`
		RoomID        string          `json:"room_id"`
		TopicID       *string         `json:"topic_id,omitempty"`
		Category      string          `json:"category"`
		StepID        *string         `json:"step_id,omitempty"`
		FromMessageID *string         `json:"from_message_id,omitempty"`
		ToMessageID   *string         `json:"to_message_id,omitempty"`
		Type          string          `json:"type"`
		MessageID     *string         `json:"message_id,omitempty"`
		InvocationID  *string         `json:"invocation_id,omitempty"`
		ActorType     string          `json:"actor_type"`
		ActorID       *string         `json:"actor_id,omitempty"`
		Payload       json.RawMessage `json:"payload"`
		CreatedAt     string          `json:"created_at"`
	}
	out := make([]flowEventResp, 0, len(rows))
	for _, e := range rows {
		item := flowEventResp{
			ID:        uuidToString(e.ID),
			RoomID:    uuidToString(e.RoomID),
			Category:  e.Category,
			Type:      e.Type,
			ActorType: e.ActorType,
			CreatedAt: timestampToString(e.CreatedAt),
		}
		if e.TopicID.Valid {
			s := uuidToString(e.TopicID)
			item.TopicID = &s
		}
		if e.StepID.Valid {
			s := e.StepID.String
			item.StepID = &s
		}
		if e.FromMessageID.Valid {
			s := uuidToString(e.FromMessageID)
			item.FromMessageID = &s
		}
		if e.ToMessageID.Valid {
			s := uuidToString(e.ToMessageID)
			item.ToMessageID = &s
		}
		if e.MessageID.Valid {
			s := uuidToString(e.MessageID)
			item.MessageID = &s
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
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	actionID := chi.URLParam(r, "actionId")
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	if member.Role == "guest" {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	actionUUID, ok := parseUUIDOrBadRequest(w, actionID, "action id")
	if !ok {
		return
	}
	var req struct {
		Decision     string `json:"decision"`
		RejectReason string `json:"reject_reason,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	decision := strings.ToLower(strings.TrimSpace(req.Decision))
	if decision != "approved" && decision != "rejected" {
		writeError(w, http.StatusBadRequest, "decision must be approved or rejected")
		return
	}
	status := "approved"
	if decision == "rejected" {
		status = "rejected"
		if strings.TrimSpace(req.RejectReason) == "" {
			writeError(w, http.StatusBadRequest, "reject_reason is required")
			return
		}
	}
	var reason pgtype.Text
	if status == "rejected" {
		reason = pgtype.Text{String: req.RejectReason, Valid: true}
	}
	action, err := h.Queries.DecideRoomHumanAction(r.Context(), db.DecideRoomHumanActionParams{
		ID: actionUUID, RoomID: room.ID, Status: status,
		Reason: reason, DecidedBy: parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusConflict, "action already decided or not found")
		return
	}
	h.TaskService.RefreshRoomSnapshot(r.Context(), room.ID)
	flowType := "human_confirm_accepted"
	if status == "rejected" {
		flowType = "human_confirm_rejected"
	}
	h.TaskService.RecordRoomFlowEvent(r.Context(), room, db.InsertRoomFlowEventParams{
		RoomID:       room.ID,
		TopicID:      action.TopicID,
		Type:         flowType,
		MessageID:    action.MessageID,
		InvocationID: action.InvocationID,
		ActorType:    "user",
		ActorID:      parseUUID(userID),
		Payload:      []byte(`{}`),
	})
	if status == "approved" {
		topicID := action.TopicID
		if !topicID.Valid {
			title := strings.TrimSpace(action.Title)
			if title == "" {
				title = "阶段确认"
			}
			topic, topicErr := h.Queries.CreateRoomTopic(r.Context(), db.CreateRoomTopicParams{
				RoomID:   room.ID,
				Title:    title,
				Status:   "compressed",
				PhaseKey: "confirmed",
			})
			if topicErr == nil {
				topicID = topic.ID
			}
		} else {
			_, _ = h.Queries.UpdateRoomTopic(r.Context(), db.UpdateRoomTopicParams{
				ID:     topicID,
				Status: pgtype.Text{String: "compressed", Valid: true},
			})
		}
		if topicID.Valid {
			h.TaskService.RecordRoomFlowEvent(r.Context(), room, db.InsertRoomFlowEventParams{
				RoomID:    room.ID,
				TopicID:   topicID,
				Type:      "topic_compressed",
				MessageID: action.MessageID,
				ActorType: "user",
				ActorID:   parseUUID(userID),
				Payload:   []byte(`{}`),
			})
		}
	}
	h.publishRoom(protocol.EventRoomHumanActionUpdated, workspaceID, "member", userID, map[string]any{
		"room_id":   uuidToString(room.ID),
		"action_id": uuidToString(action.ID),
		"status":    action.Status,
	})
	writeJSON(w, http.StatusOK, map[string]string{
		"id":     uuidToString(action.ID),
		"status": action.Status,
	})
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
