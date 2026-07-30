import type { RoomMessage, RoomAssignment, RoomMessageMention } from "@multica/core/types/room";

export type QuoteReplyTarget = {
  messageId: string;
  senderType: string;
  senderId?: string;
  senderName: string;
  preview: string;
};

export function truncatePreview(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

/** Auto-@ the quoted message sender (skipped for self and system). */
export function buildQuoteMentionPrefix(
  message: Pick<RoomMessage, "sender_type" | "sender_id">,
  displayName: string,
  currentUserId: string | undefined,
): string {
  if (message.sender_type === "system" || !message.sender_id) return "";
  if (message.sender_type === "user" && message.sender_id === currentUserId) {
    return "";
  }
  const type = message.sender_type === "agent" ? "agent" : "member";
  const label = displayName.startsWith("@") ? displayName : `@${displayName}`;
  return `[${label}](mention://${type}/${message.sender_id}) `;
}

/** Hide structured workflow_action JSON footers from manager agent replies. */
export function stripWorkflowActionFooter(content: string): string {
  let text = content.trim();
  const fence = /```(?:json)?\s*\n[\s\S]*?```\s*$/i;
  if (fence.test(text)) {
    text = text.replace(fence, "").trim();
  }
  const tail = text.lastIndexOf("{");
  if (tail >= 0 && text.slice(tail).includes("workflow_action")) {
    text = text.slice(0, tail).trim();
  }
  return text;
}

function readDetailedExplanation(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const detailed = (metadata as { detailed_explanation?: unknown }).detailed_explanation;
  return typeof detailed === "string" ? detailed.trim() : "";
}

/** Short text for the room chat bubble — prefer server summary over full transcript. */
export function resolveRoomAgentChatSummary(
  message: RoomMessage,
  transcriptText?: string,
): string {
  const summary = stripWorkflowActionFooter(message.content.trim());
  if (summary) return summary;
  const fromTranscript = stripWorkflowActionFooter((transcriptText ?? "").trim());
  if (fromTranscript) return fromTranscript;
  const detailed = stripWorkflowActionFooter(readDetailedExplanation(message.metadata));
  if (detailed) return truncatePreview(detailed, 400);
  return "";
}

export function roomAgentHasExpandableProcess(
  message: RoomMessage,
  options?: { transcriptText?: string; processStepCount?: number },
): boolean {
  const summary = resolveRoomAgentChatSummary(message, options?.transcriptText);
  if ((options?.processStepCount ?? 0) > 0) return true;
  const detailed = readDetailedExplanation(message.metadata);
  const transcript = (options?.transcriptText ?? "").trim();
  const full = detailed || transcript;
  return full.length > summary.length + 80;
}

export function extractRoomAgentCopyText(message: RoomMessage): string {
  const meta =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)
      : {};
  if (typeof meta.detailed_explanation === "string" && meta.detailed_explanation) {
    return meta.detailed_explanation;
  }
  return message.content;
}

/** Attribution label for a role-agent turn from its assignment + mention graph. */
export function resolveAssignmentAttribution(
  assignment: Pick<RoomAssignment, "id" | "kind">,
  mentions: RoomMessageMention[],
  agentId: string,
): string | undefined {
  switch (assignment.kind) {
    case "manager_route":
    case "manager_relay":
    case "reassign":
      return "由群管分配指定";
    case "mention": {
      const mention = mentions.find(
        (mn) =>
          mn.assignment_id === assignment.id &&
          mn.target_id === agentId,
      );
      if (mention?.source_type === "agent_mention") {
        return "由角色 Agent 指定";
      }
      return "用户 @ 指定";
    }
    default:
      return undefined;
  }
}

/** Attribution for an agent reply message using the authoritative assignment + mention data. */
export function resolveAgentMessageAttribution(
  message: RoomMessage,
  assignments: Array<Pick<RoomAssignment, "id" | "output_message_id" | "source_message_id" | "kind">>,
  mentions: RoomMessageMention[],
): string | undefined {
  if (message.sender_type !== "agent") return undefined;
  if (message.metadata?.manager_notify_user === true) return undefined;

  const assignment = assignments.find((a) => a.output_message_id === message.id);
  if (!assignment) return undefined;

  return resolveAssignmentAttribution(assignment, mentions, message.sender_id ?? "");
}
