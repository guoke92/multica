"use client";

import { useMemo } from "react";
import type {
  RoomAssignment,
  RoomAssignmentDependency,
  RoomInvocation,
  RoomInvocationEvent,
} from "@multica/core/types/room";
import { cn } from "@multica/ui/lib/utils";
import { computeGraphStatusCounts } from "./room-flow-utils";
import { RoomFlowTimeline } from "./room-flow-timeline";

type Props = {
  assignments: RoomAssignment[];
  assignmentDependencies: RoomAssignmentDependency[];
  invocations: RoomInvocation[];
  invocationEvents: RoomInvocationEvent[];
  managerAgentId?: string;
  agentNameById: Map<string, string>;
  memberNameById?: Map<string, string>;
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
};

export function RoomWorkboardPanel({
  assignments,
  assignmentDependencies,
  invocations,
  invocationEvents,
  managerAgentId,
  agentNameById,
  memberNameById,
}: Props) {
  const counts = useMemo(
    () => computeGraphStatusCounts(assignments, invocations),
    [assignments, invocations],
  );

  const statItems = [
    { key: "pending", label: "待处理", value: counts.pending },
    { key: "blocked", label: "等待", value: counts.blocked },
    { key: "queued", label: "排队", value: counts.queued },
    { key: "running", label: "运行", value: counts.running },
    { key: "failed", label: "失败", value: counts.failed },
    { key: "completed", label: "完成", value: counts.completed },
  ].filter((item) => item.value > 0);

  return (
    <div className="border-border shrink-0 border-t px-3 py-3">
      {statItems.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {statItems.map((item) => (
            <StatusChip key={item.key} label={item.label} value={item.value} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground mb-2 text-xs">当前无活跃任务</p>
      )}
      <h3 className="text-muted-foreground mb-1.5 text-xs font-medium uppercase tracking-wide">
        流程动态
      </h3>
      <RoomFlowTimeline
        events={invocationEvents}
        assignments={assignments}
        assignmentDependencies={assignmentDependencies}
        invocations={invocations}
        managerAgentId={managerAgentId}
        agentNameById={agentNameById}
        memberNameById={memberNameById}
      />
    </div>
  );
}

function StatusChip({ label, value }: { label: string; value: number }) {
  return (
    <span
      className={cn(
        "bg-muted/60 text-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] tabular-nums",
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
