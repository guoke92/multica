package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// HumanInteractionOption is one selectable choice in an ask/confirm prompt.
type HumanInteractionOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type createRoomHumanInteractionParams struct {
	Room              db.Room
	Kind              string
	Title             string
	Body              string
	Options           []HumanInteractionOption
	AllowCustom       bool
	InvocationID      pgtype.UUID
	AssignmentID      pgtype.UUID
	DecisionID        pgtype.UUID
	ApprovalRequestID pgtype.UUID
	CreatedByType     string
	CreatedByID       pgtype.UUID
}

func (s *TaskService) createRoomHumanInteraction(
	ctx context.Context,
	p createRoomHumanInteractionParams,
) (db.RoomHumanInteraction, error) {
	body := strings.TrimSpace(p.Body)
	if body == "" && p.Kind != "approve" {
		return db.RoomHumanInteraction{}, fmt.Errorf("human interaction body is required")
	}
	opts := p.Options
	if opts == nil {
		opts = []HumanInteractionOption{}
	}
	optBytes, _ := json.Marshal(opts)
	var title pgtype.Text
	if t := strings.TrimSpace(p.Title); t != "" {
		title = pgtype.Text{String: t, Valid: true}
	}
	row, err := s.Queries.CreateRoomHumanInteraction(ctx, db.CreateRoomHumanInteractionParams{
		ID:                  util.MustNewUUIDv7(),
		RoomID:              p.Room.ID,
		Kind:                p.Kind,
		Status:              "pending",
		Title:               title,
		Body:                body,
		Options:             optBytes,
		AllowCustomResponse: p.AllowCustom,
		InvocationID:        p.InvocationID,
		AssignmentID:        p.AssignmentID,
		DecisionID:          p.DecisionID,
		ApprovalRequestID:   p.ApprovalRequestID,
		CreatedByType:       p.CreatedByType,
		CreatedByID:         p.CreatedByID,
	})
	if err != nil {
		return db.RoomHumanInteraction{}, err
	}
	s.publishRoomHumanInteractionUpdated(ctx, p.Room, row)
	s.RefreshRoomSnapshot(ctx, p.Room.ID)
	return row, nil
}

func (s *TaskService) createManagerDecisionHumanInteraction(
	ctx context.Context,
	room db.Room,
	inv db.RoomInvocation,
	assignment db.RoomAssignment,
	decision db.RoomManagerDecision,
	decisionPayload ManagerDecision,
) error {
	msg := strings.TrimSpace(decisionPayload.Message)
	switch decisionPayload.Action {
	case "ask_user", "complete":
	default:
		return nil
	}
	if msg == "" {
		return nil
	}
	kind := "notify"
	title := "群管理"
	allowCustom := decisionPayload.AllowCustom
	options := decisionPayload.Options
	switch decisionPayload.Action {
	case "ask_user":
		kind = "ask"
		if len(options) == 0 {
			options = []HumanInteractionOption{
				{ID: "yes", Label: "是"},
				{ID: "no", Label: "否"},
			}
			kind = "confirm"
		}
	case "complete":
		kind = "notify"
	}
	_, err := s.createRoomHumanInteraction(ctx, createRoomHumanInteractionParams{
		Room:          room,
		Kind:          kind,
		Title:         title,
		Body:          msg,
		Options:       options,
		AllowCustom:   allowCustom || kind == "ask",
		InvocationID:  inv.ID,
		AssignmentID:  assignment.ID,
		DecisionID:    decision.ID,
		CreatedByType: "agent",
		CreatedByID:   room.ManagerAgentID,
	})
	return err
}

func (s *TaskService) createApprovalHumanInteraction(
	ctx context.Context,
	room db.Room,
	inv db.RoomInvocation,
	assignment db.RoomAssignment,
	req db.ApprovalRequest,
	actionType string,
) error {
	title := "需要你的确认"
	body := fmt.Sprintf("Agent 请求批准：%s", actionType)
	_, err := s.createRoomHumanInteraction(ctx, createRoomHumanInteractionParams{
		Room:              room,
		Kind:              "approve",
		Title:             title,
		Body:              body,
		InvocationID:      inv.ID,
		AssignmentID:      assignment.ID,
		ApprovalRequestID: req.ID,
		CreatedByType:     "system",
	})
	return err
}

type RespondRoomHumanInteractionParams struct {
	Room           db.Room
	InteractionID  pgtype.UUID
	UserID         pgtype.UUID
	OptionID       string
	ResponseText   string
	Approved       *bool
	RejectReason   string
	AuthorType     string
	AuthorID       string
	WorkspaceID    string
	CanAccessAgent func(context.Context, db.Agent, string, string, string) bool
	MaxChainDepth  int
}

// RespondRoomHumanInteraction records the user's answer and runs side effects.
func (s *TaskService) RespondRoomHumanInteraction(
	ctx context.Context,
	p RespondRoomHumanInteractionParams,
) (db.RoomHumanInteraction, *db.RoomMessage, RoomGraphProcessResult, error) {
	interaction, err := s.Queries.GetRoomHumanInteractionInRoom(ctx, db.GetRoomHumanInteractionInRoomParams{
		ID: p.InteractionID, RoomID: p.Room.ID,
	})
	if err != nil {
		return db.RoomHumanInteraction{}, nil, RoomGraphProcessResult{}, err
	}
	if interaction.Status != "pending" {
		return db.RoomHumanInteraction{}, nil, RoomGraphProcessResult{}, fmt.Errorf("interaction already closed")
	}

	resolvedText := strings.TrimSpace(p.ResponseText)
	optIDText := strings.TrimSpace(p.OptionID)
	if interaction.Kind == "approve" {
		if p.Approved == nil {
			return db.RoomHumanInteraction{}, nil, RoomGraphProcessResult{}, fmt.Errorf("approved is required")
		}
		if *p.Approved {
			resolvedText = "已批准"
			optIDText = "approved"
		} else {
			resolvedText = "已拒绝"
			optIDText = "rejected"
			if rr := strings.TrimSpace(p.RejectReason); rr != "" {
				resolvedText = "已拒绝：" + rr
			}
		}
	} else if optIDText != "" {
		var options []HumanInteractionOption
		_ = json.Unmarshal(interaction.Options, &options)
		for _, opt := range options {
			if opt.ID == optIDText {
				resolvedText = opt.Label
				break
			}
		}
	}
	if resolvedText == "" {
		return db.RoomHumanInteraction{}, nil, RoomGraphProcessResult{}, fmt.Errorf("response is required")
	}

	var optID pgtype.Text
	if optIDText != "" {
		optID = pgtype.Text{String: optIDText, Valid: true}
	}
	updated, err := s.Queries.RespondRoomHumanInteraction(ctx, db.RespondRoomHumanInteractionParams{
		ID:               interaction.ID,
		RoomID:           p.Room.ID,
		ResponseText:     pgtype.Text{String: resolvedText, Valid: true},
		ResponseOptionID: optID,
		RespondedBy:      p.UserID,
	})
	if err != nil {
		return db.RoomHumanInteraction{}, nil, RoomGraphProcessResult{}, err
	}
	s.publishRoomHumanInteractionUpdated(ctx, p.Room, updated)

	var msg db.RoomMessage
	var result RoomGraphProcessResult

	switch interaction.Kind {
	case "approve":
		if !interaction.ApprovalRequestID.Valid {
			return updated, nil, result, fmt.Errorf("approval request missing")
		}
		approval, aErr := s.Queries.GetApprovalRequest(ctx, interaction.ApprovalRequestID)
		if aErr != nil {
			return updated, nil, result, aErr
		}
		decision := "rejected"
		if p.Approved != nil && *p.Approved {
			decision = "approved"
		}
		var rejectReason pgtype.Text
		if decision == "rejected" {
			rejectReason = pgtype.Text{String: p.RejectReason, Valid: true}
		}
		approval, aErr = s.Queries.DecideApprovalRequest(ctx, db.DecideApprovalRequestParams{
			ID: approval.ID, Status: decision,
			DecidedBy: p.UserID, RejectReason: rejectReason,
		})
		if aErr != nil {
			return updated, nil, result, aErr
		}
		if approval.RoomInvocationID.Valid {
			if inv, invErr := s.Queries.GetRoomInvocation(ctx, approval.RoomInvocationID); invErr == nil {
				if decision == "approved" {
					_, _ = s.ApproveRoomAssignment(ctx, p.Room, inv.AssignmentID, p.UserID)
				} else {
					_ = s.CancelAssignment(ctx, p.Room, inv.AssignmentID, p.UserID)
				}
			}
		}
	default:
		created, cErr := s.Queries.CreateRoomMessage(ctx, db.CreateRoomMessageParams{
			ID:         util.MustNewUUIDv7(),
			RoomID:     p.Room.ID,
			SenderType: "user",
			SenderID:   p.UserID,
			Content:    resolvedText,
		})
		if cErr != nil {
			return updated, nil, result, cErr
		}
		msg = created
		s.RecordUserMessageFlowEvent(ctx, p.Room, msg, p.UserID)
		_ = s.Queries.TouchRoom(ctx, p.Room.ID)
		if p.CanAccessAgent != nil {
			result, err = s.RouteRoomMessage(ctx, RoomMentionDispatchParams{
				Room:           p.Room,
				Message:        msg,
				AuthorType:     p.AuthorType,
				AuthorID:       p.AuthorID,
				WorkspaceID:    p.WorkspaceID,
				CanAccessAgent: p.CanAccessAgent,
				MaxChainDepth:  p.MaxChainDepth,
				DefaultTimeout: 30 * time.Minute,
			})
			if err != nil {
				return updated, &msg, result, err
			}
		}
	}

	s.RefreshRoomSnapshot(ctx, p.Room.ID)
	if msg.ID.Valid {
		return updated, &msg, result, nil
	}
	return updated, nil, result, nil
}

// DismissRoomHumanInteraction marks a notify-style prompt as read.
func (s *TaskService) DismissRoomHumanInteraction(
	ctx context.Context,
	room db.Room,
	interactionID pgtype.UUID,
) (db.RoomHumanInteraction, error) {
	updated, err := s.Queries.DismissRoomHumanInteraction(ctx, db.DismissRoomHumanInteractionParams{
		ID: interactionID, RoomID: room.ID,
	})
	if err != nil {
		return db.RoomHumanInteraction{}, err
	}
	s.publishRoomHumanInteractionUpdated(ctx, room, updated)
	s.RefreshRoomSnapshot(ctx, room.ID)
	return updated, nil
}

func (s *TaskService) publishRoomHumanInteractionUpdated(ctx context.Context, room db.Room, row db.RoomHumanInteraction) {
	if s.Bus == nil {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomHumanInteractionUpdated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		Payload: map[string]string{
			"room_id":        util.UUIDToString(room.ID),
			"interaction_id": util.UUIDToString(row.ID),
			"status":         row.Status,
		},
	})
}
