"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { roomFlowEventsOptions } from "@multica/core/room/queries";
import type { MentionInvocation } from "@multica/core/types/room";
import { cn } from "@multica/ui/lib/utils";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@multica/ui/components/ui/hover-card";
import {
  buildInvocationTargetMap,
  flowStepTone,
  flowTrackTone,
  formatFlowTrackLine,
  groupFlowTracks,
  type FlowTrack,
} from "./room-flow-utils";

type Props = {
  wsId: string;
  roomId: string;
  managerAgentId?: string;
  agentNameById: Map<string, string>;
  invocations?: MentionInvocation[];
  className?: string;
};

export function RoomFlowTimeline({
  wsId,
  roomId,
  managerAgentId,
  agentNameById,
  invocations = [],
  className,
}: Props) {
  const { data: events = [] } = useQuery(roomFlowEventsOptions(wsId, roomId));
  const invocationTargetById = useMemo(
    () => buildInvocationTargetMap(invocations),
    [invocations],
  );

  const tracks = useMemo(
    () =>
      groupFlowTracks(events, {
        agentNameById,
        managerAgentId,
        invocationTargetById,
      }),
    [events, agentNameById, managerAgentId, invocationTargetById],
  );

  if (tracks.length === 0) {
    return (
      <p className={cn("text-muted-foreground px-3 py-2 text-xs", className)}>
        暂无流程动态。发送消息后会自动显示群管路由、Agent 执行、确认与阶段压缩。
      </p>
    );
  }

  return (
    <ul className={cn("max-h-40 space-y-1 overflow-y-auto px-3 py-2", className)}>
      {tracks.map((track, idx) => (
        <FlowTrackRow
          key={track.key}
          track={track}
          emphasize={idx === tracks.length - 1}
        />
      ))}
    </ul>
  );
}

function FlowTrackRow({
  track,
  emphasize,
}: {
  track: FlowTrack;
  emphasize: boolean;
}) {
  const tone = flowTrackTone(track);
  const hasHistory = track.steps.length > 1;

  const row = (
    <div
      className={cn(
        "flex items-baseline justify-between gap-2 text-xs",
        tone,
        emphasize && "font-medium",
        hasHistory && "cursor-default",
      )}
    >
      <span className="min-w-0 truncate">{formatFlowTrackLine(track)}</span>
      <time className="text-muted-foreground shrink-0 text-[10px]">
        {track.updatedAt.slice(11, 16)}
      </time>
    </div>
  );

  if (!hasHistory) {
    return <li>{row}</li>;
  }

  return (
    <li>
      <HoverCard openDelay={120} closeDelay={80}>
        <HoverCardTrigger render={<div className="w-full">{row}</div>} />
        <HoverCardContent side="left" align="start" className="w-56 p-0">
          <FlowTrackHistoryPanel track={track} />
        </HoverCardContent>
      </HoverCard>
    </li>
  );
}

function FlowTrackHistoryPanel({ track }: { track: FlowTrack }) {
  return (
    <div className="overflow-hidden">
      <p className="text-muted-foreground border-border border-b px-3 py-2 text-[10px] font-medium uppercase tracking-wide">
        流程动态
      </p>
      <ul className="max-h-40 space-y-1 overflow-y-auto px-3 py-2">
        {track.steps.map((step) => (
          <li
            key={`${step.createdAt}:${step.event.id}`}
            className={cn(
              "flex items-baseline justify-between gap-2 text-xs",
              flowStepTone(step),
            )}
          >
            <span className="min-w-0 truncate">
              {step.actorName} · {step.token}
            </span>
            <time className="text-muted-foreground shrink-0 text-[10px]">
              {step.createdAt.slice(11, 16)}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}
