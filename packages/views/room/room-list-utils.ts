import type { Room, RoomSnapshot } from "@multica/core/types/room";

export type RoomListMemberPreview = {
  id: string;
  name: string;
  isAgent: boolean;
};

export type RoomListSubtitle = {
  text: string;
  tone: "default" | "danger" | "active" | "mention";
  badgeCount: number | null;
};

function roomIsProcessing(snapshot: RoomSnapshot): boolean {
  const assignmentActive =
    (snapshot.running_count ?? 0) +
    (snapshot.pending_count ?? 0) +
    (snapshot.blocked_count ?? 0);
  const invocationActive =
    (snapshot.queued_count ?? 0) + (snapshot.active_invocation_count ?? 0);
  return assignmentActive > 0 || invocationActive > 0;
}

/** WeCom-style subtitle + numeric badge for the room list row. */
export function buildRoomListSubtitle(
  snapshot: RoomSnapshot,
  description?: string,
): RoomListSubtitle {
  const unread = snapshot.unread_message_count ?? 0;
  const mentionUnread = snapshot.mention_unread_count ?? 0;

  if (mentionUnread > 0) {
    return {
      text: mentionUnread === 1 ? "[有人@你] 待跟进" : `[有人@你] ${mentionUnread} 条待跟进`,
      tone: "mention",
      badgeCount: mentionUnread,
    };
  }

  if ((snapshot.failed_count ?? 0) > 0) {
    const count = snapshot.failed_count ?? 0;
    return {
      text: count === 1 ? "1 个失败待确认" : `${count} 个失败待确认`,
      tone: "danger",
      badgeCount: count,
    };
  }

  if ((snapshot.manager_active_count ?? 0) > 0) {
    return {
      text: "群管处理中",
      tone: "active",
      badgeCount: null,
    };
  }

  if (roomIsProcessing(snapshot)) {
    const active =
      (snapshot.running_count ?? 0) +
      (snapshot.active_invocation_count ?? 0) +
      (snapshot.queued_count ?? 0);
    return {
      text: active > 0 ? `${active} 个任务处理中` : "处理中",
      tone: "active",
      badgeCount: null,
    };
  }

  if (unread > 0) {
    return {
      text: snapshot.last_message_preview?.trim() || "有新消息",
      tone: "default",
      badgeCount: unread,
    };
  }

  const preview = snapshot.last_message_preview?.trim();
  if (preview) {
    return { text: preview, tone: "default", badgeCount: null };
  }

  if (description?.trim()) {
    return { text: description.trim(), tone: "default", badgeCount: null };
  }

  return { text: "暂无消息", tone: "default", badgeCount: null };
}

export function formatRoomListTime(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffHours < 48 && date.getDate() === now.getDate() - 1) {
    return "昨天";
  }
  if (now.getFullYear() === date.getFullYear()) {
    return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
  }
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

export function resolveRoomMemberPreviews(
  members: Array<{ principal_type: string; principal_id: string }>,
  userNames: Map<string, string>,
  agentNames: Map<string, string>,
  managerAgentId?: string,
  limit = 4,
): RoomListMemberPreview[] {
  const previews: RoomListMemberPreview[] = [];

  const push = (id: string, name: string, isAgent: boolean) => {
    if (!name.trim()) return;
    if (previews.some((p) => p.id === id)) return;
    previews.push({ id, name, isAgent });
  };

  for (const member of members) {
    if (member.principal_type === "user") {
      push(
        member.principal_id,
        userNames.get(member.principal_id) ?? "成员",
        false,
      );
    } else if (member.principal_type === "agent") {
      if (managerAgentId && member.principal_id === managerAgentId) continue;
      push(
        member.principal_id,
        agentNames.get(member.principal_id) ?? "Agent",
        true,
      );
    }
    if (previews.length >= limit) break;
  }

  if (previews.length < limit && managerAgentId) {
    push(
      managerAgentId,
      agentNames.get(managerAgentId) ?? "群管",
      true,
    );
  }

  return previews.slice(0, limit);
}

export function activityScore(snapshot: Room["snapshot"]): number {
  if (!snapshot || typeof snapshot !== "object") return 0;
  const processing =
    (snapshot.manager_active_count ?? 0) * 4 +
    (snapshot.running_count ?? 0) * 3 +
    (snapshot.active_invocation_count ?? 0) * 3 +
    (snapshot.queued_count ?? 0) * 2 +
    (snapshot.pending_count ?? 0) +
    (snapshot.blocked_count ?? 0) * 2 +
    (snapshot.mention_unread_count ?? 0) * 5 +
    (snapshot.unread_message_count ?? 0) * 2;
  return (
    processing +
    (snapshot.failed_count ?? 0) * 3 +
    (snapshot.timed_out_count ?? 0) * 2
  );
}
