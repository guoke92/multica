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

func TestJsonMarshalRoomSnapshot(t *testing.T) {
	b := jsonMarshalRoomSnapshot(db.CountInvocationStatusByRoomRow{
		PendingCount:  2,
		QueuedCount:   1,
		RunningCount:  3,
		FailedCount:   0,
		TimedOutCount: 1,
	})
	require.Contains(t, string(b), `"pending_count":2`)
	require.Contains(t, string(b), `"timed_out_count":1`)
}
