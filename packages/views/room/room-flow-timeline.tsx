"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  RoomAssignment,
  RoomAssignmentDependency,
  RoomInvocation,
  RoomInvocationEvent,
  RoomMessage,
} from "@multica/core/types/room";
import { cn } from "@multica/ui/lib/utils";
import { useAutoScroll } from "@multica/ui/hooks/use-auto-scroll";
import { Button } from "@multica/ui/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@multica/ui/components/ui/hover-card";
import {
  flowStepTone,
  flowTrackSurface,
  flowTrackTone,
  formatFlowStepLine,
  formatFlowTrackLine,
  groupFlowTracks,
  isActiveFlowTrack,
  isFlowTrackAttentionFailure,
  resolveFlowScrollMessageId,
  type FlowGraphContext,
  type FlowTrack,
} from "./room-flow-utils";

type Props = {
  events: RoomInvocationEvent[];
  assignments: RoomAssignment[];
  assignmentDependencies: RoomAssignmentDependency[];
  invocations: RoomInvocation[];
  messages: RoomMessage[];
  managerAgentId?: string;
  agentNameById: Map<string, string>;
  memberNameById?: Map<string, string>;
  failuresOnly?: boolean;
  onNavigateToMessage?: (messageId: string, assignmentId: string) => void;
  onAckFailure?: (assignmentId: string) => void;
  acknowledgingAssignmentId?: string | null;
  className?: string;
};

export function RoomFlowTimeline({
  events,
  assignments,
  assignmentDependencies,
  invocations,
  messages,
  managerAgentId,
  agentNameById,
  memberNameById,
  failuresOnly = false,
  onNavigateToMessage,
  onAckFailure,
  acknowledgingAssignmentId,
  className,
}: Props) {
  const graph = useMemo<FlowGraphContext>(
    () => ({
      assignments,
      assignment_dependencies: assignmentDependencies,
      invocations,
    }),
    [assignments, assignmentDependencies, invocations],
  );

  const displayOpts = useMemo(
    () => ({
      managerAgentId,
      memberNameById,
      agentNameById,
      graph,
    }),
    [managerAgentId, memberNameById, agentNameById, graph],
  );

  const tracks = useMemo(() => {
    const all = groupFlowTracks(events, {
      agentNameById,
      managerAgentId,
      memberNameById,
      graph,
    });
    if (!failuresOnly) return all;
    return all.filter((track) => isFlowTrackAttentionFailure(track, graph));
  }, [events, agentNameById, managerAgentId, memberNameById, graph, failuresOnly]);

  const scrollRef = useRef<HTMLUListElement>(null);
  const { scrollToBottom } = useAutoScroll(scrollRef);

  const flowTailKey = useMemo(() => {
    const last = tracks[tracks.length - 1];
    if (!last) return "";
    const lastStep = last.steps[last.steps.length - 1];
    return `${failuresOnly ? "fail:" : "all:"}${last.key}:${last.updatedAt}:${lastStep?.event.id ?? ""}:${tracks.length}`;
  }, [tracks, failuresOnly]);

  useEffect(() => {
    if (failuresOnly) return;
    scrollToBottom();
    const frame = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frame);
  }, [flowTailKey, failuresOnly, scrollToBottom]);

  if (tracks.length === 0) {
    return (
      <p className={cn("text-muted-foreground px-1 py-2 text-xs", className)}>
        {failuresOnly
          ? "暂无待确认失败。"
          : "暂无流程动态。发送消息后会显示分派与执行进度。"}
      </p>
    );
  }

  return (
    <ul ref={scrollRef} className={cn("min-h-0 space-y-0.5 overflow-y-auto", className)}>
      {tracks.map((track) => (
        <FlowTrackRow
          key={track.key}
          track={track}
          displayOpts={displayOpts}
          graph={graph}
          messages={messages}
          failuresOnly={failuresOnly}
          onNavigateToMessage={onNavigateToMessage}
          onAckFailure={onAckFailure}
          acknowledgingAssignmentId={acknowledgingAssignmentId}
        />
      ))}
    </ul>
  );
}

function FlowTrackRow({
  track,
  displayOpts,
  graph,
  messages,
  failuresOnly,
  onNavigateToMessage,
  onAckFailure,
  acknowledgingAssignmentId,
}: {
  track: FlowTrack;
  displayOpts: {
    managerAgentId?: string;
    memberNameById?: Map<string, string>;
    agentNameById: Map<string, string>;
    graph: FlowGraphContext;
  };
  graph: FlowGraphContext;
  messages: RoomMessage[];
  failuresOnly?: boolean;
  onNavigateToMessage?: (messageId: string, assignmentId: string) => void;
  onAckFailure?: (assignmentId: string) => void;
  acknowledgingAssignmentId?: string | null;
}) {
  const tone = flowTrackTone(track, graph);
  const surface = flowTrackSurface(track, graph);
  const isActive = isActiveFlowTrack(track, graph);
  const hasHistory = track.steps.length > 1;
  const line = formatFlowTrackLine(track, displayOpts);
  const needsAck = isFlowTrackAttentionFailure(track, graph);
  const isAcking = acknowledgingAssignmentId === track.assignmentId;

  const handleNavigate = () => {
    if (!onNavigateToMessage) return;
    const messageId = resolveFlowScrollMessageId(track, messages, graph);
    if (messageId) {
      onNavigateToMessage(messageId, track.assignmentId);
    }
  };

  const row = (
    <div
      role={onNavigateToMessage ? "button" : undefined}
      tabIndex={onNavigateToMessage ? 0 : undefined}
      onClick={onNavigateToMessage ? handleNavigate : undefined}
      onKeyDown={
        onNavigateToMessage
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleNavigate();
              }
            }
          : undefined
      }
      className={cn(
        "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors",
        tone,
        surface,
        isActive && "font-medium",
        onNavigateToMessage && "hover:bg-muted/40 cursor-pointer",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{line}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        {failuresOnly && needsAck && onAckFailure ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-5 px-1.5 text-[10px]"
            disabled={isAcking}
            onClick={(e) => {
              e.stopPropagation();
              onAckFailure(track.assignmentId);
            }}
          >
            {isAcking ? "…" : "确认"}
          </Button>
        ) : null}
        <time className="text-muted-foreground text-[10px] tabular-nums">
          {track.updatedAt.slice(11, 16)}
        </time>
      </div>
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
          <FlowTrackHistoryPanel
            track={track}
            displayOpts={displayOpts}
            onNavigateToMessage={onNavigateToMessage}
            messages={messages}
            graph={graph}
          />
        </HoverCardContent>
      </HoverCard>
    </li>
  );
}

function FlowTrackHistoryPanel({
  track,
  displayOpts,
  onNavigateToMessage,
  messages,
  graph,
}: {
  track: FlowTrack;
  displayOpts: {
    managerAgentId?: string;
    memberNameById?: Map<string, string>;
    agentNameById: Map<string, string>;
    graph: FlowGraphContext;
  };
  onNavigateToMessage?: (messageId: string, assignmentId: string) => void;
  messages: RoomMessage[];
  graph: FlowGraphContext;
}) {
  const handleNavigate = () => {
    if (!onNavigateToMessage) return;
    const messageId = resolveFlowScrollMessageId(track, messages, graph);
    if (messageId) {
      onNavigateToMessage(messageId, track.assignmentId);
    }
  };

  return (
    <div className="overflow-hidden">
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <p className="text-muted-foreground text-[10px] font-medium tracking-wide">
          状态变化
        </p>
        {onNavigateToMessage ? (
          <button
            type="button"
            className="text-primary text-[10px] hover:underline"
            onClick={handleNavigate}
          >
            定位消息
          </button>
        ) : null}
      </div>
      <ul className="max-h-44 space-y-0.5 overflow-y-auto px-2 py-2">
        {track.steps.map((step) => (
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
