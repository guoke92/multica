package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/service"
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
	h.RespondRoomHumanInteraction(w, r)
}

type respondRoomHumanInteractionRequest struct {
	OptionID     string `json:"option_id,omitempty"`
	ResponseText string `json:"response_text,omitempty"`
	Approved     *bool  `json:"approved,omitempty"`
	RejectReason string `json:"reject_reason,omitempty"`
}

func (h *Handler) RespondRoomHumanInteraction(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	interactionID := chi.URLParam(r, "interactionId")
	if interactionID == "" {
		interactionID = chi.URLParam(r, "actionId")
	}
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	if member.Role == "guest" {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	interactionUUID, ok := parseUUIDOrBadRequest(w, interactionID, "interaction id")
	if !ok {
		return
	}
	var req respondRoomHumanInteractionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	updated, msg, result, err := h.TaskService.RespondRoomHumanInteraction(r.Context(), service.RespondRoomHumanInteractionParams{
		Room:          room,
		InteractionID: interactionUUID,
		UserID:        parseUUID(userID),
		OptionID:      req.OptionID,
		ResponseText:  req.ResponseText,
		Approved:      req.Approved,
		RejectReason:  req.RejectReason,
		AuthorType:    actorType,
		AuthorID:      actorID,
		WorkspaceID:   workspaceID,
		CanAccessAgent: func(ctx context.Context, agent db.Agent, authorType, authorID, wsID string) bool {
			return h.canAccessPrivateAgent(ctx, agent, authorType, authorID, wsID)
		},
		MaxChainDepth: service.RoomMaxChainDepth(room),
	})
	if err != nil {
		if strings.Contains(err.Error(), "already closed") {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		if strings.Contains(err.Error(), "required") {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to respond to interaction")
		return
	}
	resp := map[string]any{
		"interaction": roomHumanInteractionToResponse(updated),
	}
	if msg != nil {
		resp["message"] = roomMessageToGraphResponse(*msg)
		h.publishRoom(protocol.EventRoomMessageCreated, workspaceID, "member", userID, protocol.RoomMessagePayload{
			RoomID:    uuidToString(room.ID),
			MessageID: uuidToString(msg.ID),
			Role:      "user",
			SenderID:  userID,
			Content:   msg.Content,
			CreatedAt: timestampToString(msg.CreatedAt),
		})
	}
	if len(result.Assignments) > 0 || len(result.Invocations) > 0 {
		assignResp := make([]AssignmentResponse, 0, len(result.Assignments))
		for _, a := range result.Assignments {
			assignResp = append(assignResp, assignmentToResponse(a))
		}
		invResp := make([]roomGraphInvocationResponse, 0, len(result.Invocations))
		for _, inv := range result.Invocations {
			invResp = append(invResp, invocationToResponse(inv))
		}
		resp["assignments"] = assignResp
		resp["invocations"] = invResp
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DismissRoomHumanInteraction(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	interactionID := chi.URLParam(r, "interactionId")
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	if member.Role == "guest" {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	interactionUUID, ok := parseUUIDOrBadRequest(w, interactionID, "interaction id")
	if !ok {
		return
	}
	updated, err := h.TaskService.DismissRoomHumanInteraction(r.Context(), room, interactionUUID)
	if err != nil {
		writeError(w, http.StatusConflict, "interaction already closed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"interaction": roomHumanInteractionToResponse(updated),
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

type roomHumanInteractionResponse struct {
	ID                  string          `json:"id"`
	RoomID              string          `json:"room_id"`
	Kind                string          `json:"kind"`
	Status              string          `json:"status"`
	Title               *string         `json:"title,omitempty"`
	Body                string          `json:"body"`
	Options             json.RawMessage `json:"options,omitempty"`
	AllowCustomResponse bool            `json:"allow_custom_response"`
	InvocationID        *string         `json:"invocation_id,omitempty"`
	AssignmentID        *string         `json:"assignment_id,omitempty"`
	DecisionID          *string         `json:"decision_id,omitempty"`
	ApprovalRequestID   *string         `json:"approval_request_id,omitempty"`
	CreatedByType       string          `json:"created_by_type"`
	CreatedByID         *string         `json:"created_by_id,omitempty"`
	ResponseText        *string         `json:"response_text,omitempty"`
	ResponseOptionID    *string         `json:"response_option_id,omitempty"`
	RespondedBy         *string         `json:"responded_by,omitempty"`
	RespondedAt         *string         `json:"responded_at,omitempty"`
	DismissedAt         *string         `json:"dismissed_at,omitempty"`
	CreatedAt           string          `json:"created_at"`
	UpdatedAt           string          `json:"updated_at"`
}

func roomHumanInteractionToResponse(row db.RoomHumanInteraction) roomHumanInteractionResponse {
	item := roomHumanInteractionResponse{
		ID:                  uuidToString(row.ID),
		RoomID:              uuidToString(row.RoomID),
		Kind:                row.Kind,
		Status:              row.Status,
		Body:                row.Body,
		AllowCustomResponse: row.AllowCustomResponse,
		CreatedByType:       row.CreatedByType,
		CreatedAt:           timestampToString(row.CreatedAt),
		UpdatedAt:           timestampToString(row.UpdatedAt),
	}
	if row.Title.Valid {
		s := row.Title.String
		item.Title = &s
	}
	if len(row.Options) > 0 {
		item.Options = row.Options
	}
	if row.InvocationID.Valid {
		s := uuidToString(row.InvocationID)
		item.InvocationID = &s
	}
	if row.AssignmentID.Valid {
		s := uuidToString(row.AssignmentID)
		item.AssignmentID = &s
	}
	if row.DecisionID.Valid {
		s := uuidToString(row.DecisionID)
		item.DecisionID = &s
	}
	if row.ApprovalRequestID.Valid {
		s := uuidToString(row.ApprovalRequestID)
		item.ApprovalRequestID = &s
	}
	if row.CreatedByID.Valid {
		s := uuidToString(row.CreatedByID)
		item.CreatedByID = &s
	}
	if row.ResponseText.Valid {
		s := row.ResponseText.String
		item.ResponseText = &s
	}
	if row.ResponseOptionID.Valid {
		s := row.ResponseOptionID.String
		item.ResponseOptionID = &s
	}
	if row.RespondedBy.Valid {
		s := uuidToString(row.RespondedBy)
		item.RespondedBy = &s
	}
	if row.RespondedAt.Valid {
		s := timestampToString(row.RespondedAt)
		item.RespondedAt = &s
	}
	if row.DismissedAt.Valid {
		s := timestampToString(row.DismissedAt)
		item.DismissedAt = &s
	}
	return item
}

func roomHumanInteractionsToGraphResponse(rows []db.RoomHumanInteraction) []roomHumanInteractionResponse {
	out := make([]roomHumanInteractionResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, roomHumanInteractionToResponse(row))
	}
	return out
}
