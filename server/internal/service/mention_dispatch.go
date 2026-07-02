package service

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// PrivateAgentGate checks whether an actor may trigger a private agent.
type PrivateAgentGate func(ctx context.Context, agent db.Agent, authorType, authorID, workspaceID string) bool

func parseUUID(s string) pgtype.UUID {
	id, err := util.ParseUUID(s)
	if err != nil {
		return pgtype.UUID{}
	}
	return id
}

// RoomMentionDispatchParams bundles inputs for processing @mentions on a room message.
type RoomMentionDispatchParams struct {
	Room           db.Room
	Message        db.RoomMessage
	AuthorType     string
	AuthorID       string
	WorkspaceID    string
	CanAccessAgent PrivateAgentGate
	MaxChainDepth  int
	DefaultTimeout time.Duration
	MentionContent string
}

// DispatchRoomMentions creates mention assignments from parsed mentions.
func (s *TaskService) DispatchRoomMentions(ctx context.Context, p RoomMentionDispatchParams) (RoomGraphProcessResult, error) {
	return s.ProcessMessageForAssignments(ctx, p)
}

// ResolveRoomMentionAgent maps a mention to the agent that should run the task.
func (s *TaskService) ResolveRoomMentionAgent(ctx context.Context, workspaceID pgtype.UUID, m util.Mention) (pgtype.UUID, bool, error) {
	if m.Type == "squad" {
		squadID := parseMentionTargetID(m)
		if !squadID.Valid {
			return pgtype.UUID{}, false, fmt.Errorf("invalid squad mention")
		}
		squad, err := s.Queries.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{
			ID: squadID, WorkspaceID: workspaceID,
		})
		if err != nil {
			return pgtype.UUID{}, false, err
		}
		if !squad.LeaderID.Valid {
			return pgtype.UUID{}, false, fmt.Errorf("squad has no leader")
		}
		return squad.LeaderID, true, nil
	}
	agentID := parseMentionTargetID(m)
	if !agentID.Valid {
		return pgtype.UUID{}, false, fmt.Errorf("invalid agent mention")
	}
	return agentID, false, nil
}

func parseMentionTargetID(m util.Mention) pgtype.UUID {
	return parseUUID(m.ID)
}

func (s *TaskService) roomMentionIntent(room db.Room) string {
	if room.ManagerAgentID.Valid {
		return "execute"
	}
	return "ask"
}

// managerDispatchIntent picks the manager daemon prompt mode for unmentioned routing.
// User messages need route/confirm; agent completions need review.
func managerDispatchIntent(p RoomMentionDispatchParams) string {
	if p.AuthorType == "user" {
		return "route"
	}
	return "review"
}
