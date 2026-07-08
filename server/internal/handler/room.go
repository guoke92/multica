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
	Name           string                         `json:"name"`
	Description    string                         `json:"description"`
	Type           string                         `json:"type"`
	ManagerAgentID *string                        `json:"manager_agent_id,omitempty"`
	ManagerAgent   *CreateRoomManagerAgentRequest `json:"manager_agent,omitempty"`
	Policy         json.RawMessage                `json:"policy,omitempty"`
	AgentMemberIDs []string                       `json:"agent_member_ids,omitempty"`
	MemberUserIDs  []string                       `json:"member_user_ids,omitempty"`
}

type RoomResponse struct {
	ID             string          `json:"id"`
	WorkspaceID    string          `json:"workspace_id"`
	Name           string          `json:"name"`
	Description    string          `json:"description"`
	Type           string          `json:"type"`
	ManagerAgentID *string         `json:"manager_agent_id,omitempty"`
	Policy         json.RawMessage `json:"policy,omitempty"`
	Snapshot       json.RawMessage `json:"snapshot"`
	CreatedAt      string          `json:"created_at"`
	UpdatedAt      string          `json:"updated_at"`
}

type SendRoomMessageRequest struct {
	Content        string   `json:"content"`
	QuoteMessageID *string  `json:"quote_message_id,omitempty"`
	AttachmentIDs  []string `json:"attachment_ids,omitempty"`
}

type SendRoomMessageResponse struct {
	Message     roomGraphMessageResponse       `json:"message"`
	Mentions    []roomGraphMentionResponse     `json:"mentions,omitempty"`
	Invocations []roomGraphInvocationResponse  `json:"invocations,omitempty"`
	Assignments []AssignmentResponse           `json:"assignments,omitempty"`
}

type CreateRoomAssignmentRequest struct {
	SourceMessageID        string   `json:"source_message_id"`
	AssigneeType           string   `json:"assignee_type"`
	AssigneeID             string   `json:"assignee_id"`
	Kind                   string   `json:"kind,omitempty"`
	Reason                 string   `json:"reason,omitempty"`
	DependsOnAssignmentIDs []string `json:"depends_on_assignment_ids,omitempty"`
}

type AssignmentResponse struct {
	ID              string  `json:"id"`
	RoomID          string  `json:"room_id"`
	SourceMessageID string  `json:"source_message_id"`
	AssigneeType    string  `json:"assignee_type"`
	AssigneeID      string  `json:"assignee_id"`
	Kind            string  `json:"kind"`
	Status          string  `json:"status"`
	Reason          *string `json:"reason,omitempty"`
	OutputMessageID *string `json:"output_message_id,omitempty"`
	CreatedByType   string  `json:"created_by_type,omitempty"`
	CreatedByID              *string `json:"created_by_id,omitempty"`
	CreatedAt                string  `json:"created_at,omitempty"`
	UpdatedAt                string  `json:"updated_at,omitempty"`
	FailureAcknowledgedAt    *string `json:"failure_acknowledged_at,omitempty"`
	FailureAcknowledgedBy    *string `json:"failure_acknowledged_by,omitempty"`
	SupersededByAssignmentID *string `json:"superseded_by_assignment_id,omitempty"`
}

type InvocationResponse = roomGraphInvocationResponse

func invocationToResponse(inv db.RoomInvocation) InvocationResponse {
	item := roomGraphInvocationResponse{
		ID:              uuidToString(inv.ID),
		RoomID:          uuidToString(inv.RoomID),
		AssignmentID:    uuidToString(inv.AssignmentID),
		SourceMessageID: uuidToString(inv.SourceMessageID),
		AgentID:         uuidToString(inv.AgentID),
		Intent:          inv.Intent,
		Status:          inv.Status,
		CreatedAt:       timestampToString(inv.CreatedAt),
		UpdatedAt:       timestampToString(inv.UpdatedAt),
	}
	if inv.TaskID.Valid {
		s := uuidToString(inv.TaskID)
		item.TaskID = &s
	}
	if inv.OutputMessageID.Valid {
		s := uuidToString(inv.OutputMessageID)
		item.OutputMessageID = &s
	}
	if len(inv.Outcome) > 0 {
		item.Outcome = inv.Outcome
	}
	return item
}

type RoomMemberResponse struct {
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
	Role          string `json:"role"`
}

type roomGraphMessageResponse struct {
	ID             string          `json:"id"`
	SenderType     string          `json:"sender_type"`
	SenderID       *string         `json:"sender_id,omitempty"`
	Content        string          `json:"content"`
	QuoteMessageID *string         `json:"quote_message_id,omitempty"`
	Metadata       json.RawMessage `json:"metadata,omitempty"`
	CreatedAt      string          `json:"created_at"`
	EditedAt       *string         `json:"edited_at,omitempty"`
}

func roomMessageToGraphResponse(m db.RoomMessage) roomGraphMessageResponse {
	var senderID, quoteID *string
	if m.SenderID.Valid {
		s := uuidToString(m.SenderID)
		senderID = &s
	}
	if m.QuoteMessageID.Valid {
		s := uuidToString(m.QuoteMessageID)
		quoteID = &s
	}
	meta := m.Metadata
	if len(meta) == 0 {
		meta = []byte("{}")
	}
	var editedAt *string
	if m.EditedAt.Valid {
		s := timestampToString(m.EditedAt)
		editedAt = &s
	}
	return roomGraphMessageResponse{
		ID:             uuidToString(m.ID),
		SenderType:     m.SenderType,
		SenderID:       senderID,
		Content:        m.Content,
		QuoteMessageID: quoteID,
		Metadata:       meta,
		CreatedAt:      timestampToString(m.CreatedAt),
		EditedAt:       editedAt,
	}
}

type roomGraphMentionResponse struct {
	ID              string  `json:"id"`
	MessageID       string  `json:"message_id"`
	TargetType      string  `json:"target_type"`
	TargetID        *string `json:"target_id,omitempty"`
	SourceType      string  `json:"source_type,omitempty"`
	SourceMessageID *string `json:"source_message_id,omitempty"`
	AssignmentID    *string `json:"assignment_id,omitempty"`
	Label           *string `json:"label,omitempty"`
	SpanStart       *int32  `json:"span_start,omitempty"`
	SpanEnd         *int32  `json:"span_end,omitempty"`
	CreatedAt       string  `json:"created_at,omitempty"`
}

type roomGraphDependencyResponse struct {
	ID                    string `json:"id"`
	AssignmentID          string `json:"assignment_id"`
	DependsOnAssignmentID string `json:"depends_on_assignment_id"`
	CreatedAt             string `json:"created_at,omitempty"`
}

type roomGraphInvocationResponse struct {
	ID              string          `json:"id"`
	RoomID          string          `json:"room_id,omitempty"`
	AssignmentID    string          `json:"assignment_id"`
	SourceMessageID string          `json:"source_message_id"`
	AgentID         string          `json:"agent_id"`
	Intent          string          `json:"intent,omitempty"`
	Status          string          `json:"status"`
	TaskID          *string         `json:"task_id,omitempty"`
	OutputMessageID *string         `json:"output_message_id,omitempty"`
	Outcome         json.RawMessage `json:"outcome,omitempty"`
	CreatedAt       string          `json:"created_at,omitempty"`
	UpdatedAt       string          `json:"updated_at,omitempty"`
}

type roomGraphInvocationEventResponse struct {
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

type roomGraphManagerDecisionResponse struct {
	ID                   string          `json:"id"`
	RoomID               string          `json:"room_id"`
	SourceMessageID      string          `json:"source_message_id"`
	InvocationID         *string         `json:"invocation_id,omitempty"`
	Action               string          `json:"action"`
	Payload              json.RawMessage `json:"payload,omitempty"`
	CreatedAssignmentIDs []string        `json:"created_assignment_ids,omitempty"`
	CreatedByType        string          `json:"created_by_type,omitempty"`
	CreatedByID          *string         `json:"created_by_id,omitempty"`
	CreatedAt            string          `json:"created_at,omitempty"`
}

func roomMessagesToGraphResponse(rows []db.RoomMessage) []roomGraphMessageResponse {
	out := make([]roomGraphMessageResponse, 0, len(rows))
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
		meta := m.Metadata
		if len(meta) == 0 {
			meta = []byte("{}")
		}
		var editedAt *string
		if m.EditedAt.Valid {
			s := timestampToString(m.EditedAt)
			editedAt = &s
		}
		out = append(out, roomGraphMessageResponse{
			ID:             uuidToString(m.ID),
			SenderType:     m.SenderType,
			SenderID:       senderID,
			Content:        m.Content,
			QuoteMessageID: quoteID,
			Metadata:       meta,
			CreatedAt:      timestampToString(m.CreatedAt),
			EditedAt:       editedAt,
		})
	}
	return out
}

func roomMentionsToGraphResponse(rows []db.RoomMessageMention) []roomGraphMentionResponse {
	out := make([]roomGraphMentionResponse, 0, len(rows))
	for _, m := range rows {
		item := roomGraphMentionResponse{
			ID:         uuidToString(m.ID),
			MessageID:  uuidToString(m.MessageID),
			TargetType: m.TargetType,
			CreatedAt:  timestampToString(m.CreatedAt),
		}
		if m.TargetID.Valid {
			s := uuidToString(m.TargetID)
			item.TargetID = &s
		}
		if m.SourceType != "" {
			item.SourceType = m.SourceType
		}
		if m.SourceMessageID.Valid {
			s := uuidToString(m.SourceMessageID)
			item.SourceMessageID = &s
		}
		if m.AssignmentID.Valid {
			s := uuidToString(m.AssignmentID)
			item.AssignmentID = &s
		}
		if m.Label != "" {
			label := m.Label
			item.Label = &label
		}
		if m.SpanStart.Valid {
			v := m.SpanStart.Int32
			item.SpanStart = &v
		}
		if m.SpanEnd.Valid {
			v := m.SpanEnd.Int32
			item.SpanEnd = &v
		}
		out = append(out, item)
	}
	return out
}

func roomDependenciesToGraphResponse(rows []db.RoomAssignmentDependency) []roomGraphDependencyResponse {
	out := make([]roomGraphDependencyResponse, 0, len(rows))
	for _, d := range rows {
		out = append(out, roomGraphDependencyResponse{
			ID:                    uuidToString(d.ID),
			AssignmentID:          uuidToString(d.AssignmentID),
			DependsOnAssignmentID: uuidToString(d.DependsOnAssignmentID),
			CreatedAt:             timestampToString(d.CreatedAt),
		})
	}
	return out
}

func roomInvocationsToGraphResponse(rows []db.RoomInvocation) []roomGraphInvocationResponse {
	out := make([]roomGraphInvocationResponse, 0, len(rows))
	for _, inv := range rows {
		item := roomGraphInvocationResponse{
			ID:              uuidToString(inv.ID),
			RoomID:          uuidToString(inv.RoomID),
			AssignmentID:    uuidToString(inv.AssignmentID),
			SourceMessageID: uuidToString(inv.SourceMessageID),
			AgentID:         uuidToString(inv.AgentID),
			Intent:          inv.Intent,
			Status:          inv.Status,
			CreatedAt:       timestampToString(inv.CreatedAt),
			UpdatedAt:       timestampToString(inv.UpdatedAt),
		}
		if inv.TaskID.Valid {
			s := uuidToString(inv.TaskID)
			item.TaskID = &s
		}
		if inv.OutputMessageID.Valid {
			s := uuidToString(inv.OutputMessageID)
			item.OutputMessageID = &s
		}
		if len(inv.Outcome) > 0 {
			item.Outcome = inv.Outcome
		}
		out = append(out, item)
	}
	return out
}

func roomInvocationEventsToGraphResponse(rows []db.RoomInvocationEvent) []roomGraphInvocationEventResponse {
	out := make([]roomGraphInvocationEventResponse, 0, len(rows))
	for _, e := range rows {
		payload := e.Payload
		if len(payload) == 0 {
			payload = []byte("{}")
		}
		item := roomGraphInvocationEventResponse{
			ID:           uuidToString(e.ID),
			RoomID:       uuidToString(e.RoomID),
			AssignmentID: uuidToString(e.AssignmentID),
			Type:         e.Type,
			ActorType:    e.ActorType,
			Payload:      payload,
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
		out = append(out, item)
	}
	return out
}

func roomManagerDecisionsToGraphResponse(rows []db.RoomManagerDecision) []roomGraphManagerDecisionResponse {
	out := make([]roomGraphManagerDecisionResponse, 0, len(rows))
	for _, d := range rows {
		item := roomGraphManagerDecisionResponse{
			ID:              uuidToString(d.ID),
			RoomID:          uuidToString(d.RoomID),
			SourceMessageID: uuidToString(d.SourceMessageID),
			Action:          d.Action,
			CreatedByType:   d.CreatedByType,
			CreatedAt:       timestampToString(d.CreatedAt),
		}
		if d.InvocationID.Valid {
			s := uuidToString(d.InvocationID)
			item.InvocationID = &s
		}
		if len(d.Payload) > 0 {
			item.Payload = d.Payload
		}
		if d.CreatedByID.Valid {
			s := uuidToString(d.CreatedByID)
			item.CreatedByID = &s
		}
		if len(d.CreatedAssignmentIds) > 0 {
			ids := make([]string, 0, len(d.CreatedAssignmentIds))
			for _, id := range d.CreatedAssignmentIds {
				if id.Valid {
					ids = append(ids, uuidToString(id))
				}
			}
			if len(ids) > 0 {
				item.CreatedAssignmentIDs = ids
			}
		}
		out = append(out, item)
	}
	return out
}

func assignmentToResponse(a db.RoomAssignment) AssignmentResponse {
	var reason *string
	if a.Reason.Valid {
		reason = &a.Reason.String
	}
	var outputMessageID *string
	if a.OutputMessageID.Valid {
		s := uuidToString(a.OutputMessageID)
		outputMessageID = &s
	}
	var createdByID *string
	if a.CreatedByID.Valid {
		s := uuidToString(a.CreatedByID)
		createdByID = &s
	}
	var failureAcknowledgedAt *string
	if a.FailureAcknowledgedAt.Valid {
		s := timestampToString(a.FailureAcknowledgedAt)
		failureAcknowledgedAt = &s
	}
	var failureAcknowledgedBy *string
	if a.FailureAcknowledgedBy.Valid {
		s := uuidToString(a.FailureAcknowledgedBy)
		failureAcknowledgedBy = &s
	}
	var supersededByAssignmentID *string
	if a.SupersededByAssignmentID.Valid {
		s := uuidToString(a.SupersededByAssignmentID)
		supersededByAssignmentID = &s
	}
	return AssignmentResponse{
		ID:                       uuidToString(a.ID),
		RoomID:                     uuidToString(a.RoomID),
		SourceMessageID:            uuidToString(a.SourceMessageID),
		AssigneeType:               a.AssigneeType,
		AssigneeID:                 uuidToString(a.AssigneeID),
		Kind:                       a.Kind,
		Status:                     a.Status,
		Reason:                     reason,
		OutputMessageID:            outputMessageID,
		CreatedByType:              a.CreatedByType,
		CreatedByID:                createdByID,
		CreatedAt:                  timestampToString(a.CreatedAt),
		UpdatedAt:                  timestampToString(a.UpdatedAt),
		FailureAcknowledgedAt:      failureAcknowledgedAt,
		FailureAcknowledgedBy:      failureAcknowledgedBy,
		SupersededByAssignmentID:   supersededByAssignmentID,
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
		RoomID:        room.ID,
		PrincipalType: "user",
		PrincipalID:   parseUUID(userID),
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
	assignments, err := h.Queries.ListRoomAssignmentsBySourceMessage(ctx, messageID)
	if err != nil {
		return
	}
	userUUID := parseUUID(userID)
	for _, assignment := range assignments {
		if assignment.Status != "completed" && assignment.Status != "cancelled" {
			_ = h.TaskService.CancelAssignment(ctx, room, assignment.ID, userUUID)
		}
		if assignment.OutputMessageID.Valid {
			_ = h.Queries.SoftDeleteRoomMessage(ctx, db.SoftDeleteRoomMessageParams{
				ID:     assignment.OutputMessageID,
				RoomID: room.ID,
			})
		}
	}
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

	active, err := h.Queries.ListActiveRoomAssignmentsByRoom(r.Context(), room.ID)
	if err == nil {
		userUUID := parseUUID(userID)
		for _, assignment := range active {
			_ = h.TaskService.CancelAssignment(r.Context(), room, assignment.ID, userUUID)
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
	// and is not managing any other active room. Use the same side effects
	// as POST /api/agents/:id/archive so clients refresh archived_at.
	if room.ManagerAgentID.Valid {
		if mgr, mgrErr := h.Queries.GetAgent(r.Context(), room.ManagerAgentID); mgrErr == nil &&
			!mgr.ArchivedAt.Valid &&
			strings.HasPrefix(mgr.Description, "Room manager for ") {
			stillManaging, _ := h.Queries.IsRoomManagerAgent(r.Context(), room.ManagerAgentID)
			if !stillManaging {
				userUUID := parseUUID(userID)
				actorType, actorID := h.resolveActor(r, userID, workspaceID)
				if _, archiveErr := h.archiveAgentAndNotify(r.Context(), mgr, userUUID, actorType, actorID); archiveErr != nil {
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
			"room_id":      uuidToString(room.ID),
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
		"room_id":      uuidToString(room.ID),
		"principal_id": req.PrincipalID,
		"role":         req.Role,
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
		ID:             util.MustNewUUIDv7(),
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

	h.TaskService.RecordUserMessageFlowEvent(r.Context(), room, msg, parseUUID(userID))

	_ = h.Queries.TouchRoom(r.Context(), room.ID)

	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	result, err := h.TaskService.RouteRoomMessage(r.Context(), service.RoomMentionDispatchParams{
		Room:        room,
		Message:     msg,
		AuthorType:  actorType,
		AuthorID:    actorID,
		WorkspaceID: workspaceID,
		CanAccessAgent: func(ctx context.Context, agent db.Agent, authorType, authorID, wsID string) bool {
			return h.canAccessPrivateAgent(ctx, agent, authorType, authorID, wsID)
		},
		MaxChainDepth:  service.RoomMaxChainDepth(room),
		DefaultTimeout: defaultRoomMentionTimeout,
	})
	if err != nil {
		slog.Warn("route room message", "error", err)
	}

	h.publishRoom(protocol.EventRoomMessageCreated, workspaceID, "member", userID, protocol.RoomMessagePayload{
		RoomID:    uuidToString(room.ID),
		MessageID: uuidToString(msg.ID),
		Role:      "user",
		SenderID:  userID,
		Content:   msg.Content,
		CreatedAt: timestampToString(msg.CreatedAt),
	})

	invResp := make([]roomGraphInvocationResponse, 0, len(result.Invocations))
	for _, inv := range result.Invocations {
		invResp = append(invResp, invocationToResponse(inv))
	}
	assignResp := make([]AssignmentResponse, 0, len(result.Assignments))
	for _, a := range result.Assignments {
		assignResp = append(assignResp, assignmentToResponse(a))
	}
	mentionRows, _ := h.Queries.ListRoomMessageMentionsByMessage(r.Context(), msg.ID)

	writeJSON(w, http.StatusCreated, SendRoomMessageResponse{
		Message:     roomMessageToGraphResponse(msg),
		Mentions:    roomMentionsToGraphResponse(mentionRows),
		Invocations: invResp,
		Assignments: assignResp,
	})
}

type UpdateRoomMessageRequest struct {
	Content string `json:"content"`
}

type UpdateRoomMessageResponse struct {
	Message     roomGraphMessageResponse      `json:"message"`
	Invocations []roomGraphInvocationResponse `json:"invocations,omitempty"`
	Assignments []AssignmentResponse          `json:"assignments,omitempty"`
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
	result, err := h.TaskService.RouteRoomMessage(r.Context(), service.RoomMentionDispatchParams{
		Room:        room,
		Message:     msg,
		AuthorType:  actorType,
		AuthorID:    actorID,
		WorkspaceID: workspaceID,
		CanAccessAgent: func(ctx context.Context, agent db.Agent, authorType, authorID, wsID string) bool {
			return h.canAccessPrivateAgent(ctx, agent, authorType, authorID, wsID)
		},
		MaxChainDepth:  service.RoomMaxChainDepth(room),
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
		SenderID:  userID,
		Content:   msg.Content,
		CreatedAt: timestampToString(msg.CreatedAt),
	})

	invResp := make([]roomGraphInvocationResponse, 0, len(result.Invocations))
	for _, inv := range result.Invocations {
		invResp = append(invResp, invocationToResponse(inv))
	}
	assignResp := make([]AssignmentResponse, 0, len(result.Assignments))
	for _, a := range result.Assignments {
		assignResp = append(assignResp, assignmentToResponse(a))
	}
	writeJSON(w, http.StatusOK, UpdateRoomMessageResponse{
		Message:     roomMessageToGraphResponse(msg),
		Invocations: invResp,
		Assignments: assignResp,
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

	inv, err := h.Queries.GetRoomInvocationByOutputMessage(r.Context(), db.GetRoomInvocationByOutputMessageParams{
		OutputMessageID: agentMsg.ID,
		RoomID:          room.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "invocation not found for this message")
		return
	}
	if inv.RetryCount >= inv.MaxRetries {
		writeError(w, http.StatusBadRequest, "max retries exceeded")
		return
	}

	_ = h.Queries.SoftDeleteRoomMessage(r.Context(), db.SoftDeleteRoomMessageParams{
		ID:     agentMsg.ID,
		RoomID: room.ID,
	})

	_, _ = h.Queries.UpdateRoomAssignmentStatus(r.Context(), db.UpdateRoomAssignmentStatusParams{
		ID:     inv.AssignmentID,
		Status: "failed",
	})
	inv, err = h.TaskService.RetryRoomAssignment(r.Context(), room, inv.AssignmentID, parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invocation cannot be regenerated")
		return
	}

	h.TaskService.RefreshRoomSnapshot(r.Context(), room.ID)
	h.publishRoom(protocol.EventRoomInvocationUpdated, workspaceID, "member", userID, map[string]string{
		"room_id": uuidToString(room.ID),
	})
	writeJSON(w, http.StatusOK, invocationToResponse(inv))
}

func (h *Handler) GetRoomMessage(w http.ResponseWriter, r *http.Request) {
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
	msgUUID, ok := parseUUIDOrBadRequest(w, messageID, "message_id")
	if !ok {
		return
	}
	msg, err := h.Queries.GetRoomMessageInRoom(r.Context(), db.GetRoomMessageInRoomParams{
		ID: msgUUID, RoomID: room.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}

	type msgResp struct {
		ID                   string          `json:"id"`
		RoomID               string          `json:"room_id"`
		SenderType           string          `json:"sender_type"`
		SenderID             *string         `json:"sender_id,omitempty"`
		Content              string          `json:"content"`
		QuoteMessageID       *string         `json:"quote_message_id,omitempty"`
		Metadata             json.RawMessage `json:"metadata,omitempty"`
		CreatedAt            string          `json:"created_at"`
		EditedAt             *string         `json:"edited_at,omitempty"`
		DetailedExplanation  string          `json:"detailed_explanation,omitempty"`
		HasDetailedExplanation bool          `json:"has_detailed_explanation"`
	}
	var senderID, quoteID *string
	if msg.SenderID.Valid {
		s := uuidToString(msg.SenderID)
		senderID = &s
	}
	if msg.QuoteMessageID.Valid {
		s := uuidToString(msg.QuoteMessageID)
		quoteID = &s
	}
	meta := msg.Metadata
	if len(meta) == 0 {
		meta = []byte("{}")
	}
	var editedAt *string
	if msg.EditedAt.Valid {
		s := timestampToString(msg.EditedAt)
		editedAt = &s
	}
	detailed := ""
	hasDetailed := false
	if len(msg.Metadata) > 0 {
		var metaMap map[string]any
		if json.Unmarshal(msg.Metadata, &metaMap) == nil {
			if d, ok := metaMap["detailed_explanation"].(string); ok && strings.TrimSpace(d) != "" {
				detailed = d
				hasDetailed = true
			}
		}
	}
	writeJSON(w, http.StatusOK, msgResp{
		ID:                     uuidToString(msg.ID),
		RoomID:                 uuidToString(room.ID),
		SenderType:             msg.SenderType,
		SenderID:               senderID,
		Content:                msg.Content,
		QuoteMessageID:         quoteID,
		Metadata:               meta,
		CreatedAt:              timestampToString(msg.CreatedAt),
		EditedAt:               editedAt,
		DetailedExplanation:    detailed,
		HasDetailedExplanation: hasDetailed,
	})
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
	var before pgtype.UUID
	if b := r.URL.Query().Get("before"); b != "" {
		var err error
		before, err = util.ParseUUID(b)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid before cursor")
			return
		}
	}

	listParams := db.ListRoomMessagesParams{
		RoomID:   room.ID,
		BeforeID: before,
		Limit:    int32(limit),
	}
	rows, err := h.Queries.ListRoomMessages(r.Context(), listParams)
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
		Metadata       json.RawMessage `json:"metadata,omitempty"`
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
		meta := m.Metadata
		if len(meta) == 0 {
			meta = []byte("{}")
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
			Metadata:       meta,
			CreatedAt:      timestampToString(m.CreatedAt),
			EditedAt:       editedAt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) ListRoomInvocations(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, "room invocations list removed; use GET /rooms/:id/graph")
}

func (h *Handler) RetryInvocation(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, "global invocation retry removed; use POST /rooms/:id/assignments/:id/retry")
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
	inv, err := h.Queries.GetRoomInvocationInRoom(r.Context(), db.GetRoomInvocationInRoomParams{
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
	if err := h.TaskService.CancelAssignment(r.Context(), room, inv.AssignmentID, parseUUID(userID)); err != nil {
		writeError(w, http.StatusNotFound, "invocation not found or already finished")
		return
	}
	inv, err = h.Queries.GetRoomInvocation(r.Context(), inv.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load invocation")
		return
	}
	h.publishRoom(protocol.EventRoomInvocationUpdated, workspaceID, "member", userID, map[string]string{
		"room_id": uuidToString(inv.RoomID),
	})
	writeJSON(w, http.StatusOK, invocationToResponse(inv))
}

func (h *Handler) canCancelRoomInvocation(ctx context.Context, room db.Room, member db.RoomMember, userID string, inv db.RoomInvocation) bool {
	if member.Role == "owner" || member.Role == "admin" {
		return true
	}
	msg, err := h.Queries.GetRoomMessageInRoom(ctx, db.GetRoomMessageInRoomParams{
		ID: inv.SourceMessageID, RoomID: room.ID,
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
	writeError(w, http.StatusGone, "global invocation cancel removed; use POST /rooms/:id/invocations/:id/cancel")
}

func (h *Handler) ResumeInvocation(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, "global invocation resume removed; use POST /rooms/:id/assignments/:id/retry")
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
	if approval.RoomInvocationID.Valid {
		if decision == "approved" {
			if inv, invErr := h.Queries.GetRoomInvocation(r.Context(), approval.RoomInvocationID); invErr == nil {
				if room, roomErr := h.Queries.GetRoom(r.Context(), approval.RoomID); roomErr == nil {
					_, _ = h.TaskService.RetryRoomAssignment(r.Context(), room, inv.AssignmentID, parseUUID(userID))
				}
			}
		} else if decision == "rejected" {
			if inv, invErr := h.Queries.GetRoomInvocation(r.Context(), approval.RoomInvocationID); invErr == nil {
				if room, roomErr := h.Queries.GetRoom(r.Context(), approval.RoomID); roomErr == nil {
					_ = h.TaskService.CancelAssignment(r.Context(), room, inv.AssignmentID, parseUUID(userID))
				}
			}
		}
		h.TaskService.RefreshRoomSnapshot(r.Context(), approval.RoomID)
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"id":     uuidToString(approval.ID),
		"status": approval.Status,
	})
}

func roomGraphSnapshotResponse(snap service.RoomGraphSnapshot) map[string]any {
	assignments := make([]AssignmentResponse, 0, len(snap.Assignments))
	for _, a := range snap.Assignments {
		assignments = append(assignments, assignmentToResponse(a))
	}
	return map[string]any{
		"mentions":                roomMentionsToGraphResponse(snap.Mentions),
		"assignments":             assignments,
		"assignment_dependencies": roomDependenciesToGraphResponse(snap.AssignmentDependencies),
		"invocations":             roomInvocationsToGraphResponse(snap.Invocations),
		"decisions":               roomManagerDecisionsToGraphResponse(snap.Decisions),
		"invocation_events":       roomInvocationEventsToGraphResponse(snap.InvocationEvents),
	}
}

func (h *Handler) GetRoomGraph(w http.ResponseWriter, r *http.Request) {
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
	snap, err := h.TaskService.BuildRoomGraphSnapshot(r.Context(), room.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load room graph")
		return
	}
	writeJSON(w, http.StatusOK, roomGraphSnapshotResponse(snap))
}

func (h *Handler) CreateRoomAssignment(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	var req CreateRoomAssignmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	sourceMessageID, ok := parseUUIDOrBadRequest(w, req.SourceMessageID, "source_message_id")
	if !ok {
		return
	}
	assigneeID, ok := parseUUIDOrBadRequest(w, req.AssigneeID, "assignee_id")
	if !ok {
		return
	}
	assigneeType := strings.TrimSpace(req.AssigneeType)
	if assigneeType == "" {
		assigneeType = "agent"
	}
	kind := strings.TrimSpace(req.Kind)
	if kind == "" {
		kind = "manager_route"
	}
	depIDs := make([]pgtype.UUID, 0, len(req.DependsOnAssignmentIDs))
	for _, raw := range req.DependsOnAssignmentIDs {
		depID, ok := parseUUIDOrBadRequest(w, raw, "depends_on_assignment_ids")
		if !ok {
			return
		}
		depIDs = append(depIDs, depID)
	}

	assignment, inv, err := h.TaskService.CreateRoomAssignment(r.Context(), service.CreateRoomAssignmentParams{
		Room:                   room,
		SourceMessageID:        sourceMessageID,
		AssigneeType:           assigneeType,
		AssigneeID:             assigneeID,
		Kind:                   kind,
		Reason:                 req.Reason,
		CreatedByType:          "user",
		CreatedByID:            parseUUID(userID),
		DependsOnAssignmentIDs: depIDs,
		CanAccessAgent: func(ctx context.Context, agent db.Agent, authorType, authorID, wsID string) bool {
			return h.canAccessPrivateAgent(ctx, agent, authorType, authorID, wsID)
		},
		AuthorType:  "user",
		AuthorID:    userID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to create assignment")
		return
	}
	resp := map[string]any{
		"assignment": assignmentToResponse(assignment),
	}
	if inv.ID.Valid {
		resp["invocation"] = invocationToResponse(inv)
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) AckRoomAssignmentFailure(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	assignmentID := chi.URLParam(r, "assignmentId")
	room, _, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	assignmentUUID, ok := parseUUIDOrBadRequest(w, assignmentID, "assignment id")
	if !ok {
		return
	}
	updated, err := h.TaskService.AcknowledgeRoomAssignmentFailure(
		r.Context(),
		room,
		assignmentUUID,
		parseUUID(userID),
	)
	if err != nil {
		writeError(w, http.StatusBadRequest, "assignment failure cannot be acknowledged")
		return
	}
	h.publishRoom(protocol.EventRoomAssignmentUpdated, workspaceID, "member", userID, map[string]string{
		"room_id": uuidToString(room.ID),
	})
	writeJSON(w, http.StatusOK, assignmentToResponse(updated))
}

func (h *Handler) RetryRoomAssignment(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	assignmentID := chi.URLParam(r, "assignmentId")
	room, _, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	assignmentUUID, ok := parseUUIDOrBadRequest(w, assignmentID, "assignment id")
	if !ok {
		return
	}
	inv, err := h.TaskService.RetryRoomAssignment(r.Context(), room, assignmentUUID, parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusBadRequest, "assignment cannot be retried")
		return
	}
	h.publishRoom(protocol.EventRoomInvocationUpdated, workspaceID, "member", userID, map[string]string{
		"room_id": uuidToString(room.ID),
	})
	writeJSON(w, http.StatusOK, invocationToResponse(inv))
}

func (h *Handler) CancelRoomAssignment(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	roomID := chi.URLParam(r, "roomId")
	assignmentID := chi.URLParam(r, "assignmentId")
	room, member, ok := h.loadRoomMember(w, r, userID, workspaceID, roomID)
	if !ok {
		return
	}
	if !roomMemberCanManage(member) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	assignmentUUID, ok := parseUUIDOrBadRequest(w, assignmentID, "assignment id")
	if !ok {
		return
	}
	if err := h.TaskService.CancelAssignment(r.Context(), room, assignmentUUID, parseUUID(userID)); err != nil {
		writeError(w, http.StatusNotFound, "assignment not found or already finished")
		return
	}
	h.publishRoom(protocol.EventRoomAssignmentUpdated, workspaceID, "member", userID, map[string]string{
		"room_id":       uuidToString(room.ID),
		"assignment_id": assignmentID,
	})
	w.WriteHeader(http.StatusNoContent)
}
