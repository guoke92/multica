package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/multica-ai/multica/server/internal/service"
)

const roomInvocationSweepInterval = 30 * time.Second

func runRoomInvocationSweeper(ctx context.Context, taskSvc *service.TaskService) {
	ticker := time.NewTicker(roomInvocationSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			taskSvc.ProcessQueuedRoomInvocations(ctx)
			n := taskSvc.SweepTimedOutRoomInvocations(ctx)
			if n > 0 {
				slog.Info("room invocation sweeper: timed out invocations", "count", n)
			}
		}
	}
}
