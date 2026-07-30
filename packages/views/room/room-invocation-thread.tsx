"use client";

import { ManagerHistoryFold } from "./manager-invocation-skin";
import type { InvocationChatItem } from "./room-flow-utils";

export function ManagerHistoryBelowBar({
  items,
  leadingInvocationId,
  agentNameById,
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
  align = "start",
}: {
  items: InvocationChatItem[];
  leadingInvocationId?: string;
  agentNameById: Map<string, string>;
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
  align?: "start" | "end";
}) {
  const managerItems = items.filter((item) => item.presentation === "manager_status");
  const older = leadingInvocationId
    ? managerItems.filter((item) => item.invocation.id !== leadingInvocationId)
    : managerItems.slice(1);
  if (older.length === 0) return null;

  return (
    <div className={cnActionAlign(align)}>
      <ManagerHistoryFold
        items={older}
        agentNameById={agentNameById}
        onRetryAssignment={onRetryAssignment}
        onCancelAssignment={onCancelAssignment}
        retryingAssignmentId={retryingAssignmentId}
        cancellingAssignmentId={cancellingAssignmentId}
      />
    </div>
  );
}

function cnActionAlign(align: "start" | "end") {
  return align === "end" ? "flex justify-end" : "flex justify-start";
}
