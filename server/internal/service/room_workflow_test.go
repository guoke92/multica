package service

import "testing"

func TestParseWorkflowActionFromOutput(t *testing.T) {
	raw := `Done.

` + "```json\n{\"workflow_action\":{\"action\":\"create_delivery\",\"title\":\"贪吃蛇\"}}\n```"
	action, ok := parseWorkflowActionFromOutput(raw)
	if !ok {
		t.Fatal("expected parsed action")
	}
	if action.Action != "create_delivery" || action.Title != "贪吃蛇" {
		t.Fatalf("unexpected action: %+v", action)
	}
}

func TestParseWorkflowActionFromOutput_RawJSON(t *testing.T) {
	action, ok := parseWorkflowActionFromOutput(`{"workflow_action":{"action":"dispatch_role","role_key":"frontend"}}`)
	if !ok || action.Action != "dispatch_role" || action.RoleKey != "frontend" {
		t.Fatalf("unexpected: %+v ok=%v", action, ok)
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
