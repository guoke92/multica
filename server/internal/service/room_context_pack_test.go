package service

import (
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestFormatManagerBrief(t *testing.T) {
	room := db.Room{ID: pgtype.UUID{Valid: true}}
	a := db.RoomAssignment{
		Kind:   "manager_relay",
		Reason: pgtype.Text{String: "仍无 ai-chat 目录", Valid: true},
	}
	got := formatManagerBrief(a, room)
	if got != "群管接力：仍无 ai-chat 目录" {
		t.Fatalf("got %q", got)
	}
}

func TestCountAgentHopsSinceUserRoot(t *testing.T) {
	userID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	agentID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	user := db.RoomMessage{
		ID: pgtype.UUID{Bytes: [16]byte{10}, Valid: true}, SenderType: "user", SenderID: userID,
	}
	agent1 := db.RoomMessage{
		ID: pgtype.UUID{Bytes: [16]byte{11}, Valid: true},
		SenderType: "agent", SenderID: agentID,
		QuoteMessageID: user.ID,
	}
	agent2 := db.RoomMessage{
		ID: pgtype.UUID{Bytes: [16]byte{12}, Valid: true},
		SenderType: "agent", SenderID: agentID,
		QuoteMessageID: agent1.ID,
	}
	byID := map[string]db.RoomMessage{
		util.UUIDToString(user.ID):  user,
		util.UUIDToString(agent1.ID): agent1,
		util.UUIDToString(agent2.ID): agent2,
	}
	if got := CountAgentHopsSinceUserRoot(agent2, byID); got != 2 {
		t.Fatalf("expected 2 hops, got %d", got)
	}
}

func TestResolveManagerScene(t *testing.T) {
	a := db.RoomAssignment{Kind: "auto_review"}
	if got := resolveManagerScene(a, "review"); got != "review" {
		t.Fatalf("got %q", got)
	}
	a.Reason = pgtype.Text{String: `{"escalation":"role_failure","failed_assignment_id":"x"}`, Valid: true}
	if got := resolveManagerScene(a, "escalate"); got != "escalate" {
		t.Fatalf("got %q", got)
	}
}

func TestRoomPromptContextRenderIncludesBrief(t *testing.T) {
	pack := RoomPromptContext{
		ManagerBrief: "群管接力：创建文件",
		HighRelevance: []RoomContextEntry{
			{MessageID: "m1", SenderType: "user", Summary: "hello"},
		},
	}
	out := pack.Render("room-1")
	if !strings.Contains(out, "群管指派说明") || !strings.Contains(out, "群管接力：创建文件") || !strings.Contains(out, "message_id=m1") {
		t.Fatalf("render missing parts: %s", out)
	}
}
