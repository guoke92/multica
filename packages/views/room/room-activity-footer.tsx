"use client";

import { useMemo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import type { RoomInvocation } from "@multica/core/types/room";

type ActivityInvocation = Pick<
  RoomInvocation,
  | "id"
  | "agent_id"
  | "assignment_id"
  | "status"
  | "created_at"
>;

type Props = {
  invocations: ActivityInvocation[];
  agentNameById: Map<string, string>;
  onRetryAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
};

/** Footer shows *only* failures needing attention that lack inline presentation.
 *  Running/queued state is rendered inline on each user message thread.
 */
export function RoomActivityFooter({
  invocations,
  agentNameById,
  onRetryAssignment,
  retryingAssignmentId,
}: Props) {
  const failed = useMemo(
    () => invocations.find((i) => i.status === "failed" && i.assignment_id),
    [invocations],
  );
  if (!failed) return null;

  return (
    <div className="bg-background shrink-0 px-5 pb-2 pt-1">
      <div className="mx-auto w-full max-w-3xl">
        <FailedRow
          invocationId={failed.id}
          agentLabel={agentNameById.get(failed.agent_id) ?? failed.agent_id}
          assignmentId={failed.assignment_id!}
          onRetryAssignment={onRetryAssignment}
          retryingAssignmentId={retryingAssignmentId}
        />
      </div>
    </div>
  );
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
}): ReactNode {
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
