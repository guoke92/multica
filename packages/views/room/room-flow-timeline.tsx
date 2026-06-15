"use client";

import { useQuery } from "@tanstack/react-query";
import { roomFlowEventsOptions } from "@multica/core/room/queries";
import type { RoomFlowEvent } from "@multica/core/types/room";
import { cn } from "@multica/ui/lib/utils";

const flowToneClass = (type: string): string => {
  if (type.includes("failed") || type.includes("rejected") || type.includes("timed_out")) {
    return "text-destructive";
  }
  if (type.includes("succeeded") || type.includes("accepted")) {
    return "text-green-600 dark:text-green-500";
  }
  if (type.includes("running")) {
    return "text-primary";
  }
  return "text-muted-foreground";
};

const flowLabel = (event: RoomFlowEvent): string => {
  const payload = event.payload ?? {};
  if (typeof payload.label === "string" && payload.label) {
    return payload.label;
  }
  switch (event.type) {
    case "invocation_running":
      return "Agent · 思考中";
    case "invocation_succeeded":
      return "Agent · 完成";
    case "invocation_failed":
      return "Agent · 失败";
    case "invocation_timed_out":
      return "Agent · 超时";
    case "invocation_cancelled":
      return "已取消";
    case "human_confirm_accepted":
      return "人工确认 · 已接受";
    case "human_confirm_rejected":
      return "人工确认 · 已拒绝";
    default:
      return event.type.replace(/_/g, " ");
  }
};

type Props = {
  wsId: string;
  roomId: string;
  topicId: string | undefined;
  className?: string;
};

export function RoomFlowTimeline({ wsId, roomId, topicId, className }: Props) {
  const { data: events = [] } = useQuery(roomFlowEventsOptions(wsId, roomId, topicId));

  if (!topicId) {
    return (
      <p className={cn("text-muted-foreground px-3 py-2 text-xs", className)}>
        选择话题以查看流程动态
      </p>
    );
  }

  if (events.length === 0) {
    return (
      <p className={cn("text-muted-foreground px-3 py-2 text-xs", className)}>
        暂无流程动态
      </p>
    );
  }

  return (
    <ul className={cn("max-h-40 space-y-1 overflow-y-auto px-3 py-2", className)}>
      {events.map((event, idx) => (
        <li
          key={event.id}
          className={cn(
            "flex items-baseline justify-between gap-2 text-xs",
            flowToneClass(event.type),
            idx === events.length - 1 && "font-medium",
          )}
        >
          <span className="truncate">{flowLabel(event)}</span>
          <time className="text-muted-foreground shrink-0 text-[10px]">
            {event.created_at.slice(11, 16)}
          </time>
        </li>
      ))}
    </ul>
  );
}
