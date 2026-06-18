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
  flowTrackSurface,
  flowTrackTone,
  formatFlowStepLine,
  formatFlowTrackLine,
  groupFlowTracks,
  isActiveFlowTrack,
  type FlowTrack,
} from "./room-flow-utils";

type Props = {
  wsId: string;
  roomId: string;
  managerAgentId?: string;
  agentNameById: Map<string, string>;
  memberNameById?: Map<string, string>;
  invocations?: MentionInvocation[];
  className?: string;
};

export function RoomFlowTimeline({
  wsId,
  roomId,
  managerAgentId,
  agentNameById,
  memberNameById,
  invocations = [],
  className,
}: Props) {
  const { data: events = [] } = useQuery(roomFlowEventsOptions(wsId, roomId));
  const invocationTargetById = useMemo(
    () => buildInvocationTargetMap(invocations),
    [invocations],
  );
  const invocationById = useMemo(
    () => new Map(invocations.map((inv) => [inv.id, inv])),
    [invocations],
  );

  const displayOpts = useMemo(
    () => ({
      managerAgentId,
      memberNameById,
      agentNameById,
      invocationTargetById,
    }),
    [managerAgentId, memberNameById, agentNameById, invocationTargetById],
  );

  const formatOpts = useMemo(
    () => ({
      ...displayOpts,
      invocationById,
    }),
    [displayOpts, invocationById],
  );

  const tracks = useMemo(
    () =>
      groupFlowTracks(events, {
        agentNameById,
        managerAgentId,
        memberNameById,
        invocationTargetById,
      }),
    [events, agentNameById, managerAgentId, memberNameById, invocationTargetById],
  );

  if (tracks.length === 0) {
    return (
      <p className={cn("text-muted-foreground px-3 py-2 text-xs", className)}>
        暂无流程动态。发送消息后会自动显示群管路由、Agent 执行、确认与阶段压缩。
      </p>
    );
  }

  return (
    <ul className={cn("max-h-48 space-y-0.5 overflow-y-auto px-2 py-2", className)}>
      {tracks.map((track) => (
        <FlowTrackRow
          key={track.key}
          track={track}
          displayOpts={displayOpts}
          formatOpts={formatOpts}
          invocationById={invocationById}
        />
      ))}
    </ul>
  );
}

function FlowTrackRow({
  track,
  displayOpts,
  formatOpts,
  invocationById,
}: {
  track: FlowTrack;
  displayOpts: {
    managerAgentId?: string;
    memberNameById?: Map<string, string>;
    agentNameById: Map<string, string>;
    invocationTargetById: Map<string, string>;
  };
  formatOpts: Parameters<typeof formatFlowTrackLine>[1];
  invocationById: Map<string, MentionInvocation>;
}) {
  const tone = flowTrackTone(track);
  const surface = flowTrackSurface(track);
  const isActive = isActiveFlowTrack(track, invocationById);
  const hasHistory = track.steps.length > 1;
  const line = formatFlowTrackLine(track, formatOpts);

  const row = (
    <div
      className={cn(
        "flex items-baseline justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors",
        tone,
        surface,
        isActive && "font-medium",
        hasHistory && "cursor-default",
      )}
    >
      <span className="min-w-0 truncate">{line}</span>
      <time className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
        {track.updatedAt.slice(11, 16)}
      </time>
    </div>
  );

  if (!hasHistory) {
    return <li>{row}</li>;
  }

  return (
    <li>
      <HoverCard>
        <HoverCardTrigger render={<div className="w-full">{row}</div>} />
        <HoverCardContent side="left" align="start" className="w-60 p-0">
          <FlowTrackHistoryPanel track={track} displayOpts={displayOpts} />
        </HoverCardContent>
      </HoverCard>
    </li>
  );
}

function FlowTrackHistoryPanel({
  track,
  displayOpts,
}: {
  track: FlowTrack;
  displayOpts: {
    managerAgentId?: string;
    memberNameById?: Map<string, string>;
    agentNameById: Map<string, string>;
    invocationTargetById: Map<string, string>;
  };
}) {
  const steps = track.steps;

  return (
    <div className="overflow-hidden">
      <p className="text-muted-foreground border-border border-b px-3 py-2 text-[10px] font-medium tracking-wide">
        状态变化
      </p>
      <ul className="max-h-44 space-y-0.5 overflow-y-auto px-2 py-2">
        {steps.map((step) => (
          <li
            key={step.event.id}
            className={cn(
              "flex items-baseline justify-between gap-2 rounded px-1.5 py-0.5 text-xs",
              flowStepTone(step),
            )}
          >
            <span className="min-w-0 truncate">
              {formatFlowStepLine(track, step, displayOpts)}
            </span>
            <time className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
              {step.createdAt.slice(11, 16)}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}
