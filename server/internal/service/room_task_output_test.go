package service

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func textMsg(seq int32, content string) db.TaskMessage {
	return db.TaskMessage{
		Seq:     seq,
		Type:    "text",
		Content: pgtype.Text{String: content, Valid: true},
	}
}

func thinkingMsg(seq int32, content string) db.TaskMessage {
	return db.TaskMessage{
		Seq:     seq,
		Type:    "thinking",
		Content: pgtype.Text{String: content, Valid: true},
	}
}

func toolUseMsg(seq int32) db.TaskMessage {
	return db.TaskMessage{
		Seq:  seq,
		Type: "tool_use",
		Tool: pgtype.Text{String: "bash", Valid: true},
	}
}

func TestExtractRoomReplyFromTaskMessages_PrefaceAndFinal(t *testing.T) {
	msgs := []db.TaskMessage{
		textMsg(1, "Hello"),
		toolUseMsg(2),
		thinkingMsg(3, "checking tools"),
		textMsg(4, "World"),
	}
	got := extractRoomReplyFromTaskMessages(msgs)
	want := "Hello\n\nWorld"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestExtractRoomReplyFromTaskMessages_AllText(t *testing.T) {
	msgs := []db.TaskMessage{
		textMsg(1, "Part A"),
		textMsg(2, "Part B"),
	}
	got := extractRoomReplyFromTaskMessages(msgs)
	want := "Part A\n\nPart B"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestExtractRoomReplyFromTaskMessages_ThinkingFallback(t *testing.T) {
	msgs := []db.TaskMessage{
		thinkingMsg(1, "Only streamed as thinking"),
	}
	got := extractRoomReplyFromTaskMessages(msgs)
	if got != "Only streamed as thinking" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractRoomReplyFromTaskMessages_Empty(t *testing.T) {
	if got := extractRoomReplyFromTaskMessages(nil); got != "" {
		t.Fatalf("got %q", got)
	}
}
