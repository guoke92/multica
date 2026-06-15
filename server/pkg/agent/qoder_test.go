package agent

import (
	"log/slog"
	"testing"
)

func TestNewReturnsQoderBackend(t *testing.T) {
	t.Parallel()
	b, err := New("qoder", Config{ExecutablePath: "/nonexistent/qoderclicn"})
	if err != nil {
		t.Fatalf("New(qoder) error: %v", err)
	}
	if _, ok := b.(*qoderBackend); !ok {
		t.Fatalf("expected *qoderBackend, got %T", b)
	}
}

func TestQoderBlockedArgsFilterACPAndYolo(t *testing.T) {
	t.Parallel()
	args := filterCustomArgs(
		[]string{"--acp", "--yolo", "--max-turns", "5"},
		qoderBlockedArgs,
		slog.Default(),
	)
	for _, blocked := range []string{"--acp", "--yolo"} {
		for _, a := range args {
			if a == blocked {
				t.Fatalf("blocked %q should have been filtered: %v", blocked, args)
			}
		}
	}
	if len(args) != 2 || args[0] != "--max-turns" || args[1] != "5" {
		t.Fatalf("unexpected filtered args: %v", args)
	}
}
