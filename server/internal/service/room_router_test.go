package service

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func dbRoomWithManager() db.Room {
	p, _ := MarshalRoomPolicy(RoomPolicy{
		WorkflowTemplate: "sqa_three_phase",
		Routing:          RoomPolicyRouting{ExplicitAgentMention: "direct"},
	})
	return db.Room{
		ManagerAgentID: pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
		Policy:         p,
	}
}

func TestValidateRoomPolicyAgents(t *testing.T) {
	p := RoomPolicy{
		RoleBindings: map[string]string{
			"frontend": "agent-1",
		},
	}
	members := map[string]struct{}{"agent-1": {}}
	if err := ValidateRoomPolicyAgents(p, members); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if err := ValidateRoomPolicyAgents(p, map[string]struct{}{}); err == nil {
		t.Fatal("expected validation error")
	}
}
