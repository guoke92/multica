import type { RoomMessage } from "@multica/core/types/room";

/** Workflow/system noise that should not appear in the chat timeline. */
export function shouldHideRoomMessage(
  message: RoomMessage,
  managerAgentId?: string,
): boolean {
  if (
    managerAgentId &&
    message.sender_type === "agent" &&
    message.sender_id === managerAgentId
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
