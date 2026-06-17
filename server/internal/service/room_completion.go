package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
	"github.com/multica-ai/multica/server/pkg/redact"
)

type roomInvocationCommitOpts struct {
	failureReason     string
	responseMessageID pgtype.UUID
	completedAt       time.Time
}

// maybeRequestRoomApprovalFromResult checks task result JSON for approval_required.
func (s *TaskService) maybeRequestRoomApprovalFromResult(ctx context.Context, task db.AgentTaskQueue, result []byte) bool {
	if !task.RoomID.Valid || !task.InvocationID.Valid || len(result) == 0 {
		return false
	}
	var payload struct {
		ApprovalRequired bool   `json:"approval_required"`
		ApprovalAction   string `json:"approval_action"`
	}
	if err := json.Unmarshal(result, &payload); err != nil || !payload.ApprovalRequired {
		return false
	}
	action := payload.ApprovalAction
	if action == "" {
		action = "execution"
	}
	room, err := s.Queries.GetRoom(ctx, task.RoomID)
	if err != nil {
		return false
	}
	_, _, err = s.RequestRoomApproval(ctx, RequestRoomApprovalParams{
		Room:         room,
		InvocationID: task.InvocationID,
		RequesterID:  task.AgentID,
		ActionType:   action,
	})
	return err == nil
}

// reconcileRoomInvocationCancelled marks the invocation cancelled when its task
// is cancelled (same path as chat Stop → cancelTaskById → daemon interrupt).
func (s *TaskService) reconcileRoomInvocationCancelled(ctx context.Context, task db.AgentTaskQueue) {
	if !task.RoomID.Valid || !task.InvocationID.Valid {
		return
	}
	inv, err := s.Queries.GetMentionInvocation(ctx, task.InvocationID)
	if err != nil {
		return
	}
	if inv.Status == "succeeded" || inv.Status == "cancelled" {
		return
	}
	now := time.Now()
	inv, _ = s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
		ID:          inv.ID,
		Status:      "cancelled",
		CompletedAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if room, roomErr := s.Queries.GetRoom(ctx, task.RoomID); roomErr == nil {
		s.MaybeRecordInvocationStatusFlowEvent(ctx, room, inv, "cancelled")
	}
	s.RefreshRoomSnapshot(ctx, task.RoomID)
	s.publishRoomInvocationUpdated(ctx, task.RoomID)
	s.DrainQueuedRoomInvocations(ctx, task.AgentID)
}

func (s *TaskService) commitRoomInvocationStatus(
	ctx context.Context,
	task db.AgentTaskQueue,
	status string,
	opts roomInvocationCommitOpts,
) {
	if !task.InvocationID.Valid {
		return
	}
	params := db.UpdateMentionInvocationStatusParams{
		ID:     task.InvocationID,
		Status: status,
	}
	if opts.failureReason != "" {
		params.FailureReason = pgtype.Text{String: opts.failureReason, Valid: true}
	}
	if opts.responseMessageID.Valid {
		params.ResponseMessageID = opts.responseMessageID
	}
	if !opts.completedAt.IsZero() {
		params.CompletedAt = pgtype.Timestamptz{Time: opts.completedAt, Valid: true}
	}
	if _, err := s.Queries.UpdateMentionInvocationStatus(ctx, params); err != nil {
		slog.Warn("update room invocation status failed",
			"invocation_id", util.UUIDToString(task.InvocationID),
			"status", status,
			"error", err,
		)
		return
	}
	if task.RoomID.Valid {
		if room, roomErr := s.Queries.GetRoom(ctx, task.RoomID); roomErr == nil {
			if inv, invErr := s.loadMentionInvocation(ctx, task.InvocationID); invErr == nil {
				s.MaybeRecordInvocationStatusFlowEvent(ctx, room, inv, status)
			}
		}
		s.RefreshRoomSnapshot(ctx, task.RoomID)
		s.publishRoomInvocationUpdated(ctx, task.RoomID)
	}
}

// finalizeRoomInvocation completes or fails the invocation tied to a room task.
func (s *TaskService) finalizeRoomInvocation(ctx context.Context, task db.AgentTaskQueue, status string, output string, failureReason string) {
	if !task.InvocationID.Valid {
		return
	}
	now := time.Now()
	terminalStatus := status
	failureReasonText := failureReason
	var responseMsgID pgtype.UUID
	invocationCommitted := false

	if status == "succeeded" {
		body := s.resolveRoomTaskBody(ctx, task, output)
		if strings.TrimSpace(body) == "" {
			terminalStatus = "failed"
			failureReasonText = "empty agent response"
		} else {
			room, roomErr := s.Queries.GetRoom(ctx, task.RoomID)
			if roomErr != nil {
				terminalStatus = "failed"
				failureReasonText = "room not found while posting reply"
			} else {
				inv, invLoadErr := s.loadMentionInvocation(ctx, task.InvocationID)
				managerRun := room.ManagerAgentID.Valid &&
					task.AgentID.Bytes == room.ManagerAgentID.Bytes &&
					invLoadErr == nil &&
					(inv.Intent == "orchestrate" || inv.Intent == "route" ||
						inv.Intent == "review" || inv.Intent == "confirm" || inv.Intent == "escalate")

				if managerRun {
					// Router/Supervisor: workflow footer handles routing; no agent reply row.
				} else {
					// G2: persist terminal status before posting the reply message.
					s.commitRoomInvocationStatus(ctx, task, "succeeded", roomInvocationCommitOpts{
						completedAt: now,
					})
					invocationCommitted = true

					short := truncateForSummary(body, 500)
					triggerMessageID := ""
					if task.RoomMessageID.Valid {
						triggerMessageID = util.UUIDToString(task.RoomMessageID)
					}
					meta, _ := json.Marshal(map[string]string{
						"detailed_explanation": body,
						"task_id":              util.UUIDToString(task.ID),
						"invocation_id":        util.UUIDToString(task.InvocationID),
						"trigger_message_id":   triggerMessageID,
					})
					msg, err := s.Queries.CreateRoomMessage(ctx, db.CreateRoomMessageParams{
						RoomID: task.RoomID, SenderType: "agent",
						SenderID: pgtype.UUID{Bytes: task.AgentID.Bytes, Valid: true},
						Content:  redact.Text(short), Metadata: meta,
						QuoteMessageID: task.RoomMessageID,
					})
					if err != nil {
						s.commitRoomInvocationStatus(ctx, task, "failed", roomInvocationCommitOpts{
							failureReason: "failed to post agent reply",
							completedAt:   now,
						})
						invocationCommitted = true
					} else {
						responseMsgID = msg.ID
						// G2 follow-up: attach response_message_id without re-firing
						// invocation_succeeded (already emitted by the pre-commit above).
						if _, updateErr := s.Queries.UpdateMentionInvocationStatus(ctx, db.UpdateMentionInvocationStatusParams{
							ID:                task.InvocationID,
							Status:            "succeeded",
							ResponseMessageID: msg.ID,
						}); updateErr != nil {
							slog.Warn("attach response_message_id failed",
								"invocation_id", util.UUIDToString(task.InvocationID),
								"error", updateErr,
							)
						}
						s.publishRoomMessage(ctx, room, msg, task)

						if atMentions, atErr := s.collectRoomMentions(ctx, room, body); atErr == nil {
							parentInv, parentInvErr := s.loadMentionInvocation(ctx, task.InvocationID)
							for _, atM := range atMentions {
								if atM.Type != "agent" || atM.ID == util.UUIDToString(task.AgentID) {
									continue
								}
								atTargetID := parseUUID(atM.ID)
								if !atTargetID.Valid {
									continue
								}
								atSourceID := pgtype.UUID{Bytes: task.AgentID.Bytes, Valid: true}
								fromName := s.resolveAgentName(ctx, atSourceID)
								toName := s.resolveAgentName(ctx, atTargetID)
								if parentInvErr == nil {
									label := fromName + " → @" + toName
									payload, _ := json.Marshal(map[string]any{
										"label":           label,
										"from_agent_id":   util.UUIDToString(atSourceID),
										"from_agent_name": fromName,
										"to_agent_id":     atM.ID,
										"to_agent_name":   toName,
									})
									topicID := s.resolveFlowEventTopicID(ctx, room.ID, parentInv)
									s.RecordRoomFlowEvent(ctx, room, db.InsertRoomFlowEventParams{
										RoomID:        room.ID,
										TopicID:       topicID,
										Category:      pgtype.Text{String: "control", Valid: true},
										StepID:        pgtype.Text{String: "relay:" + util.UUIDToString(task.InvocationID), Valid: true},
										FromMessageID: parentInv.MessageID,
										ToMessageID:   msg.ID,
										Type:          "agent_at_succeeded",
										MessageID:     msg.ID,
										InvocationID:  task.InvocationID,
										ActorType:     "agent",
										ActorID:       atSourceID,
										Payload:       payload,
									})
								}
							}
						}

						if _, err := s.DispatchRoomMentions(ctx, RoomMentionDispatchParams{
							Room: room, Message: msg,
							AuthorType: "agent", AuthorID: util.UUIDToString(task.AgentID),
							WorkspaceID:    util.UUIDToString(room.WorkspaceID),
							CanAccessAgent: func(_ context.Context, _ db.Agent, _, _, _ string) bool { return true },
							MaxChainDepth:  RoomMaxChainDepth(room), DefaultTimeout: 30 * time.Minute,
							ParentInvocationID: task.InvocationID,
							MentionContent:     body,
						}); err != nil {
							slog.Warn("dispatch room mentions from agent reply",
								"room_id", util.UUIDToString(room.ID), "error", err,
							)
						}
					}
				}
			}
		}
	} else {
		failureReasonText = failureReason
	}

	if !invocationCommitted {
		s.commitRoomInvocationStatus(ctx, task, terminalStatus, roomInvocationCommitOpts{
			failureReason:     failureReasonText,
			responseMessageID: responseMsgID,
			completedAt:       now,
		})
	}

	inv, invErr := s.loadMentionInvocation(ctx, task.InvocationID)
	managerJustCompleted := false
	if invErr == nil {
		if room, roomErr := s.Queries.GetRoom(ctx, task.RoomID); roomErr == nil {
			body := s.resolveRoomTaskBody(ctx, task, output)
			s.ProcessRoomWorkflowOnComplete(ctx, task, inv, room, body, status == "succeeded")
			if room.ManagerAgentID.Valid && task.AgentID.Bytes == room.ManagerAgentID.Bytes {
				managerJustCompleted = true
			}
		}
	}
	if status == "succeeded" || status == "failed" {
		s.DrainQueuedRoomInvocations(ctx, task.AgentID)
	}
	if status == "succeeded" && !managerJustCompleted {
		if room, roomErr := s.Queries.GetRoom(ctx, task.RoomID); roomErr == nil {
			s.MaybeTriggerManagerProgressScan(ctx, room)
		}
	}
}

// resolveRoomTaskBody prefers the daemon's terminal output; when empty, waits
// briefly for the final task_message flush (daemon batches every ~500ms).
func (s *TaskService) resolveRoomTaskBody(
	ctx context.Context,
	task db.AgentTaskQueue,
	output string,
) string {
	body := strings.TrimSpace(util.UnescapeBackslashEscapes(output))
	if body != "" || !task.ID.Valid {
		return body
	}
	const attempts = 5
	for i := 0; i < attempts; i++ {
		msgs, err := s.Queries.ListTaskMessages(ctx, task.ID)
		if err != nil {
			slog.Warn("room reply: list task messages failed",
				"task_id", util.UUIDToString(task.ID),
				"invocation_id", util.UUIDToString(task.InvocationID),
				"error", err,
			)
		} else if len(msgs) > 0 {
			body = strings.TrimSpace(extractRoomReplyFromTaskMessages(msgs))
			if body != "" {
				slog.Info("room reply: recovered output from task messages",
					"task_id", util.UUIDToString(task.ID),
					"invocation_id", util.UUIDToString(task.InvocationID),
					"message_count", len(msgs),
					"attempt", i+1,
				)
				return body
			}
		}
		if i < attempts-1 {
			time.Sleep(150 * time.Millisecond)
		}
	}
	return ""
}

func (s *TaskService) publishRoomInvocationUpdated(ctx context.Context, roomID pgtype.UUID) {
	if s.Bus == nil {
		return
	}
	room, err := s.Queries.GetRoom(ctx, roomID)
	if err != nil {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomInvocationUpdated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		Payload: map[string]string{
			"room_id": util.UUIDToString(roomID),
		},
	})
}

func (s *TaskService) publishRoomMessage(ctx context.Context, room db.Room, msg db.RoomMessage, task db.AgentTaskQueue) {
	if s.Bus == nil {
		return
	}
	payload := protocol.RoomMessagePayload{
		RoomID:    util.UUIDToString(room.ID),
		MessageID: util.UUIDToString(msg.ID),
		Role:      msg.SenderType,
		Content:   msg.Content,
		CreatedAt: msg.CreatedAt.Time.Format(time.RFC3339),
	}
	if task.ID.Valid {
		payload.TaskID = util.UUIDToString(task.ID)
	}
	actorType := msg.SenderType
	actorID := ""
	if msg.SenderID.Valid {
		actorID = util.UUIDToString(msg.SenderID)
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomMessageCreated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		ActorType:   actorType,
		ActorID:     actorID,
		Payload:     payload,
	})
	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomMessageUpdated,
		WorkspaceID: util.UUIDToString(room.WorkspaceID),
		ActorType:   actorType,
		ActorID:     actorID,
		Payload:     payload,
	})
}
