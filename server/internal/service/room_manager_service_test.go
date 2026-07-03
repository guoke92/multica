package service

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestParseManagerDecisionFromOutput_RouteTo(t *testing.T) {
	raw := `Routing.

` + "```json\n{\"workflow_action\":{\"action\":\"route_to\",\"route_to\":\"agent-1\",\"title\":\"贪吃蛇\"}}\n```"
	decision, ok := parseManagerDecisionFromOutput(raw)
	if !ok {
		t.Fatal("expected parsed decision")
	}
	if decision.Action != "assign" || decision.RouteTo != "agent-1" || decision.Reason != "贪吃蛇" {
		t.Fatalf("unexpected decision: %+v", decision)
	}
}

func TestParseManagerDecisionFromOutput_Complete(t *testing.T) {
	decision, ok := parseManagerDecisionFromOutput(`{"workflow_action":{"action":"notify_user","message":"done"}}`)
	if !ok || decision.Action != "complete" {
		t.Fatalf("unexpected: %+v ok=%v", decision, ok)
	}
}

func TestStripManagerWorkflowFooter(t *testing.T) {
	raw := "极简贪吃蛇已交付，说一下你的偏好。\n\n```json\n{\"workflow_action\":{\"action\":\"notify_user\",\"message\":\"done\"}}\n```"
	got := stripManagerWorkflowFooter(raw)
	want := "极简贪吃蛇已交付，说一下你的偏好。"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestManagerDispatchIntent(t *testing.T) {
	user := RoomMentionDispatchParams{AuthorType: "user"}
	if got := managerDispatchIntent(user); got != "route" {
		t.Fatalf("user message: got %q want route", got)
	}
	agent := RoomMentionDispatchParams{AuthorType: "agent"}
	if got := managerDispatchIntent(agent); got != "review" {
		t.Fatalf("agent output: got %q want review", got)
	}
}

func TestRoomMentionIntent(t *testing.T) {
	svc := &TaskService{}
	room := dbRoomWithManager()
	if got := svc.roomMentionIntent(room); got != "execute" {
		t.Fatalf("got %q want execute", got)
	}
}

func TestDefaultRoomPolicy(t *testing.T) {
	p := DefaultRoomPolicy("sqa_three_phase")
	if p.Routing.Unmentioned != "manager" {
		t.Fatalf("routing: %+v", p.Routing)
	}
	if p.WorkflowTemplate != "sqa_three_phase" {
		t.Fatalf("template: %s", p.WorkflowTemplate)
	}
}

func TestParseAssignmentEscalationReason(t *testing.T) {
	raw := `{"escalation":"role_failure","failed_assignment_id":"asgn-1","allow_reassign":false,"failure_reason":"timed_out"}`
	esc, ok := parseAssignmentEscalationReason(pgtype.Text{String: raw, Valid: true})
	if !ok {
		t.Fatal("expected parsed escalation")
	}
	if esc.FailedAssignmentID != "asgn-1" || esc.AllowReassign {
		t.Fatalf("unexpected: %+v", esc)
	}
	if _, ok := parseAssignmentEscalationReason(pgtype.Text{String: "plain text", Valid: true}); ok {
		t.Fatal("expected non-json reason to fail")
	}
}
