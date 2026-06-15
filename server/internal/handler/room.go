package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

const defaultRoomMentionTimeout = 30 * time.Minute

type CreateRoomManagerAgentRequest struct {
	Name         string `json:"name"`
	RuntimeID    string `json:"runtime_id"`
	Model        string `json:"model,omitempty"`
	Instructions string `json:"instructions,omitempty"`
}

type CreateRoomRequest struct {
	Name            string                         `json:"name"`
	Description     string                         `json:"description"`
	Type            string                         `json:"type"`
	ManagerAgentID  *string                        `json:"manager_agent_id,omitempty"`
	ManagerAgent    *CreateRoomManagerAgentRequest `json:"manager_agent,omitempty"`
	Policy          json.RawMessage                `json:"policy,omitempty"`
	AgentMemberIDs  []string                       `json:"agent_member_ids,omitempty"`
	MemberUserIDs   []string                       `json:"member_user_ids,omitempty"`
}

type RoomResponse struct {
	ID              string          `json:"id"`
	WorkspaceID     string          `json:"workspace_id"`
	Name            string          `json:"name"`
	Description     string          `json:"description"`
	Type            string          `json:"type"`
	ManagerAgentID  *string         `json:"manager_agent_id,omitempty"`
	Policy          json.RawMessage `json:"policy,omitempty"`
	Snapshot        json.RawMessage `json:"snapshot"`
	CreatedAt       string          `json:"created_at"`
	UpdatedAt       string          `json:"updated_at"`
}

type SendRoomMessageRequest struct {
	Content        string   `json:"content"`
	QuoteMessageID *string  `json:"quote_message_id,omitempty"`
	AttachmentIDs  []string `json:"attachment_ids,omitempty"`
}

type SendRoomMessageResponse struct {
	MessageID    string                    `json:"message_id"`
	CreatedAt    string                    `json:"created_at"`
	Invocations  []InvocationResponse      `json:"invocations,omitempty"`
}

type InvocationResponse struct {
	ID                string  `json:"id"`
	MessageID         string  `json:"message_id,omitempty"`
	TargetType        string  `json:"target_type"`
	TargetID          string  `json:"target_id"`
	Intent            string  `json:"intent,omitempty"`
	Status            string  `json:"status"`
	TaskID            *string `json:"task_id,omitempty"`
	ResponseMessageID *string `json:"response_message_id,omitempty"`
	CreatedAt         string  `json:"created_at"`
}

type RoomMemberResponse struct {
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
	Role          string `json:"role"`
}

func invocationToResponse(inv db.MentionInvocation) InvocationResponse {
	var taskID *string
	if inv.TaskID.Valid {
		s := uuidToString(inv.TaskID)
		taskID = &s
	}
	var responseMessageID *string
	if inv.ResponseMessageID.Valid {
		s := uuidToString(inv.ResponseMessageID)
		responseMessageID = &s
	}
	return InvocationResponse{
		ID:                uuidToString(inv.ID),
		MessageID:         uuidToString(inv.MessageID),
		TargetType:        inv.TargetType,
		TargetID:          uuidToString(inv.TargetID),
		Intent:            inv.Intent,
		Status:            inv.Status,
		TaskID:            taskID,
		ResponseMessageID: responseMessageID,
		CreatedAt:         timestampToString(inv.CreatedAt),
	}
}

type DecideApprovalRequest struct {
	Decision     string `json:"decision"`
	RejectReason string `json:"reject_reason,omitempty"`
}

func roomToResponse(r db.Room) RoomResponse {
	var manager *string
	if r.ManagerAgentID.Valid {
		s := uuidToString(r.ManagerAgentID)
		manager = &s
	}
	snap := r.Snapshot
	if len(snap) == 0 {
		snap = []byte("{}")
	}
	policy := r.Policy
	if len(policy) == 0 {
		policy = []byte("{}")
	}
	return RoomResponse{
		ID:             uuidToString(r.ID),
		WorkspaceID:    uuidToString(r.WorkspaceID),
		Name:           r.Name,
		Description:    r.Description,
		Type:           r.Type,
		ManagerAgentID: manager,
		Policy:         policy,
		Snapshot:       snap,
		CreatedAt:      timestampToString(r.CreatedAt),
		UpdatedAt:      timestampToString(r.UpdatedAt),
	}
}

func (h *Handler) publishRoom(eventType, workspaceID, actorType, actorID string, payload any) {
	h.Bus.Publish(events.Event{
		Type:        eventType,
		WorkspaceID: workspaceID,
		ActorType:   actorType,
		ActorID:     actorID,
		Payload:     payload,
	})
}

func (h *Handler) loadRoomMember(w http.ResponseWriter, r *http.Request, userID, workspaceID, roomID string) (db.Room, db.RoomMember, bool) {
	roomUUID, ok := parseUUIDOrBadRequest(w, roomID, "room id")
	if !ok {
		return db.Room{}, db.RoomMember{}, false
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return db.Room{}, db.RoomMember{}, false
	}
	room, err := h.Queries.GetRoomInWorkspace(r.Context(), db.GetRoomInWorkspaceParams{
		ID:          roomUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "room not found")
		return db.Room{}, db.RoomMember{}, false
	}
	member, err := h.Queries.GetRoomMember(r.Context(), db.GetRoomMemberParams{
		RoomID:         room.ID,
		PrincipalType:  "user",
		PrincipalID:    parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusForbidden, "not a room member")
		return db.Room{}, db.RoomMember{}, false
	}
	if room.ArchivedAt.Valid {
		writeError(w, http.StatusNotFound, "room not found")
		return db.Room{}, db.RoomMember{}, false
	}
	return room, member, true
}

func roomMemberCanManage(member db.RoomMember) bool {
	return member.Role == "owner" || member.Role == "admin"
}

func (h *Handler) validateRoomQuoteMessage(ctx context.Context, roomID, quoteID pgtype.UUID) bool {
	if !quoteID.Valid {
		return true
	}
	_, err := h.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID:     quoteID,
		RoomID: roomID,
	})
	return err == nil
}

// supersedeMessageInvocations cancels in-flight work and hides prior agent
// replies when a user message is edited and mentions are re-dispatched.
func (h *Handler) supersedeMessageInvocations(ctx context.Context, room db.Room, messageID pgtype.UUID, userID string) {
	invocations, err := h.Queries.ListMentionInvocationsByMessage(ctx, messageID)
	if err != nil {
		return
	}
	userUUID := parseUUID(userID)
	for _, inv := range invocations {
		if inv.Status != "succeeded" && inv.Status != "cancelled" {
			cancelled, cancelErr := h.Queries.CancelMentionInvocation(ctx, db.CancelMentionInvocationParams{
				ID:          inv.ID,
				CancelledBy: userUUID,
			})
			if cancelErr == nil && cancelled.TaskID.Valid {
				_, _ = h.TaskService.CancelTask(ctx, cancelled.TaskID)
			}
		}
		if inv.ResponseMessageID.Valid {
			_ = h.Queries.SoftDeleteRoomMessage(ctx, db.SoftDeleteRoomMessageParams{
				ID:     inv.ResponseMessageID,
				RoomID: room.ID,
			})
		}
	}
}

func (h *Handler) enqueueRoomInvocation(
	ctx context.Context,
	room db.Room,
	msg db.RoomMessage,
	inv db.MentionInvocation,
) (db.MentionInvocation, error) {
	agentID, isLeader, err := h.TaskService.ResolveRoomMentionAgent(ctx, room.WorkspaceID, util.Mention{
		Type: inv.TargetType,
		ID:   uuidToString(inv.TargetID),
	})
	if err != nil {
		return inv, err
	}
	task, err := h.TaskService.EnqueueRoomInvocationTask(ctx, service.EnqueueRoomInvocationParams{
		Room:       room,
		Message:    msg,
		Invocation: inv,
		AgentID:    agentID,
		IsLeader:   isLeader,
	})
	if err != nil {
		return inv, err
	}
	now := time.Now()
	inv, err = h.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
		ID:          inv.ID,
		Status:      "queued",
		TaskID:      task.ID,
		DeliveredAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return inv, err
	}
	h.TaskService.DrainQueuedRoomInvocations(ctx, agentID)
	return inv, nil
}

func (h *Handler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	var req CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	roomType := req.Type
	if roomType == "" {
		roomType = "project"
	}

	var managerID pgtype.UUID
	if req.ManagerAgent != nil {
		draft := req.ManagerAgent
		managerName := strings.TrimSpace(draft.Name)
		if managerName == "" {
			managerName = service.DefaultManagerAgentName(req.Name)
		}
		if draft.RuntimeID == "" {
			writeError(w, http.StatusBadRequest, "manager_agent.runtime_id is required")
			return
		}
		runtimeUUID, ok := parseUUIDOrBadRequest(w, draft.RuntimeID, "manager_agent.runtime_id")
		if !ok {
			return
		}
		runtime, err := h.Queries.GetAgentRuntimeForWorkspace(r.Context(), db.GetAgentRuntimeForWorkspaceParams{
			ID: runtimeUUID, WorkspaceID: wsUUID,
		})
		if err != nil {
			writeError(w, http.StatusBadRequest, "manager_agent.runtime_id is invalid")
			return
		}
		instructions := strings.TrimSpace(draft.Instructions)
		if instructions == "" {
			instructions = service.DefaultManagerCustomPrompt()
		}
		var agent db.Agent
		var createErr error
		for attempt := 0; attempt < 50; attempt++ {
			tryName := managerName
			if attempt > 0 {
				tryName = fmt.Sprintf("%s (%d)", managerName, attempt+1)
			}
			agent, createErr = h.Queries.CreateAgent(r.Context(), db.CreateAgentParams{
				WorkspaceID:        wsUUID,
				Name:               tryName,
				Description:        "Room manager for " + req.Name,
				Instructions:       service.MergeManagerAgentInstructions(instructions),
				RuntimeMode:        runtime.RuntimeMode,
				RuntimeConfig:      []byte("{}"),
				RuntimeID:          runtimeUUID,
				OwnerID:            parseUUID(userID),
				Visibility:         "workspace",
				CustomEnv:          []byte("{}"),
				CustomArgs:         []byte("[]"),
				Model:              pgtype.Text{String: draft.Model, Valid: strings.TrimSpace(draft.Model) != ""},
				MaxConcurrentTasks: 3,
			})
			if createErr == nil {
				managerID = agent.ID
				break
			}
			var pgErr *pgconn.PgError
			if errors.As(createErr, &pgErr) &&
				pgErr.Code == "23505" &&
				pgErr.ConstraintName == "agent_workspace_name_unique" {
				continue
			}
			slog.Warn("create room manager agent failed",
				append(logger.RequestAttrs(r), "error", createErr, "workspace_id", workspaceID)...)
			writeError(w, http.StatusInternalServerError, "failed to create manager agent")
			return
		}
		if !managerID.Valid {
			writeError(w, http.StatusConflict, fmt.Sprintf("could not allocate a unique manager agent name for %q", managerName))
			return
		}
	} else if req.ManagerAgentID != nil && *req.ManagerAgentID != "" {
		managerID, ok = parseUUIDOrBadRequest(w, *req.ManagerAgentID, "manager_agent_id")
		if !ok {
			return
		}
		if _, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID: managerID, WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "manager_agent_id must be a valid agent in this workspace")
			return
		}
	}

	policyBytes := req.Policy
	if len(policyBytes) == 0 && managerID.Valid {
		p := service.DefaultRoomPolicy("")
		if req.ManagerAgent != nil && strings.TrimSpace(req.ManagerAgent.Instructions) != "" {
			p.ManagerCustomPrompt = strings.TrimSpace(req.ManagerAgent.Instructions)
		}
		policyBytes, _ = service.MarshalRoomPolicy(p)
	} else if managerID.Valid && req.ManagerAgent != nil {
		policy := service.ParseRoomPolicy(policyBytes)
		if strings.TrimSpace(req.ManagerAgent.Instructions) != "" {
			policy.ManagerCustomPrompt = strings.TrimSpace(req.ManagerAgent.Instructions)
		}
		policyBytes, _ = service.MarshalRoomPolicy(policy)
	}
	if len(policyBytes) > 0 {
		policy := service.ParseRoomPolicy(policyBytes)
		memberAgents := make(map[string]struct{})
		for _, id := range req.AgentMemberIDs {
			memberAgents[id] = struct{}{}
		}
		if err := service.ValidateRoomPolicyAgents(policy, memberAgents); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	room, err := h.Queries.CreateRoom(r.Context(), db.CreateRoomParams{
		WorkspaceID:    wsUUID,
		Name:           req.Name,
		Description:    req.Description,
		Type:           roomType,
		CreatedBy:      parseUUID(userID),
		ManagerAgentID: managerID,
		Policy:         policyBytes,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create room")
		return
	}

	_, err = h.Queries.AddRoomMember(r.Context(), db.AddRoomMemberParams{
		RoomID:        room.ID,
		PrincipalType: "user",
		PrincipalID:   parseUUID(userID),
		Role:          "owner",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add room owner")
		return
	}

	// Add the manager agent as a room member so it appears in the member list.
	if managerID.Valid {
		_, _ = h.Queries.AddRoomMember(r.Context(), db.AddRoomMemberParams{
			RoomID:        room.ID,
			PrincipalType: "agent",
			PrincipalID:   managerID,
			Role:          "manager",
		})
	}

	agentIDs := append([]string{}, req.AgentMemberIDs...)
	for _, agentIDStr := range agentIDs {
		agentUUID, err := util.ParseUUID(agentIDStr)
		if err != nil {
			continue
		}
		// Skip manager agent — already added above with role "manager".
		if managerID.Valid && agentUUID == managerID {
			continue
		}
		if _, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID:          agentUUID,
			WorkspaceID: wsUUID,
		}); err != nil {
			continue
		}
		_, _ = h.Queries.AddRoomMember(r.Context(), db.AddRoomMemberParams{
			RoomID:        room.ID,
			PrincipalType: "agent",
			PrincipalID:   agentUUID,
			Role:          "member",
		})
	}

	ownerUUID := parseUUID(userID)
	for _, memberIDStr := range req.MemberUserIDs {
		memberUUID, err := util.ParseUUID(memberIDStr)
		if err != nil || memberUUID == ownerUUID {
			continue
		}
		if _, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
			WorkspaceID: wsUUID,
			UserID:      memberUUID,
		}); err != nil {
			continue
		}
		_, _ = h.Queries.AddRoomMember(r.Context(), db.AddRoomMemberParams{
			RoomID:        room.ID,
			PrincipalType: "user",
			PrincipalID:   memberUUID,
			Role:          "member",
		})
	}

	h.logRoomAudit(r.Context(), workspaceID, "member", userID, "room_created", map[string]string{
		"room_id": uuidToString(room.ID),
		"name":    room.Name,
	})
	writeJSON(w, http.StatusCreated, roomToResponse(room))
}

func (h *Handler) logRoomAudit(ctx context.Context, workspaceID, actorType, actorID, action string, details map[string]string) {
	wsUUID, err := util.ParseUUID(workspaceID)
	if err != nil {
		return
	}
	var actorUUID pgtype.UUID
	if actorType == "member" {
		actorUUID = parseUUID(actorID)
	}
	b, _ := json.Marshal(details)
	_, _ = h.Queries.CreateActivity(ctx, db.CreateActivityParams{
		WorkspaceID: wsUUID,
		IssueID:     pgtype.UUID{},
		ActorType:   pgtype.Text{String: actorType, Valid: actorType != ""},
		ActorID:     actorUUID,
		Action:      action,
		Details:     b,
	})
}

func (h *Handler) ListRooms(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}
	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user_id")
	if !ok {
		return
	}
	rooms, err := h.Queries.ListRoomsForMember(r.Context(), db.ListRoomsForMemberParams{
		WorkspaceID: wsUUID,
		PrincipalID: userUUID,
	})
	if err != nil {
		slog.Warn("list rooms failed",
			append(logger.RequestAttrs(r), "error", err, "workspace_id", workspaceID)...)
		writeError(w, http.StatusInternalServerError, "failed to list rooms")
		return
	}
	resp := make([]RoomResponse, 0, len(rooms))
	for _, room := range rooms {
		resp = append(resp, roomToResponse(room))
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) GetRoom(w http.ResponseWriter, r *http.Request) {
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
	writeJSON(w, http.StatusOK, roomToResponse(room))
}

func (h *Handler) ArchiveRoom(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	if !roomMemberCanManage(member) {
		writeError(w, http.StatusForbidden, "only room owner or admin can archive")
		return
	}

	active, err := h.Queries.ListActiveMentionInvocationsByRoom(r.Context(), room.ID)
	if err == nil {
		userUUID := parseUUID(userID)
		for _, inv := range active {
			cancelled, cancelErr := h.Queries.CancelMentionInvocation(r.Context(), db.CancelMentionInvocationParams{
				ID:          inv.ID,
				CancelledBy: userUUID,
			})
			if cancelErr != nil {
				continue
			}
			if cancelled.TaskID.Valid {
				_, _ = h.TaskService.CancelTask(r.Context(), cancelled.TaskID)
			}
		}
		h.TaskService.RefreshRoomSnapshot(r.Context(), room.ID)
	}

	wsUUID := parseUUID(workspaceID)
	archived, err := h.Queries.ArchiveRoom(r.Context(), db.ArchiveRoomParams{
		ID:          room.ID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive room")
		return
	}

	// Archive the manager agent if it was auto-created with this room
	// and is not managing any other active room.
	if room.ManagerAgentID.Valid {
		if mgr, mgrErr := h.Queries.GetAgent(r.Context(), room.ManagerAgentID); mgrErr == nil &&
			!mgr.ArchivedAt.Valid &&
			strings.HasPrefix(mgr.Description, "Room manager for ") {
			stillManaging, _ := h.Queries.IsRoomManagerAgent(r.Context(), room.ManagerAgentID)
			if !stillManaging {
				userUUID := parseUUID(userID)
				if _, archiveErr := h.Queries.ArchiveAgent(r.Context(), db.ArchiveAgentParams{
					ID:         room.ManagerAgentID,
					ArchivedBy: userUUID,
				}); archiveErr != nil {
					slog.Warn("archive manager agent with room",
						"room_id", uuidToString(room.ID),
						"agent_id", uuidToString(room.ManagerAgentID),
						"error", archiveErr,
					)
				}
			}
		}
	}

	h.logRoomAudit(r.Context(), workspaceID, "member", userID, "room_archived", map[string]string{
		"room_id": uuidToString(room.ID),
		"name":    room.Name,
	})
	h.publishRoom(protocol.EventRoomArchived, workspaceID, "member", userID, map[string]any{
		"room_id": uuidToString(archived.ID),
	})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ListRoomMembers(w http.ResponseWriter, r *http.Request) {
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
	rows, err := h.Queries.ListRoomMembers(r.Context(), room.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}
	resp := make([]RoomMemberResponse, 0, len(rows))
	for _, m := range rows {
		resp = append(resp, RoomMemberResponse{
			PrincipalType: m.PrincipalType,
			PrincipalID:   uuidToString(m.PrincipalID),
			Role:          m.Role,
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) publishRoomMembersUpdated(workspaceID, userID, roomID string) {
	h.publishRoom(protocol.EventRoomMembersUpdated, workspaceID, "member", userID, map[string]any{
		"room_id": roomID,
	})
}

func (h *Handler) validateRoomPrincipalInWorkspace(
	w http.ResponseWriter,
	r *http.Request,
	wsUUID pgtype.UUID,
	principalType string,
	principalUUID pgtype.UUID,
) bool {
	switch principalType {
	case "user":
		if _, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
			WorkspaceID: wsUUID,
			UserID:      principalUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "user not found in this workspace")
			return false
		}
	case "agent":
		if _, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID:          principalUUID,
			WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "agent not found in this workspace")
			return false
		}
	case "squad":
		if _, err := h.Queries.GetSquadInWorkspace(r.Context(), db.GetSquadInWorkspaceParams{
			ID:          principalUUID,
			WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "squad not found in this workspace")
			return false
		}
	default:
		writeError(w, http.StatusBadRequest, "principal_type must be 'user', 'agent', or 'squad'")
		return false
	}
	return true
}

func (h *Handler) UpdateRoom(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	if !roomMemberCanManage(member) {
		writeError(w, http.StatusForbidden, "only room owner or admin can update room")
		return
	}
	wsUUID := parseUUID(workspaceID)

	var req struct {
		Name                *string `json:"name"`
		Description         *string `json:"description"`
		ManagerAgentID      *string `json:"manager_agent_id"`
		ManagerCustomPrompt *string `json:"manager_custom_prompt"`
		ManagerRuntimeID    *string `json:"manager_runtime_id"`
		ManagerModel        *string `json:"manager_model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateRoomParams{
		ID:          room.ID,
		WorkspaceID: wsUUID,
	}
	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if trimmed == "" {
			writeError(w, http.StatusBadRequest, "name cannot be empty")
			return
		}
		params.Name = pgtype.Text{String: trimmed, Valid: true}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.ManagerAgentID != nil {
		if *req.ManagerAgentID == "" {
			params.ManagerAgentID = pgtype.UUID{}
		} else {
			managerUUID, ok := parseUUIDOrBadRequest(w, *req.ManagerAgentID, "manager_agent_id")
			if !ok {
				return
			}
			if _, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
				ID: managerUUID, WorkspaceID: wsUUID,
			}); err != nil {
				writeError(w, http.StatusBadRequest, "manager_agent_id must be a valid agent in this workspace")
				return
			}
			params.ManagerAgentID = managerUUID
		}
	}

	updated, err := h.Queries.UpdateRoom(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update room")
		return
	}

	if req.ManagerCustomPrompt != nil || req.ManagerRuntimeID != nil || req.ManagerModel != nil {
		if !updated.ManagerAgentID.Valid {
			writeError(w, http.StatusBadRequest, "room has no manager agent")
			return
		}
		policy := service.ParseRoomPolicy(updated.Policy)
		if req.ManagerCustomPrompt != nil {
			policy.ManagerCustomPrompt = strings.TrimSpace(*req.ManagerCustomPrompt)
			policyBytes, marshalErr := service.MarshalRoomPolicy(policy)
			if marshalErr != nil {
				writeError(w, http.StatusInternalServerError, "failed to update room policy")
				return
			}
			updated, err = h.Queries.UpdateRoom(r.Context(), db.UpdateRoomParams{
				ID: updated.ID, WorkspaceID: wsUUID, Policy: policyBytes,
			})
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to update room policy")
				return
			}
		}
		if _, agentErr := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID: updated.ManagerAgentID, WorkspaceID: wsUUID,
		}); agentErr != nil {
			writeError(w, http.StatusBadRequest, "manager agent not found")
			return
		}
		agentParams := db.UpdateAgentParams{
			ID: updated.ManagerAgentID,
		}
		roomName := updated.Name
		if req.Name != nil {
			roomName = strings.TrimSpace(*req.Name)
		}
		agentParams.Name = pgtype.Text{String: service.DefaultManagerAgentName(roomName), Valid: true}
		if req.ManagerCustomPrompt != nil {
			agentParams.Instructions = pgtype.Text{
				String: service.MergeManagerAgentInstructions(policy.ManagerCustomPrompt),
				Valid:  true,
			}
		}
		if req.ManagerModel != nil {
			agentParams.Model = pgtype.Text{String: strings.TrimSpace(*req.ManagerModel), Valid: true}
		}
		if req.ManagerRuntimeID != nil {
			runtimeUUID, ok := parseUUIDOrBadRequest(w, strings.TrimSpace(*req.ManagerRuntimeID), "manager_runtime_id")
			if !ok {
				return
			}
			runtime, rtErr := h.Queries.GetAgentRuntimeForWorkspace(r.Context(), db.GetAgentRuntimeForWorkspaceParams{
				ID: runtimeUUID, WorkspaceID: wsUUID,
			})
			if rtErr != nil {
				writeError(w, http.StatusBadRequest, "invalid manager_runtime_id")
				return
			}
			agentParams.RuntimeID = runtimeUUID
			agentParams.RuntimeMode = pgtype.Text{String: runtime.RuntimeMode, Valid: true}
		}
		if _, err := h.Queries.UpdateAgent(r.Context(), agentParams); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update manager agent")
			return
		}
	}

	if req.Name != nil && updated.ManagerAgentID.Valid &&
		req.ManagerRuntimeID == nil && req.ManagerModel == nil && req.ManagerCustomPrompt == nil {
		if _, err := h.Queries.UpdateAgent(r.Context(), db.UpdateAgentParams{
			ID: updated.ManagerAgentID,
			Name: pgtype.Text{
				String: service.DefaultManagerAgentName(strings.TrimSpace(*req.Name)),
				Valid:  true,
			},
		}); err != nil {
			slog.Warn("rename manager agent failed", "room_id", uuidToString(updated.ID), "error", err)
		}
	}

	h.logRoomAudit(r.Context(), workspaceID, "member", userID, "room_updated", map[string]string{
		"room_id": uuidToString(room.ID),
	})
	h.publishRoom(protocol.EventRoomUpdated, workspaceID, "member", userID, map[string]any{
		"room_id": uuidToString(updated.ID),
	})
	writeJSON(w, http.StatusOK, roomToResponse(updated))
}

func (h *Handler) AddRoomMember(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	if !roomMemberCanManage(member) {
		writeError(w, http.StatusForbidden, "only room owner or admin can add members")
		return
	}
	wsUUID := parseUUID(workspaceID)

	var req struct {
		PrincipalType string `json:"principal_type"`
		PrincipalID   string `json:"principal_id"`
		Role          string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.PrincipalID == "" {
		writeError(w, http.StatusBadRequest, "principal_id is required")
		return
	}
	principalUUID, ok := parseUUIDOrBadRequest(w, req.PrincipalID, "principal_id")
	if !ok {
		return
	}
	if !h.validateRoomPrincipalInWorkspace(w, r, wsUUID, req.PrincipalType, principalUUID) {
		return
	}

	if _, err := h.Queries.GetRoomMember(r.Context(), db.GetRoomMemberParams{
		RoomID:        room.ID,
		PrincipalType: req.PrincipalType,
		PrincipalID:   principalUUID,
	}); err == nil {
		writeError(w, http.StatusConflict, "already a room member")
		return
	}

	role := req.Role
	if role == "" {
		role = "member"
	}
	if role != "member" && role != "admin" && role != "guest" {
		writeError(w, http.StatusBadRequest, "role must be 'member', 'admin', or 'guest'")
		return
	}
	if role == "admin" && member.Role != "owner" {
		writeError(w, http.StatusForbidden, "only room owner can add admins")
		return
	}

	added, err := h.Queries.AddRoomMember(r.Context(), db.AddRoomMemberParams{
		RoomID:        room.ID,
		PrincipalType: req.PrincipalType,
		PrincipalID:   principalUUID,
		Role:          role,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add room member")
		return
	}

	h.logRoomAudit(r.Context(), workspaceID, "member", userID, "room_member_added", map[string]string{
		"room_id":        uuidToString(room.ID),
		"principal_type": req.PrincipalType,
		"principal_id":   req.PrincipalID,
	})
	h.publishRoomMembersUpdated(workspaceID, userID, uuidToString(room.ID))
	writeJSON(w, http.StatusCreated, RoomMemberResponse{
		PrincipalType: added.PrincipalType,
		PrincipalID:   uuidToString(added.PrincipalID),
		Role:          added.Role,
	})
}

func (h *Handler) RemoveRoomMember(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	room, actor, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}

	var req struct {
		PrincipalType string `json:"principal_type"`
		PrincipalID   string `json:"principal_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.PrincipalID == "" || req.PrincipalType == "" {
		writeError(w, http.StatusBadRequest, "principal_type and principal_id are required")
		return
	}
	principalUUID, ok := parseUUIDOrBadRequest(w, req.PrincipalID, "principal_id")
	if !ok {
		return
	}

	target, err := h.Queries.GetRoomMember(r.Context(), db.GetRoomMemberParams{
		RoomID:        room.ID,
		PrincipalType: req.PrincipalType,
		PrincipalID:   principalUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "room member not found")
		return
	}

	isSelf := req.PrincipalType == "user" && req.PrincipalID == userID
	if isSelf {
		if target.Role == "owner" {
			writeError(w, http.StatusBadRequest, "owner must transfer ownership before leaving")
			return
		}
	} else {
		if !roomMemberCanManage(actor) {
			writeError(w, http.StatusForbidden, "only room owner or admin can remove members")
			return
		}
		if target.Role == "owner" {
			writeError(w, http.StatusBadRequest, "cannot remove room owner")
			return
		}
		if target.Role == "admin" && actor.Role != "owner" {
			writeError(w, http.StatusForbidden, "only room owner can remove admins")
			return
		}
	}

	if err := h.Queries.RemoveRoomMember(r.Context(), db.RemoveRoomMemberParams{
		RoomID:        room.ID,
		PrincipalType: req.PrincipalType,
		PrincipalID:   principalUUID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove room member")
		return
	}

	action := "room_member_removed"
	if isSelf {
		action = "room_member_left"
	}
	h.logRoomAudit(r.Context(), workspaceID, "member", userID, action, map[string]string{
		"room_id":        uuidToString(room.ID),
		"principal_type": req.PrincipalType,
		"principal_id":   req.PrincipalID,
	})
	h.publishRoomMembersUpdated(workspaceID, userID, uuidToString(room.ID))
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) UpdateRoomMemberRole(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	room, actor, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	if actor.Role != "owner" {
		writeError(w, http.StatusForbidden, "only room owner can change member roles")
		return
	}

	var req struct {
		PrincipalType string `json:"principal_type"`
		PrincipalID   string `json:"principal_id"`
		Role          string `json:"role"`
		Action        string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.PrincipalType != "user" {
		writeError(w, http.StatusBadRequest, "only user members can have roles changed")
		return
	}
	principalUUID, ok := parseUUIDOrBadRequest(w, req.PrincipalID, "principal_id")
	if !ok {
		return
	}
	if req.PrincipalID == userID && req.Action != "transfer_owner" {
		writeError(w, http.StatusBadRequest, "cannot change your own role this way")
		return
	}

	target, err := h.Queries.GetRoomMember(r.Context(), db.GetRoomMemberParams{
		RoomID:        room.ID,
		PrincipalType: req.PrincipalType,
		PrincipalID:   principalUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "room member not found")
		return
	}
	if target.Role == "owner" && req.Action != "transfer_owner" {
		writeError(w, http.StatusBadRequest, "use transfer_owner to change ownership")
		return
	}

	ctx := r.Context()
	if req.Action == "transfer_owner" {
		updated, err := h.Queries.UpdateRoomMemberRole(ctx, db.UpdateRoomMemberRoleParams{
			RoomID: room.ID, PrincipalType: "user", PrincipalID: principalUUID, Role: "owner",
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to transfer ownership")
			return
		}
		_, _ = h.Queries.UpdateRoomMemberRole(ctx, db.UpdateRoomMemberRoleParams{
			RoomID: room.ID, PrincipalType: "user", PrincipalID: parseUUID(userID), Role: "member",
		})
		h.logRoomAudit(ctx, workspaceID, "member", userID, "room_owner_transferred", map[string]string{
			"room_id":     uuidToString(room.ID),
			"new_owner_id": req.PrincipalID,
		})
		h.publishRoomMembersUpdated(workspaceID, userID, uuidToString(room.ID))
		writeJSON(w, http.StatusOK, RoomMemberResponse{
			PrincipalType: updated.PrincipalType,
			PrincipalID:   uuidToString(updated.PrincipalID),
			Role:          updated.Role,
		})
		return
	}

	switch req.Role {
	case "admin", "member", "guest":
	default:
		writeError(w, http.StatusBadRequest, "role must be 'admin', 'member', or 'guest'")
		return
	}

	updated, err := h.Queries.UpdateRoomMemberRole(ctx, db.UpdateRoomMemberRoleParams{
		RoomID: room.ID, PrincipalType: req.PrincipalType, PrincipalID: principalUUID, Role: req.Role,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update member role")
		return
	}

	h.logRoomAudit(ctx, workspaceID, "member", userID, "room_member_role_updated", map[string]string{
		"room_id":        uuidToString(room.ID),
		"principal_id":   req.PrincipalID,
		"role":           req.Role,
	})
	h.publishRoomMembersUpdated(workspaceID, userID, uuidToString(room.ID))
	writeJSON(w, http.StatusOK, RoomMemberResponse{
		PrincipalType: updated.PrincipalType,
		PrincipalID:   uuidToString(updated.PrincipalID),
		Role:          updated.Role,
	})
}

func (h *Handler) LeaveRoom(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	if member.Role == "owner" {
		writeError(w, http.StatusBadRequest, "owner must transfer ownership before leaving")
		return
	}

	if err := h.Queries.RemoveRoomMember(r.Context(), db.RemoveRoomMemberParams{
		RoomID:        room.ID,
		PrincipalType: "user",
		PrincipalID:   parseUUID(userID),
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to leave room")
		return
	}

	h.logRoomAudit(r.Context(), workspaceID, "member", userID, "room_member_left", map[string]string{
		"room_id": uuidToString(room.ID),
	})
	h.publishRoomMembersUpdated(workspaceID, userID, uuidToString(room.ID))
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) SendRoomMessage(w http.ResponseWriter, r *http.Request) {
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

	var req SendRoomMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	var quoteID pgtype.UUID
	if req.QuoteMessageID != nil && *req.QuoteMessageID != "" {
		quoteID, ok = parseUUIDOrBadRequest(w, *req.QuoteMessageID, "quote_message_id")
		if !ok {
			return
		}
		if !h.validateRoomQuoteMessage(r.Context(), room.ID, quoteID) {
			writeError(w, http.StatusBadRequest, "quoted message not found in this room")
			return
		}
	}

	msg, err := h.Queries.CreateRoomMessage(r.Context(), db.CreateRoomMessageParams{
		RoomID:         room.ID,
		SenderType:     "user",
		SenderID:       pgtype.UUID{Bytes: parseUUID(userID).Bytes, Valid: true},
		Content:        req.Content,
		QuoteMessageID: quoteID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create message")
		return
	}

	_ = h.Queries.TouchRoom(r.Context(), room.ID)

	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	invocations, err := h.TaskService.RouteRoomMessage(r.Context(), service.RoomMentionDispatchParams{
		Room:        room,
		Message:     msg,
		AuthorType:  actorType,
		AuthorID:    actorID,
		WorkspaceID: workspaceID,
		CanAccessAgent: func(ctx context.Context, agent db.Agent, authorType, authorID, wsID string) bool {
			return h.canAccessPrivateAgent(ctx, agent, authorType, authorID, wsID)
		},
		MaxChainDepth:  5,
		DefaultTimeout: defaultRoomMentionTimeout,
	})
	if err != nil {
		slog.Warn("route room message", "error", err)
	}

	h.publishRoom(protocol.EventRoomMessage, workspaceID, "member", userID, protocol.RoomMessagePayload{
		RoomID:    uuidToString(room.ID),
		MessageID: uuidToString(msg.ID),
		Role:      "user",
		Content:   msg.Content,
		CreatedAt: timestampToString(msg.CreatedAt),
	})
	h.publishRoom(protocol.EventRoomMessageCreated, workspaceID, "member", userID, protocol.RoomMessagePayload{
		RoomID:    uuidToString(room.ID),
		MessageID: uuidToString(msg.ID),
		Role:      "user",
		Content:   msg.Content,
		CreatedAt: timestampToString(msg.CreatedAt),
	})

	invResp := make([]InvocationResponse, 0, len(invocations))
	for _, inv := range invocations {
		invResp = append(invResp, invocationToResponse(inv))
	}

	writeJSON(w, http.StatusCreated, SendRoomMessageResponse{
		MessageID:   uuidToString(msg.ID),
		CreatedAt:   timestampToString(msg.CreatedAt),
		Invocations: invResp,
	})
}

type UpdateRoomMessageRequest struct {
	Content string `json:"content"`
}

func (h *Handler) UpdateRoomMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	messageID := chi.URLParam(r, "messageId")
	room, _, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}

	var req UpdateRoomMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	msgUUID, ok := parseUUIDOrBadRequest(w, messageID, "message id")
	if !ok {
		return
	}
	userUUID := parseUUID(userID)
	msg, err := h.Queries.UpdateRoomMessageContent(r.Context(), db.UpdateRoomMessageContentParams{
		ID:       msgUUID,
		Content:  req.Content,
		RoomID:   room.ID,
		SenderID: userUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "message not found or not editable")
		return
	}

	h.supersedeMessageInvocations(r.Context(), room, msg.ID, userID)
	_ = h.Queries.TouchRoom(r.Context(), room.ID)

	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	invocations, err := h.TaskService.RouteRoomMessage(r.Context(), service.RoomMentionDispatchParams{
		Room:        room,
		Message:     msg,
		AuthorType:  actorType,
		AuthorID:    actorID,
		WorkspaceID: workspaceID,
		CanAccessAgent: func(ctx context.Context, agent db.Agent, authorType, authorID, wsID string) bool {
			return h.canAccessPrivateAgent(ctx, agent, authorType, authorID, wsID)
		},
		MaxChainDepth:  5,
		DefaultTimeout: defaultRoomMentionTimeout,
	})
	if err != nil {
		slog.Warn("route room message after edit", "error", err)
	}

	h.publishRoom(protocol.EventRoomMessage, workspaceID, "member", userID, protocol.RoomMessagePayload{
		RoomID:    uuidToString(room.ID),
		MessageID: uuidToString(msg.ID),
		Role:      "user",
		Content:   msg.Content,
		CreatedAt: timestampToString(msg.CreatedAt),
	})
	h.publishRoom(protocol.EventRoomMessageUpdated, workspaceID, "member", userID, protocol.RoomMessagePayload{
		RoomID:    uuidToString(room.ID),
		MessageID: uuidToString(msg.ID),
		Role:      "user",
		Content:   msg.Content,
		CreatedAt: timestampToString(msg.CreatedAt),
	})

	invResp := make([]InvocationResponse, 0, len(invocations))
	for _, inv := range invocations {
		invResp = append(invResp, invocationToResponse(inv))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"message_id":  uuidToString(msg.ID),
		"content":     msg.Content,
		"edited_at":   timestampToString(msg.EditedAt),
		"invocations": invResp,
	})
}

func (h *Handler) RegenerateRoomAgentMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	messageID := chi.URLParam(r, "messageId")
	room, _, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}

	msgUUID, ok := parseUUIDOrBadRequest(w, messageID, "message id")
	if !ok {
		return
	}
	agentMsg, err := h.Queries.GetRoomMessageInRoom(r.Context(), db.GetRoomMessageInRoomParams{
		ID:     msgUUID,
		RoomID: room.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if agentMsg.SenderType != "agent" {
		writeError(w, http.StatusBadRequest, "only agent messages can be regenerated")
		return
	}

	inv, err := h.Queries.GetMentionInvocationByResponseMessage(r.Context(), db.GetMentionInvocationByResponseMessageParams{
		ResponseMessageID: agentMsg.ID,
		RoomID:            room.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "invocation not found for this message")
		return
	}

	_ = h.Queries.SoftDeleteRoomMessage(r.Context(), db.SoftDeleteRoomMessageParams{
		ID:     agentMsg.ID,
		RoomID: room.ID,
	})

	inv, err = h.Queries.ResetMentionInvocationForRegenerate(r.Context(), inv.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invocation cannot be regenerated")
		return
	}

	sourceMsg, err := h.Queries.GetRoomMessageInRoom(r.Context(), db.GetRoomMessageInRoomParams{
		ID:     inv.MessageID,
		RoomID: room.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "source message not found")
		return
	}

	inv, err = h.enqueueRoomInvocation(r.Context(), room, sourceMsg, inv)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to enqueue task")
		return
	}

	h.TaskService.RefreshRoomSnapshot(r.Context(), room.ID)
	h.publishRoom(protocol.EventRoomInvocationUpdated, workspaceID, "member", userID, map[string]string{
		"room_id": uuidToString(room.ID),
	})
	writeJSON(w, http.StatusOK, invocationToResponse(inv))
}

func (h *Handler) ListRoomMessages(w http.ResponseWriter, r *http.Request) {
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

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	var before pgtype.Timestamptz
	if b := r.URL.Query().Get("before"); b != "" {
		if t, err := time.Parse(time.RFC3339, b); err == nil {
			before = pgtype.Timestamptz{Time: t, Valid: true}
		}
	}

	listParams := db.ListRoomMessagesParams{
		RoomID:          room.ID,
		BeforeCreatedAt: before,
		Limit:           int32(limit),
	}
	rows, err := h.Queries.ListRoomMessagesExtended(r.Context(), db.ListRoomMessagesExtendedParams(listParams))
	if err != nil {
		rows, err = h.Queries.ListRoomMessages(r.Context(), listParams)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list messages")
		return
	}
	// Query returns DESC; reverse to ASC for clients.
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	type msgResp struct {
		ID             string          `json:"id"`
		SenderType     string          `json:"sender_type"`
		SenderID       *string         `json:"sender_id,omitempty"`
		Content        string          `json:"content"`
		QuoteMessageID *string         `json:"quote_message_id,omitempty"`
		DeliveryID     *string         `json:"delivery_id,omitempty"`
		TopicID        *string         `json:"topic_id,omitempty"`
		MessageKind    string          `json:"message_kind,omitempty"`
		Metadata       json.RawMessage `json:"metadata,omitempty"`
		RelayMetadata  json.RawMessage `json:"relay_metadata,omitempty"`
		CreatedAt      string          `json:"created_at"`
		EditedAt       *string         `json:"edited_at,omitempty"`
	}
	out := make([]msgResp, 0, len(rows))
	for _, m := range rows {
		var senderID, quoteID *string
		if m.SenderID.Valid {
			s := uuidToString(m.SenderID)
			senderID = &s
		}
		if m.QuoteMessageID.Valid {
			s := uuidToString(m.QuoteMessageID)
			quoteID = &s
		}
		var deliveryID, topicID *string
		if m.DeliveryID.Valid {
			s := uuidToString(m.DeliveryID)
			deliveryID = &s
		}
		if m.TopicID.Valid {
			s := uuidToString(m.TopicID)
			topicID = &s
		}
		meta := m.Metadata
		if len(meta) == 0 {
			meta = []byte("{}")
		}
		var relayMeta json.RawMessage
		if len(m.RelayMetadata) > 0 {
			relayMeta = m.RelayMetadata
		}
		var editedAt *string
		if m.EditedAt.Valid {
			s := timestampToString(m.EditedAt)
			editedAt = &s
		}
		out = append(out, msgResp{
			ID:             uuidToString(m.ID),
			SenderType:     m.SenderType,
			SenderID:       senderID,
			Content:        m.Content,
			QuoteMessageID: quoteID,
			DeliveryID:     deliveryID,
			TopicID:        topicID,
			MessageKind:    m.MessageKind,
			Metadata:       meta,
			RelayMetadata:  relayMeta,
			CreatedAt:      timestampToString(m.CreatedAt),
			EditedAt:       editedAt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) ListRoomInvocations(w http.ResponseWriter, r *http.Request) {
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
	rows, err := h.Queries.ListRoomMentionInvocations(r.Context(), room.ID)
	if err != nil {
		slog.Warn("list room invocations failed",
			"room_id", uuidToString(room.ID),
			"error", err,
		)
		writeError(w, http.StatusInternalServerError, "failed to list invocations")
		return
	}
	resp := make([]InvocationResponse, 0, len(rows))
	for _, inv := range rows {
		resp = append(resp, invocationToResponse(inv))
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) RetryInvocation(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	invID := chi.URLParam(r, "invocationId")
	invUUID, ok := parseUUIDOrBadRequest(w, invID, "invocation id")
	if !ok {
		return
	}
	inv, err := h.Queries.GetMentionInvocation(r.Context(), invUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "invocation not found")
		return
	}
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, uuidToString(inv.RoomID))
	if !ok {
		return
	}
	_ = member
	if inv.Status != "failed" && inv.Status != "timed_out" && inv.Status != "cancelled" {
		writeError(w, http.StatusBadRequest, "invocation cannot be retried")
		return
	}
	if inv.RetryCount >= inv.MaxRetries {
		writeError(w, http.StatusBadRequest, "max retries exceeded")
		return
	}
	msg, err := h.Queries.GetRoomMessageInRoom(r.Context(), db.GetRoomMessageInRoomParams{
		ID:     inv.MessageID,
		RoomID: room.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "source message not found")
		return
	}
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	agentID, isLeader, err := h.TaskService.ResolveRoomMentionAgent(r.Context(), room.WorkspaceID, util.Mention{
		Type: inv.TargetType,
		ID:   uuidToString(inv.TargetID),
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid invocation target")
		return
	}
	inv, err = h.Queries.UpdateMentionInvocationStatus(r.Context(), db.UpdateMentionInvocationStatusParams{
		ID:         inv.ID,
		Status:     "pending",
		RetryCount: pgtype.Int4{Int32: inv.RetryCount + 1, Valid: true},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to reset invocation")
		return
	}
	task, err := h.TaskService.EnqueueRoomInvocationTask(r.Context(), service.EnqueueRoomInvocationParams{
		Room:       room,
		Message:    msg,
		Invocation: inv,
		AgentID:    agentID,
		IsLeader:   isLeader,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to enqueue task")
		return
	}
	now := time.Now()
	inv, _ = h.Queries.UpdateMentionInvocationStatus(r.Context(), db.UpdateMentionInvocationStatusParams{
		ID:          inv.ID,
		Status:      "queued",
		TaskID:      task.ID,
		DeliveredAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	h.TaskService.DrainQueuedRoomInvocations(r.Context(), agentID)
	h.TaskService.RecordInvocationFlowEvent(r.Context(), room, inv, "invocation_retried", "user", parseUUID(userID), map[string]any{
		"retry_count": inv.RetryCount,
	})
	_ = actorType
	_ = actorID
	writeJSON(w, http.StatusOK, invocationToResponse(inv))
}

func (h *Handler) CancelRoomInvocation(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	invID := chi.URLParam(r, "invocationId")
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	invUUID, ok := parseUUIDOrBadRequest(w, invID, "invocation id")
	if !ok {
		return
	}
	inv, err := h.Queries.GetMentionInvocationInRoom(r.Context(), db.GetMentionInvocationInRoomParams{
		ID: invUUID, RoomID: room.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "invocation not found")
		return
	}
	if !h.canCancelRoomInvocation(r.Context(), room, member, userID, inv) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	inv, err = h.Queries.CancelMentionInvocation(r.Context(), db.CancelMentionInvocationParams{
		ID:          inv.ID,
		CancelledBy: parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "invocation not found or already finished")
		return
	}
	var agentID pgtype.UUID
	if inv.TaskID.Valid {
		if task, cancelErr := h.TaskService.CancelTask(r.Context(), inv.TaskID); cancelErr == nil && task != nil {
			agentID = task.AgentID
		}
	}
	if agentID.Valid {
		h.TaskService.DrainQueuedRoomInvocations(r.Context(), agentID)
	}
	h.TaskService.RefreshRoomSnapshot(r.Context(), inv.RoomID)
	h.TaskService.MaybeRecordInvocationStatusFlowEvent(r.Context(), room, inv, "cancelled")
	h.publishRoom(protocol.EventRoomInvocationUpdated, workspaceID, "member", userID, map[string]string{
		"room_id": uuidToString(inv.RoomID),
	})
	writeJSON(w, http.StatusOK, invocationToResponse(inv))
}

func (h *Handler) canCancelRoomInvocation(ctx context.Context, room db.Room, member db.RoomMember, userID string, inv db.MentionInvocation) bool {
	if member.Role == "owner" || member.Role == "admin" {
		return true
	}
	msg, err := h.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: inv.MessageID, RoomID: room.ID,
	})
	if err != nil {
		return false
	}
	if msg.SenderType == "user" && msg.SenderID.Valid {
		return msg.SenderID.Bytes == parseUUID(userID).Bytes
	}
	return false
}

func (h *Handler) CancelInvocation(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	invID := chi.URLParam(r, "invocationId")
	invUUID, ok := parseUUIDOrBadRequest(w, invID, "invocation id")
	if !ok {
		return
	}
	inv, err := h.Queries.GetMentionInvocation(r.Context(), invUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "invocation not found")
		return
	}
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, uuidToString(inv.RoomID))
	if !ok {
		return
	}
	if !h.canCancelRoomInvocation(r.Context(), room, member, userID, inv) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	inv, err = h.Queries.CancelMentionInvocation(r.Context(), db.CancelMentionInvocationParams{
		ID:          inv.ID,
		CancelledBy: parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "invocation not found or already finished")
		return
	}
	var agentID pgtype.UUID
	if inv.TaskID.Valid {
		if task, cancelErr := h.TaskService.CancelTask(r.Context(), inv.TaskID); cancelErr == nil && task != nil {
			agentID = task.AgentID
		}
	}
	if !agentID.Valid {
		room, roomErr := h.Queries.GetRoom(r.Context(), inv.RoomID)
		if roomErr == nil {
			if resolved, _, resolveErr := h.TaskService.ResolveRoomMentionAgent(r.Context(), room.WorkspaceID, util.Mention{
				Type: inv.TargetType,
				ID:   uuidToString(inv.TargetID),
			}); resolveErr == nil {
				agentID = resolved
			}
		}
	}
	if agentID.Valid {
		h.TaskService.DrainQueuedRoomInvocations(r.Context(), agentID)
	}
	h.TaskService.RefreshRoomSnapshot(r.Context(), inv.RoomID)
	h.TaskService.MaybeRecordInvocationStatusFlowEvent(r.Context(), room, inv, "cancelled")
	h.publishRoom(protocol.EventRoomInvocationUpdated, workspaceID, "member", userID, map[string]string{
		"room_id": uuidToString(inv.RoomID),
	})
	h.logRoomAudit(r.Context(), workspaceID, "member", userID, "invocation_cancelled", map[string]string{
		"invocation_id": uuidToString(inv.ID),
		"room_id":       uuidToString(inv.RoomID),
	})
	writeJSON(w, http.StatusOK, invocationToResponse(inv))
}

func (h *Handler) ResumeInvocation(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	invID := chi.URLParam(r, "invocationId")
	invUUID, ok := parseUUIDOrBadRequest(w, invID, "invocation id")
	if !ok {
		return
	}
	inv, err := h.Queries.GetMentionInvocation(r.Context(), invUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "invocation not found")
		return
	}
	if inv.Status != "paused" {
		writeError(w, http.StatusBadRequest, "invocation is not paused")
		return
	}
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, uuidToString(inv.RoomID))
	if !ok {
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "admin required to resume chain")
		return
	}
	msg, err := h.Queries.GetRoomMessageInRoom(r.Context(), db.GetRoomMessageInRoomParams{
		ID:     inv.MessageID,
		RoomID: room.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "source message not found")
		return
	}
	agentID, isLeader, err := h.TaskService.ResolveRoomMentionAgent(r.Context(), room.WorkspaceID, util.Mention{
		Type: inv.TargetType,
		ID:   uuidToString(inv.TargetID),
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid invocation target")
		return
	}
	inv, err = h.Queries.UpdateMentionInvocationStatus(r.Context(), db.UpdateMentionInvocationStatusParams{
		ID:     inv.ID,
		Status: "pending",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to resume invocation")
		return
	}
	task, err := h.TaskService.EnqueueRoomInvocationTask(r.Context(), service.EnqueueRoomInvocationParams{
		Room:       room,
		Message:    msg,
		Invocation: inv,
		AgentID:    agentID,
		IsLeader:   isLeader,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to enqueue task")
		return
	}
	now := time.Now()
	inv, _ = h.Queries.UpdateMentionInvocationStatus(r.Context(), db.UpdateMentionInvocationStatusParams{
		ID:          inv.ID,
		Status:      "queued",
		TaskID:      task.ID,
		DeliveredAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	h.TaskService.DrainQueuedRoomInvocations(r.Context(), agentID)
	h.TaskService.RefreshRoomSnapshot(r.Context(), inv.RoomID)
	h.logRoomAudit(r.Context(), workspaceID, "member", userID, "invocation_resumed", map[string]string{
		"invocation_id": uuidToString(inv.ID),
	})
	writeJSON(w, http.StatusOK, invocationToResponse(inv))
}

func (h *Handler) DecideApproval(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	approvalID := chi.URLParam(r, "approvalId")
	approvalUUID, ok := parseUUIDOrBadRequest(w, approvalID, "approval id")
	if !ok {
		return
	}
	var req DecideApprovalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	decision := strings.ToLower(strings.TrimSpace(req.Decision))
	if decision != "approved" && decision != "rejected" {
		writeError(w, http.StatusBadRequest, "decision must be approved or rejected")
		return
	}
	approval, err := h.Queries.GetApprovalRequest(r.Context(), approvalUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "approval not found")
		return
	}
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, uuidToString(approval.RoomID))
	if !ok {
		return
	}
	if member.Role == "guest" {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	_ = room
	var rejectReason pgtype.Text
	if decision == "rejected" {
		rejectReason = pgtype.Text{String: req.RejectReason, Valid: true}
	}
	approval, err = h.Queries.DecideApprovalRequest(r.Context(), db.DecideApprovalRequestParams{
		ID:           approval.ID,
		Status:       decision,
		DecidedBy:    parseUUID(userID),
		RejectReason: rejectReason,
	})
	if err != nil {
		writeError(w, http.StatusConflict, "approval already decided")
		return
	}
	h.logRoomAudit(r.Context(), workspaceID, "member", userID, "approval_decided", map[string]string{
		"approval_id": uuidToString(approval.ID),
		"decision":    decision,
		"room_id":     uuidToString(approval.RoomID),
	})
	if approval.InvocationID.Valid {
		if decision == "approved" {
			inv, invErr := h.Queries.GetMentionInvocation(r.Context(), approval.InvocationID)
			if invErr == nil && inv.Status == "pending" {
				room, roomErr := h.Queries.GetRoom(r.Context(), approval.RoomID)
				msg, msgErr := h.Queries.GetRoomMessageInRoom(r.Context(), db.GetRoomMessageInRoomParams{
					ID:     inv.MessageID,
					RoomID: approval.RoomID,
				})
				if roomErr == nil && msgErr == nil {
					agentID, isLeader, _ := h.TaskService.ResolveRoomMentionAgent(r.Context(), room.WorkspaceID, util.Mention{
						Type: inv.TargetType,
						ID:   uuidToString(inv.TargetID),
					})
					if task, enqueueErr := h.TaskService.EnqueueRoomInvocationTask(r.Context(), service.EnqueueRoomInvocationParams{
						Room: room, Message: msg, Invocation: inv, AgentID: agentID, IsLeader: isLeader,
					}); enqueueErr == nil {
						now := time.Now()
						_, _ = h.Queries.UpdateMentionInvocationStatus(r.Context(), db.UpdateMentionInvocationStatusParams{
							ID: inv.ID, Status: "queued", TaskID: task.ID,
							DeliveredAt: pgtype.Timestamptz{Time: now, Valid: true},
						})
					}
				}
			}
		} else if decision == "rejected" {
			_, _ = h.Queries.CancelMentionInvocation(r.Context(), db.CancelMentionInvocationParams{
				ID: approval.InvocationID, CancelledBy: parseUUID(userID),
			})
		}
		h.TaskService.RefreshRoomSnapshot(r.Context(), approval.RoomID)
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"id":     uuidToString(approval.ID),
		"status": approval.Status,
	})
}
