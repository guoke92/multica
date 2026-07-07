"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  RoomAssignment,
  RoomAssignmentDependency,
  RoomInvocation,
  RoomInvocationEvent,
  RoomManagerDecision,
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
  isFlowTrackLiveForTimer,
  resolveFlowScrollMessageId,
  resolveFlowTrackAssembledPrompt,
  resolveFlowTrackElapsedSeconds,
  resolveFlowTrackTimerAnchor,
  resolveManagerDecisionForTrack,
  type FlowGraphContext,
  type FlowTrack,
} from "./room-flow-utils";
import {
  formatElapsedSeconds,
  formatFlowClockTime,
  useElapsedSeconds,
} from "./room-elapsed-timer";

type Props = {
  events: RoomInvocationEvent[];
  assignments: RoomAssignment[];
  assignmentDependencies: RoomAssignmentDependency[];
  invocations: RoomInvocation[];
  decisions?: RoomManagerDecision[];
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
  decisions = [],
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
      decisions,
    }),
    [assignments, assignmentDependencies, invocations, decisions],
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
  const managerDetail = resolveManagerDecisionForTrack(track, graph);
  const assembledPrompt = resolveFlowTrackAssembledPrompt(track);
  const needsAck = isFlowTrackAttentionFailure(track, graph);
  const isAcking = acknowledgingAssignmentId === track.assignmentId;
  const startedAtLabel = formatFlowClockTime(track.startedAt);

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
        "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
        tone,
        surface,
        isActive && "font-medium",
        onNavigateToMessage && "hover:bg-muted/40 cursor-pointer",
      )}
    >
      {startedAtLabel ? (
        <time
          dateTime={track.startedAt}
          className="text-muted-foreground shrink-0 text-[10px] tabular-nums"
        >
          {startedAtLabel}
        </time>
      ) : null}
      <span
        className="min-w-0 flex-1 truncate"
        title={managerDetail?.reason}
      >
        {line}
        <FlowTrackDuration track={track} graph={graph} inline />
      </span>
      {failuresOnly && needsAck && onAckFailure ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="h-5 shrink-0 px-1.5 text-[10px]"
          disabled={isAcking}
          onClick={(e) => {
            e.stopPropagation();
            onAckFailure(track.assignmentId);
          }}
        >
          {isAcking ? "…" : "确认"}
        </Button>
      ) : null}
    </div>
  );

  if (!hasHistory && !managerDetail?.reason && !assembledPrompt) {
    return <li>{row}</li>;
  }

  return (
    <li>
      <HoverCard>
        <HoverCardTrigger render={<div className="w-full">{row}</div>} />
        <HoverCardContent side="left" align="start" className="w-80 p-0">
          <FlowTrackHistoryPanel
            track={track}
            displayOpts={displayOpts}
            managerDetail={managerDetail}
            assembledPrompt={assembledPrompt}
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
  managerDetail,
  assembledPrompt,
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
  managerDetail?: ReturnType<typeof resolveManagerDecisionForTrack>;
  assembledPrompt?: string;
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
      {managerDetail?.reason ? (
        <div className="border-border bg-muted/30 border-b px-3 py-2">
          <p className="text-muted-foreground text-[10px] font-medium">
            群管决策原因
          </p>
          <p className="text-foreground mt-1 text-xs leading-relaxed whitespace-pre-wrap break-words">
            {managerDetail.reason}
          </p>
        </div>
      ) : null}
      {assembledPrompt ? (
        <div className="border-border bg-muted/20 border-b px-3 py-2">
          <p className="text-muted-foreground text-[10px] font-medium">
            完整 Prompt（入队时快照）
          </p>
          <pre className="text-foreground mt-1 max-h-48 overflow-y-auto text-[10px] leading-relaxed whitespace-pre-wrap break-words">
            {assembledPrompt}
          </pre>
        </div>
      ) : null}
      <ul className="max-h-44 space-y-0.5 overflow-y-auto px-2 py-2">
        {track.steps.map((step) => {
          const stepTime = formatFlowClockTime(step.createdAt);
          return (
          <li
            key={step.event.id}
            className={cn(
              "flex items-baseline gap-1.5 rounded px-1.5 py-0.5 text-xs",
              flowStepTone(step),
            )}
          >
            {stepTime ? (
              <time
                dateTime={step.createdAt}
                className="text-muted-foreground shrink-0 text-[10px] tabular-nums"
              >
                {stepTime}
              </time>
            ) : null}
            <span className="min-w-0 truncate">
              {formatFlowStepLine(track, step, displayOpts)}
              <FlowStepDuration
                track={track}
                stepCreatedAt={step.createdAt}
                graph={graph}
                inline
              />
            </span>
          </li>
          );
        })}
      </ul>
    </div>
  );
}

function FlowTrackDuration({
  track,
  graph,
  inline = false,
}: {
  track: FlowTrack;
  graph: FlowGraphContext;
  inline?: boolean;
}) {
  const anchor = resolveFlowTrackTimerAnchor(track, graph);
  const live = isFlowTrackLiveForTimer(track, graph);
  const elapsedLive = useElapsedSeconds(anchor?.key ?? track.key, anchor?.createdAt);
  const elapsedStatic = live ? null : resolveFlowTrackElapsedSeconds(track, graph);
  const elapsed = live ? elapsedLive : elapsedStatic;

  if (elapsed === null) return null;
  return (
    <span
      className={cn(
        "tabular-nums",
        inline ? "text-muted-foreground/80 ml-1" : "text-muted-foreground text-[10px]",
      )}
    >
      {formatElapsedSeconds(elapsed)}
    </span>
  );
}

function FlowStepDuration({
  track,
  stepCreatedAt,
  graph,
  inline = false,
}: {
  track: FlowTrack;
  stepCreatedAt: string;
  graph: FlowGraphContext;
  inline?: boolean;
}) {
  const anchor = resolveFlowTrackTimerAnchor(track, graph);
  if (!anchor) return null;

  const start = Date.parse(anchor.createdAt);
  const end = Date.parse(stepCreatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return (
    <span
      className={cn(
        "tabular-nums",
        inline ? "text-muted-foreground/80 ml-1" : "text-muted-foreground text-[10px]",
      )}
    >
      {formatElapsedSeconds(seconds)}
    </span>
  );
}
