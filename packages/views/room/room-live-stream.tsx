"use client";

import { useQuery } from "@tanstack/react-query";
import { isTaskMessageTaskId, taskMessagesOptions } from "@multica/core/chat/queries";
import { buildTimeline, ProcessTimelineView } from "../common/task-transcript";
import { UnicodeSpinner } from "@multica/ui/components/common/unicode-spinner";
import { cn } from "@multica/ui/lib/utils";

type Props = {
  taskId: string;
  agentLabel?: string;
};

/** Live agent output while a room invocation task is running (WS-backed task messages). */
export function RoomLiveStream({ taskId, agentLabel }: Props) {
  const { data: taskMessages = [] } = useQuery({
    ...taskMessagesOptions(taskId),
    enabled: isTaskMessageTaskId(taskId),
  });

  const timeline = buildTimeline(taskMessages);
  const hasContent = timeline.length > 0;

  return (
    <div className="w-full space-y-1.5">
      {agentLabel ? (
        <p className="text-muted-foreground text-xs font-medium">{agentLabel}</p>
      ) : null}
      {hasContent ? (
        <ProcessTimelineView items={timeline} isStreaming />
      ) : (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <UnicodeSpinner name="breathe" className="opacity-70" />
          <span className={cn("animate-chat-text-shimmer")}>思考中</span>
        </div>
      )}
    </div>
  );
}
