import type { MentionInvocation, RoomMessage, RoomAssignment, RoomMessageMention } from "@multica/core/types/room";

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

/** v2.3 attribution pill text for an agent invocation reply slot. */
export function resolveInvocationAttribution(
  inv: MentionInvocation,
  rootUserMessage: RoomMessage,
  invocations: MentionInvocation[],
  messagesById: Map<string, RoomMessage>,
  agentNameById: Map<string, string>,
  managerAgentId?: string,
): string | undefined {
  const responseMsg = inv.response_message_id
    ? messagesById.get(inv.response_message_id)
    : undefined;
  const quoted = responseMsg?.quote_message_id
    ? messagesById.get(responseMsg.quote_message_id)
    : undefined;

  if (quoted?.sender_type === "agent" && quoted.sender_id) {
    const name = agentNameById.get(quoted.sender_id) ?? "Agent";
    return `由 @${name} 指定`;
  }

  if (rootUserMessage.sender_type !== "user") {
    return undefined;
  }

  const managerRouted =
    !!managerAgentId &&
    invocations.some(
      (i) =>
        i.message_id === rootUserMessage.id &&
        i.target_id === managerAgentId &&
        (i.intent === "route" ||
          i.intent === "orchestrate" ||
          i.intent === "review"),
    );

  if (managerRouted && inv.intent === "execute") {
    return "由群管理分配指定";
  }

  if (inv.message_id === rootUserMessage.id && inv.intent === "execute") {
    return "用户 @指定";
  }

  return undefined;
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

  switch (assignment.kind) {
    case "manager_route":
    case "manager_relay":
    case "reassign":
      return "由群管分配指定";
    case "mention": {
      const mention = mentions.find(
        (mn) =>
          mn.assignment_id === assignment.id &&
          mn.target_id === message.sender_id,
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

export type RoomViewMode = "timeline" | "thread";

export type ThreadBlock = {
  root: RoomMessage;
  children: ThreadBlock[];
  depth: number;
};

/** Build a quote-reply forest; orphans (missing parent) become roots. */
export function buildThreadForest(messages: RoomMessage[]): ThreadBlock[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const childrenOf = new Map<string, RoomMessage[]>();
  const roots: RoomMessage[] = [];

  const wouldCreateCycle = (msgId: string, quoteId: string): boolean => {
    let cur: string | undefined = quoteId;
    const seen = new Set<string>();
    while (cur) {
      if (cur === msgId) return true;
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = byId.get(cur)?.quote_message_id;
    }
    return false;
  };

  for (const m of messages) {
    const quoteId = m.quote_message_id;
    if (!quoteId || !byId.has(quoteId) || wouldCreateCycle(m.id, quoteId)) {
      roots.push(m);
      continue;
    }
    const list = childrenOf.get(quoteId) ?? [];
    list.push(m);
    childrenOf.set(quoteId, list);
  }

  const sortByTime = (a: RoomMessage, b: RoomMessage) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  roots.sort(sortByTime);

  const buildNode = (
    msg: RoomMessage,
    depth: number,
    visiting: Set<string>,
  ): ThreadBlock => {
    if (visiting.has(msg.id)) {
      return { root: msg, children: [], depth };
    }
    visiting.add(msg.id);
    const kids = (childrenOf.get(msg.id) ?? []).sort(sortByTime);
    return {
      root: msg,
      depth,
      children: kids.map((k) => buildNode(k, depth + 1, new Set(visiting))),
    };
  };

  return roots.map((r) => buildNode(r, 0, new Set()));
}

export function getRoomViewMode(roomId: string): RoomViewMode {
  if (typeof window === "undefined") return "timeline";
  const stored = window.localStorage.getItem(`room:viewMode:${roomId}`);
  return stored === "thread" ? "thread" : "timeline";
}

export function setRoomViewMode(roomId: string, mode: RoomViewMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`room:viewMode:${roomId}`, mode);
}
