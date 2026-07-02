package service

import (
	"encoding/json"
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestDefaultRoomPolicy_ManagerRetryDefaults(t *testing.T) {
	p := DefaultRoomPolicy("dev-team")
	if p.Fallback.ManagerMaxRetries != 1 {
		t.Errorf("ManagerMaxRetries = %d, want 1", p.Fallback.ManagerMaxRetries)
	}
	if p.Fallback.ManagerSoftWarnSeconds != 90 {
		t.Errorf("ManagerSoftWarnSeconds = %d, want 90", p.Fallback.ManagerSoftWarnSeconds)
	}
}

func TestParseRoomPolicy_ManagerRetryCustomization(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantMax int
		wantSec int
	}{
		{
			name:    "explicit",
			raw:     `{"fallback":{"manager_max_retries":3,"manager_soft_warn_seconds":120}}`,
			wantMax: 3,
			wantSec: 120,
		},
		{
			name:    "zero warmup falls back to default",
			raw:     `{}`,
			wantMax: 1,
			wantSec: 90,
		},
		{
			name:    "negative retries clamped to zero",
			raw:     `{"fallback":{"manager_max_retries":-2}}`,
			wantMax: 0,
			wantSec: 90,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := ParseRoomPolicy([]byte(tc.raw))
			if p.Fallback.ManagerMaxRetries != tc.wantMax {
				t.Errorf("ManagerMaxRetries = %d, want %d", p.Fallback.ManagerMaxRetries, tc.wantMax)
			}
			if p.Fallback.ManagerSoftWarnSeconds != tc.wantSec {
				t.Errorf("ManagerSoftWarnSeconds = %d, want %d", p.Fallback.ManagerSoftWarnSeconds, tc.wantSec)
			}
		})
	}
}

func TestRoomManagerMaxRetriesAndSoftWarnHelpers(t *testing.T) {
	policy, _ := json.Marshal(RoomPolicy{
		Fallback: RoomPolicyFallback{
			ManagerMaxRetries:      2,
			ManagerSoftWarnSeconds: 60,
		},
	})
	room := db.Room{Policy: policy}
	if got := RoomManagerMaxRetries(room); got != 2 {
		t.Errorf("RoomManagerMaxRetries = %d, want 2", got)
	}
	if got := RoomManagerSoftWarnSeconds(room); got != 60 {
		t.Errorf("RoomManagerSoftWarnSeconds = %d, want 60", got)
	}

	empty := db.Room{}
	if got := RoomManagerMaxRetries(empty); got != 1 {
		t.Errorf("default RoomManagerMaxRetries = %d, want 1", got)
	}
	if got := RoomManagerSoftWarnSeconds(empty); got != 90 {
		t.Errorf("default RoomManagerSoftWarnSeconds = %d, want 90", got)
	}
}
