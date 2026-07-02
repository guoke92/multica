"use client";

import { useMemo, useState, useEffect, type ReactNode } from "react";
import { RefreshCw, Square } from "lucide-react";
import { isTaskMessageTaskId } from "@multica/core/chat/queries";
import { UnicodeSpinner } from "@multica/ui/components/common/unicode-spinner";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import type { RoomInvocation } from "@multica/core/types/room";

export const ROOM_ACTIVITY_SOFT_WARN_SECONDS = 90;

type ActivityInvocation = Pick<
  RoomInvocation,
  | "id"
  | "agent_id"
  | "assignment_id"
  | "status"
  | "task_id"
  | "created_at"
  | "started_at"
>;

type Props = {
  invocations: ActivityInvocation[];
  agentNameById: Map<string, string>;
  onRetryAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  onCancelAssignment?: (assignmentId: string) => void;
  cancellingAssignmentId?: string | null;
};

/** Single status row pinned to the bottom of the chat column. */
export function RoomActivityFooter({
  invocations,
  agentNameById,
  onRetryAssignment,
  retryingAssignmentId,
  onCancelAssignment,
  cancellingAssignmentId,
}: Props) {
  const active = useMemo(() => pickActiveInvocation(invocations), [invocations]);
  if (!active) return null;

  const agentLabel = agentNameById.get(active.agent_id) ?? active.agent_id;

  let row: ReactNode = null;
  if (active.status === "failed" && active.assignment_id) {
    row = (
      <FailedRow
        invocationId={active.id}
        agentLabel={agentLabel}
        assignmentId={active.assignment_id}
        onRetryAssignment={onRetryAssignment}
        retryingAssignmentId={retryingAssignmentId}
      />
    );
  } else if (
    active.status === "running" &&
    active.task_id &&
    isTaskMessageTaskId(active.task_id)
  ) {
    row = (
      <RunningRow
        invocationId={active.id}
        createdAt={active.created_at ?? active.started_at}
        agentLabel={agentLabel}
        assignmentId={active.assignment_id}
        onCancelAssignment={onCancelAssignment}
        cancellingAssignmentId={cancellingAssignmentId}
        phaseLabel="思考中"
      />
    );
  } else if (active.status === "queued" || active.status === "pending") {
    row = (
      <QueuedRow
        invocationId={active.id}
        createdAt={active.created_at}
        agentLabel={agentLabel}
        assignmentId={active.assignment_id}
        onCancelAssignment={onCancelAssignment}
        cancellingAssignmentId={cancellingAssignmentId}
      />
    );
  } else if (active.status === "running") {
    row = (
      <RunningRow
        invocationId={active.id}
        createdAt={active.created_at ?? active.started_at}
        agentLabel={agentLabel}
        assignmentId={active.assignment_id}
        onCancelAssignment={onCancelAssignment}
        cancellingAssignmentId={cancellingAssignmentId}
        phaseLabel="思考中"
      />
    );
  }

  if (!row) return null;

  return (
    <div className="bg-background shrink-0 px-5 pb-2 pt-1">
      <div className="mx-auto w-full max-w-3xl">{row}</div>
    </div>
  );
}

function pickActiveInvocation(invocations: ActivityInvocation[]): ActivityInvocation | null {
  const failed = invocations.find((i) => i.status === "failed");
  if (failed) return failed;
  const running = invocations.find((i) => i.status === "running");
  if (running) return running;
  return (
    invocations.find((i) => i.status === "queued" || i.status === "pending") ?? null
  );
}

function useElapsed(createdAt?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const anchor = createdAt ? Date.parse(createdAt) : Date.now();
  return Math.max(0, Math.floor((now - anchor) / 1000));
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function FailedRow({
  invocationId,
  agentLabel,
  assignmentId,
  onRetryAssignment,
  retryingAssignmentId,
}: {
  invocationId: string;
  agentLabel: string;
  assignmentId: string;
  onRetryAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
}) {
  const isRetrying = retryingAssignmentId === assignmentId;
  return (
    <div
      className="text-destructive flex items-center gap-2 text-xs"
      data-invocation-id={invocationId}
      aria-live="polite"
    >
      <span>{agentLabel} 失败</span>
      {onRetryAssignment ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="text-destructive hover:text-destructive h-6 px-1.5 text-[11px]"
          disabled={isRetrying}
          onClick={() => onRetryAssignment(assignmentId)}
        >
          <RefreshCw className={cn("mr-1 size-3", isRetrying && "animate-spin")} />
          {isRetrying ? "重试中…" : "重试"}
        </Button>
      ) : null}
    </div>
  );
}

function RunningRow({
  invocationId,
  createdAt,
  agentLabel,
  assignmentId,
  onCancelAssignment,
  cancellingAssignmentId,
  phaseLabel,
}: {
  invocationId: string;
  createdAt?: string;
  agentLabel: string;
  assignmentId?: string;
  onCancelAssignment?: (assignmentId: string) => void;
  cancellingAssignmentId?: string | null;
  phaseLabel: string;
}) {
  const elapsed = useElapsed(createdAt);
  const isSoftWarn = elapsed >= ROOM_ACTIVITY_SOFT_WARN_SECONDS;
  const isCancelling = !!assignmentId && cancellingAssignmentId === assignmentId;
  const label = isSoftWarn ? `${phaseLabel}·可能稍慢` : phaseLabel;

  return (
    <StatusRow
      invocationId={invocationId}
      isSoftWarn={isSoftWarn}
      agentLabel={agentLabel}
      label={label}
      elapsed={elapsed}
      assignmentId={assignmentId}
      onCancelAssignment={onCancelAssignment}
      isCancelling={isCancelling}
    />
  );
}

function QueuedRow({
  invocationId,
  createdAt,
  agentLabel,
  assignmentId,
  onCancelAssignment,
  cancellingAssignmentId,
}: {
  invocationId: string;
  createdAt?: string;
  agentLabel: string;
  assignmentId?: string;
  onCancelAssignment?: (assignmentId: string) => void;
  cancellingAssignmentId?: string | null;
}) {
  const elapsed = useElapsed(createdAt);
  const isSoftWarn = elapsed >= ROOM_ACTIVITY_SOFT_WARN_SECONDS;
  const isCancelling = !!assignmentId && cancellingAssignmentId === assignmentId;
  const label = isSoftWarn ? "排队中·可能稍慢" : "排队中";

  return (
    <StatusRow
      invocationId={invocationId}
      isSoftWarn={isSoftWarn}
      agentLabel={agentLabel}
      label={label}
      elapsed={elapsed}
      assignmentId={assignmentId}
      onCancelAssignment={onCancelAssignment}
      isCancelling={isCancelling}
    />
  );
}

function StatusRow({
  invocationId,
  isSoftWarn,
  agentLabel,
  label,
  elapsed,
  assignmentId,
  onCancelAssignment,
  isCancelling,
}: {
  invocationId: string;
  isSoftWarn: boolean;
  agentLabel: string;
  label: string;
  elapsed: number;
  assignmentId?: string;
  onCancelAssignment?: (assignmentId: string) => void;
  isCancelling?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs",
        isSoftWarn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
      )}
      data-invocation-id={invocationId}
      data-soft-warn={isSoftWarn ? "true" : undefined}
      aria-live="polite"
    >
      <UnicodeSpinner name="breathe" className="size-3 opacity-70" />
      <span className={cn(!isSoftWarn && "animate-chat-text-shimmer")}>
        {agentLabel} {label}
      </span>
      <span className="opacity-70 tabular-nums">· {formatElapsed(elapsed)}</span>
      {assignmentId && onCancelAssignment ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground h-6 px-1.5 text-[11px]"
          disabled={isCancelling}
          onClick={() => onCancelAssignment(assignmentId)}
        >
          <Square className="mr-1 size-3" />
          {isCancelling ? "停止中…" : "停止"}
        </Button>
      ) : null}
    </div>
  );
}
