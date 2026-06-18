"use client";

import { useMemo } from "react";
import type {
  RoomAssignment,
  RoomAssignmentDependency,
  RoomInvocation,
  RoomInvocationEvent,
  RoomMessage,
} from "@multica/core/types/room";
import { cn } from "@multica/ui/lib/utils";
import { computeGraphStatusCounts } from "./room-flow-utils";
import { RoomFlowTimeline } from "./room-flow-timeline";

type Props = {
  assignments: RoomAssignment[];
  assignmentDependencies: RoomAssignmentDependency[];
  invocations: RoomInvocation[];
  invocationEvents: RoomInvocationEvent[];
  messages: RoomMessage[];
  managerAgentId?: string;
  agentNameById: Map<string, string>;
  memberNameById?: Map<string, string>;
  failuresOnly?: boolean;
  onFailuresOnlyChange?: (value: boolean) => void;
  onNavigateToMessage?: (messageId: string, assignmentId: string) => void;
  onAckFailure?: (assignmentId: string) => void;
  acknowledgingAssignmentId?: string | null;
};

export function RoomWorkboardPanel({
  assignments,
  assignmentDependencies,
  invocations,
  invocationEvents,
  messages,
  managerAgentId,
  agentNameById,
  memberNameById,
  failuresOnly = false,
  onFailuresOnlyChange,
  onNavigateToMessage,
  onAckFailure,
  acknowledgingAssignmentId,
}: Props) {
  const counts = useMemo(
    () => computeGraphStatusCounts(assignments, invocations),
    [assignments, invocations],
  );

  const statItems = [
    { key: "pending", label: "待处理", value: counts.pending, clickable: false },
    { key: "blocked", label: "等待", value: counts.blocked, clickable: false },
    { key: "queued", label: "排队", value: counts.queued, clickable: false },
    { key: "running", label: "运行", value: counts.running, clickable: false },
    {
      key: "failed",
      label: "失败",
      value: counts.failed,
      clickable: counts.failed > 0 && Boolean(onFailuresOnlyChange),
    },
    { key: "completed", label: "完成", value: counts.completed, clickable: false },
  ].filter((item) => item.value > 0);

  return (
    <div className="flex h-full min-h-0 flex-col px-3 py-3">
      {statItems.length > 0 ? (
        <div className="mb-2 flex shrink-0 flex-wrap gap-1.5">
          {statItems.map((item) => (
            <StatusChip
              key={item.key}
              label={item.label}
              value={item.value}
              active={item.key === "failed" && failuresOnly}
              clickable={item.clickable}
              onClick={
                item.key === "failed" && onFailuresOnlyChange
                  ? () => onFailuresOnlyChange(!failuresOnly)
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground mb-2 shrink-0 text-xs">当前无活跃任务</p>
      )}
      {failuresOnly ? (
        <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
          <p className="text-destructive text-xs font-medium">待确认失败</p>
          {onFailuresOnlyChange ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-[10px]"
              onClick={() => onFailuresOnlyChange(false)}
            >
              显示全部
            </button>
          ) : null}
        </div>
      ) : (
        <h3 className="text-muted-foreground mb-1.5 shrink-0 text-xs font-medium uppercase tracking-wide">
          流程动态
        </h3>
      )}
      <RoomFlowTimeline
        className="min-h-0 flex-1"
        events={invocationEvents}
        assignments={assignments}
        assignmentDependencies={assignmentDependencies}
        invocations={invocations}
        messages={messages}
        managerAgentId={managerAgentId}
        agentNameById={agentNameById}
        memberNameById={memberNameById}
        failuresOnly={failuresOnly}
        onNavigateToMessage={onNavigateToMessage}
        onAckFailure={onAckFailure}
        acknowledgingAssignmentId={acknowledgingAssignmentId}
      />
    </div>
  );
}

function StatusChip({
  label,
  value,
  active,
  clickable,
  onClick,
}: {
  label: string;
  value: number;
  active?: boolean;
  clickable?: boolean;
  onClick?: () => void;
}) {
  const className = cn(
    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] tabular-nums transition-colors",
    active
      ? "bg-destructive/15 text-destructive ring-destructive/30 ring-1"
      : "bg-muted/60 text-foreground",
    clickable && !active && "hover:bg-muted cursor-pointer",
    clickable && active && "cursor-pointer",
  );

  if (clickable && onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        <span className={active ? "text-destructive/80" : "text-muted-foreground"}>
          {label}
        </span>
        <span className="font-medium">{value}</span>
      </button>
    );
  }

  return (
    <span className={className}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
