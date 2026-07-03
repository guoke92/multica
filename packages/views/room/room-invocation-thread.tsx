"use client";

import type { RoomMessage, RoomInvocation, RoomAssignment } from "@multica/core/types/room";
import { RoleAgentInvocationSkin } from "./role-agent-invocation-skin";
import { ManagerHistoryFold } from "./manager-invocation-skin";
import {
  buildInvocationChatItems,
  compareMonotonicId,
  type InvocationChatItem,
} from "./room-flow-utils";

type InvocationContext = {
  timelineMessages: RoomMessage[];
  invocations?: RoomInvocation[];
  assignments?: RoomAssignment[];
  agentNameById: Map<string, string>;
  managerAgentId?: string;
};

export function invocationItemsForMessage(
  messageId: string,
  ctx: InvocationContext,
): InvocationChatItem[] {
  return buildInvocationChatItems(
    ctx.invocations ?? [],
    ctx.assignments ?? [],
    ctx.timelineMessages,
    ctx.agentNameById,
    ctx.managerAgentId,
    { includeManagerSucceeded: true },
  )
    .filter((item) => item.sourceMessageId === messageId)
    .sort((a, b) => -compareMonotonicId(a.invocation.id, b.invocation.id));
}

export function RoleAgentInvocationSlots({
  items,
  agentNameById,
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
}: {
  items: InvocationChatItem[];
  agentNameById: Map<string, string>;
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
}) {
  const roleItems = items.filter((item) => item.presentation === "agent_bubble");
  if (roleItems.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {roleItems.map((item) => (
        <RoleAgentInvocationSkin
          key={item.invocation.id}
          item={item}
          agentNameById={agentNameById}
          onRetryAssignment={onRetryAssignment}
          onCancelAssignment={onCancelAssignment}
          retryingAssignmentId={retryingAssignmentId}
          cancellingAssignmentId={cancellingAssignmentId}
        />
      ))}
    </div>
  );
}

export function ManagerHistoryBelowBar({
  items,
  agentNameById,
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
  align = "start",
}: {
  items: InvocationChatItem[];
  agentNameById: Map<string, string>;
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
  align?: "start" | "end";
}) {
  const managerItems = items.filter((item) => item.presentation === "manager_status");
  const older = managerItems.slice(1);
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
