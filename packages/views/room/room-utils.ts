import type { RoomMessage } from "@multica/core/types/room";

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
