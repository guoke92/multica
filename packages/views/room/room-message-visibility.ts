import type { RoomMessage } from "@multica/core/types/room";

/** notify_user posts from the manager agent but must appear as a user-facing chat row. */
export function isManagerNotifyUserMessage(message: RoomMessage): boolean {
  if (message.metadata?.manager_notify_user === true) return true;
  // Server only persists manager-agent rows for notify_user; older rows lack metadata.
  return message.content.includes("mention://member/");
}

/** Workflow/system noise that should not appear in the chat timeline. */
export function shouldHideRoomMessage(
  message: RoomMessage,
  managerAgentId?: string,
): boolean {
  if (
    managerAgentId &&
    message.sender_type === "agent" &&
    message.sender_id === managerAgentId &&
    !isManagerNotifyUserMessage(message)
  ) {
    return true;
  }

  if (message.sender_type !== "system") {
    return false;
  }

  const kind = message.message_kind ?? "";
  if (
    kind === "system_dispatch" ||
    kind === "system_milestone" ||
    kind === "card" ||
    kind === "route_hint" ||
    kind === "relay_hint" ||
    kind === "agent_at" ||
    kind === "escalate_hint"
  ) {
    return true;
  }

  return false;
}

export function isManagerInvocation(
  inv: { target_id: string; intent?: string },
  managerAgentId?: string,
): boolean {
  if (!managerAgentId) return false;
  if (inv.target_id === managerAgentId) return true;
  const intent = inv.intent ?? "";
  return (
    intent === "orchestrate" || intent === "route" ||
    intent === "review" || intent === "confirm" ||
    intent === "escalate"
  );
}
