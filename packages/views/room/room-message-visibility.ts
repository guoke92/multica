import type { RoomMessage } from "@multica/core/types/room";

/** notify_user posts from the manager agent but must appear as a user-facing chat row. */
export function isManagerNotifyUserMessage(message: RoomMessage): boolean {
  if (message.metadata?.manager_notify_user === true) return true;
  // Server only persists manager-agent rows for notify_user; older rows lack metadata.
  return message.content.includes("mention://member/");
}

/** Manager route/relay/escalate dispatch — rendered as a manager slot below the source message. */
export function isManagerDispatchMessage(message: RoomMessage): boolean {
  return message.metadata?.manager_dispatch === true;
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
    !isManagerNotifyUserMessage(message) &&
    !isManagerDispatchMessage(message)
  ) {
    return true;
  }

  if (message.sender_type !== "system") {
    if (message.message_kind === "card") return true;
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

  const content = message.content.trim();
  if (
    content.startsWith("派单：") ||
    content.startsWith("阶段推进：") ||
    content.startsWith("已开启交付：") ||
    content.startsWith("交付已完成") ||
    content.startsWith("已创建 Issue ")
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
