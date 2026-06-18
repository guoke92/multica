package service

import (
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/stretchr/testify/require"
)

func TestChainDepthPauseThreshold(t *testing.T) {
	maxDepth := 5
	for _, tc := range []struct {
		depth  int32
		paused bool
	}{
		{0, false},
		{4, false},
		{5, true},
	} {
		paused := maxDepth > 0 && int(tc.depth) >= maxDepth
		require.Equal(t, tc.paused, paused, "depth %d", tc.depth)
	}
}

func TestJsonMarshalAssignmentSnapshot(t *testing.T) {
	b := jsonMarshalAssignmentSnapshot(db.CountRoomAssignmentStatusByRoomRow{
		PendingCount:   2,
		BlockedCount:   1,
		RunningCount:   3,
		FailedCount:    0,
		CompletedCount: 4,
	})
	require.Contains(t, string(b), `"pending_count":2`)
	require.Contains(t, string(b), `"blocked_count":1`)
	require.Contains(t, string(b), `"completed_count":4`)
}
