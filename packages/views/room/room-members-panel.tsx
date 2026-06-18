"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { roomMembersOptions } from "@multica/core/room/queries";
import {
  useRemoveRoomMember,
  useUpdateRoomMemberRole,
} from "@multica/core/room/mutations";
import { memberListOptions, agentListOptions } from "@multica/core/workspace/queries";
import { useWorkspacePresenceMap } from "@multica/core/agents";
import { availabilityConfig } from "../agents/presence";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { MoreHorizontal, Plus, Users } from "lucide-react";
import type { RoomMember, MentionInvocation } from "@multica/core/types/room";
import { toast } from "sonner";
import { RoomAddMemberDialog } from "./room-add-member-dialog";
import { RoomWorkboardPanel } from "./room-workboard-panel";

type Props = {
  roomId: string;
  wsId: string;
  managerAgentId?: string;
  currentUserId?: string;
  canManage: boolean;
  isOwner: boolean;
  invocations?: MentionInvocation[];
  onLeft?: () => void;
};

function roleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "群主";
    case "admin":
      return "管理员";
    case "manager":
      return "群管理";
    case "guest":
      return "访客";
    default:
      return "成员";
  }
}

export function RoomMembersPanel({
  roomId,
  wsId,
  managerAgentId,
  currentUserId,
  canManage,
  isOwner,
  invocations = [],
  onLeft,
}: Props) {
  const { data: members = [] } = useQuery(roomMembersOptions(wsId, roomId));
  const { data: workspaceMembers = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  const removeMember = useRemoveRoomMember(wsId, roomId);
  const updateRole = useUpdateRoomMemberRole(wsId, roomId);
  const { byAgent: presenceMap } = useWorkspacePresenceMap(wsId);

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<RoomMember | null>(null);

  const userNames = new Map(
    workspaceMembers.map((m) => [m.user_id, m.name || m.email]),
  );
  const agentNames = new Map(agents.map((a) => [a.id, a.name]));

  /** Map: principal_id → active invocation status label */
  const statusByAgent = useMemo(() => {
    const map = new Map<string, { label: string; tone: "running" | "queued" | "failed" | "paused" }>();
    for (const inv of invocations) {
      // Skip legacy manager-only intents; new route/relay/escalate intents show status.
      if (inv.intent === "orchestrate" || inv.intent === "review" || inv.intent === "confirm") continue;

      const s = inv.status;
      if (["running", "delivered"].includes(s)) {
        map.set(inv.target_id, { label: "正在处理", tone: "running" });
      } else if (["pending", "queued"].includes(s)) {
        if (!map.has(inv.target_id)) {
          map.set(inv.target_id, { label: "排队中", tone: "queued" });
        }
      } else if (["failed", "timed_out"].includes(s)) {
        if (!map.has(inv.target_id)) {
          map.set(inv.target_id, { label: s === "timed_out" ? "已超时" : "失败", tone: "failed" });
        }
      } else if (s === "paused") {
        if (!map.has(inv.target_id)) {
          map.set(inv.target_id, { label: "已暂停", tone: "paused" });
        }
      }
    }
    return map;
  }, [invocations, managerAgentId]);

  const users = members.filter((m) => m.principal_type === "user");
  const roomAgents = members.filter(
    (m) => m.principal_type === "agent",
  );
  const squads = members.filter((m) => m.principal_type === "squad");

  const resolveName = (m: RoomMember) => {
    if (m.principal_type === "user") {
      return userNames.get(m.principal_id) ?? "用户";
    }
    if (m.principal_type === "agent") {
      return agentNames.get(m.principal_id) ?? "Agent";
    }
    return m.principal_id.slice(0, 8);
  };

  const canActOn = (m: RoomMember) => {
    if (m.principal_type !== "user") {
      return canManage && m.role !== "owner";
    }
    if (m.principal_id === currentUserId) {
      return m.role !== "owner";
    }
    if (!canManage) return false;
    if (m.role === "owner") return false;
    if (m.role === "admin") return isOwner;
    return true;
  };

  const handleRemove = () => {
    if (!removeTarget) return;
    const isSelf =
      removeTarget.principal_type === "user" &&
      removeTarget.principal_id === currentUserId;
    removeMember.mutate(
      {
        principal_type: removeTarget.principal_type,
        principal_id: removeTarget.principal_id,
      },
      {
        onSuccess: () => {
          toast.success(isSelf ? "已退出群聊" : "已移除成员");
          setRemoveTarget(null);
          if (isSelf) onLeft?.();
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "操作失败");
        },
      },
    );
  };

  const handleRoleChange = (
    m: RoomMember,
    action: { role?: string; action?: string },
    label: string,
  ) => {
    updateRole.mutate(
      {
        principal_type: m.principal_type,
        principal_id: m.principal_id,
        ...action,
      },
      {
        onSuccess: () => toast.success(label),
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "操作失败");
        },
      },
    );
  };

  const renderMemberMenu = (m: RoomMember) => {
    const showMenu =
      (canManage && m.principal_type === "user" && m.role !== "owner") ||
      (canManage && m.principal_type !== "user" && m.role !== "owner") ||
      (m.principal_type === "user" &&
        m.principal_id === currentUserId &&
        m.role !== "owner");

    if (!showMenu) return null;

    const isSelfUser =
      m.principal_type === "user" && m.principal_id === currentUserId;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" className="size-7 shrink-0">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {isOwner && m.principal_type === "user" && m.role !== "owner" ? (
            <>
              {m.role !== "admin" ? (
                <DropdownMenuItem
                  onClick={() =>
                    handleRoleChange(m, { role: "admin" }, "已设为管理员")
                  }
                >
                  设为管理员
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() =>
                    handleRoleChange(m, { role: "member" }, "已取消管理员")
                  }
                >
                  取消管理员
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() =>
                  handleRoleChange(
                    m,
                    { action: "transfer_owner" },
                    "已转让群主",
                  )
                }
              >
                转让群主
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {canActOn(m) ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setRemoveTarget(m)}
            >
              {isSelfUser ? "退出群聊" : "移出群聊"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <>
      <aside className="border-border flex w-56 shrink-0 flex-col border-l bg-muted/20">
        <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
          <Users className="text-muted-foreground size-4" />
          <span className="text-sm font-medium">群成员</span>
          <span className="text-muted-foreground ml-auto text-xs">{members.length}</span>
          {canManage ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setAddOpen(true)}
              title="添加成员"
            >
              <Plus className="size-4" />
            </Button>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto p-2 text-sm">
          {users.length > 0 ? (
            <MemberSection title="成员">
              {users.map((m) => (
                <MemberRow
                  key={`user-${m.principal_id}`}
                  name={resolveName(m)}
                  sub={roleLabel(m.role)}
                  isSelf={m.principal_id === currentUserId}
                  action={renderMemberMenu(m)}
                />
              ))}
            </MemberSection>
          ) : null}
          {roomAgents.length > 0 ? (
            <MemberSection title="Agent">
              {roomAgents.map((m) => {
                const isManager =
                  managerAgentId && m.principal_id === managerAgentId;
                const status = statusByAgent.get(m.principal_id);
                const presence = presenceMap.get(m.principal_id);
                const availability = presence?.availability;
                return (
                  <MemberRow
                    key={`agent-${m.principal_id}`}
                    name={resolveName(m)}
                    sub={
                      status
                        ? undefined
                        : isManager
                          ? "群管理"
                          : "智能体"
                    }
                    status={status}
                    availability={availability}
                    accent
                    action={
                      canManage && !isManager ? renderMemberMenu(m) : null
                    }
                  />
                );
              })}
            </MemberSection>
          ) : null}
          {squads.length > 0 ? (
            <MemberSection title="小队">
              {squads.map((m) => (
                <MemberRow
                  key={`squad-${m.principal_id}`}
                  name={resolveName(m)}
                  sub="小队"
                  action={canManage ? renderMemberMenu(m) : null}
                />
              ))}
            </MemberSection>
          ) : null}
          {members.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-xs">暂无成员</p>
          ) : null}
        </div>
        <RoomWorkboardPanel
          wsId={wsId}
          roomId={roomId}
          managerAgentId={managerAgentId}
          agentNameById={agentNames}
          memberNameById={userNames}
          invocations={invocations}
        />
      </aside>

      <RoomAddMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        roomId={roomId}
        wsId={wsId}
        existingMembers={members}
        isOwner={isOwner}
      />

      {removeTarget ? (
        <AlertDialog
          open
          onOpenChange={(v) => !removeMember.isPending && !v && setRemoveTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {removeTarget.principal_type === "user" &&
                removeTarget.principal_id === currentUserId
                  ? "退出此协作群？"
                  : "移出群成员？"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {removeTarget.principal_type === "user" &&
                removeTarget.principal_id === currentUserId
                  ? "退出后将无法继续查看或发送消息。"
                  : `确定将「${resolveName(removeTarget)}」移出群聊？`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removeMember.isPending}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRemove}
                disabled={removeMember.isPending}
                className={
                  removeTarget.principal_type === "user" &&
                  removeTarget.principal_id !== currentUserId
                    ? "bg-destructive text-white hover:bg-destructive/90"
                    : undefined
                }
              >
                {removeMember.isPending ? "处理中…" : "确认"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

function MemberSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <p className="text-muted-foreground mb-1 px-2 text-xs font-medium">{title}</p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function MemberRow({
  name,
  sub,
  status,
  availability,
  accent,
  isSelf,
  action,
}: {
  name: string;
  sub?: string;
  status?: { label: string; tone: "running" | "queued" | "failed" | "paused" };
  availability?: "online" | "unstable" | "offline";
  accent?: boolean;
  isSelf?: boolean;
  action?: React.ReactNode;
}) {
  const toneClass =
    status?.tone === "running"
      ? "text-green-600 dark:text-green-400"
      : status?.tone === "queued"
        ? "text-amber-600 dark:text-amber-400"
        : status?.tone === "failed"
          ? "text-destructive"
          : "text-muted-foreground";

  const avDot = availability ? availabilityConfig[availability]?.dotClass : null;

  return (
    <li className="hover:bg-muted/60 group flex items-center gap-2 rounded-md px-2 py-1.5">
      <div
        className={cn(
          "relative flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-medium",
          accent ? "bg-primary/15 text-primary" : "bg-muted",
        )}
      >
        {name.slice(0, 1).toUpperCase()}
        {status?.tone === "running" ? (
          <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-green-500 ring-1 ring-background animate-pulse" />
        ) : avDot ? (
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-1 ring-background",
              avDot,
            )}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {name}
          {isSelf ? "（你）" : ""}
        </p>
        {status ? (
          <p className={cn("truncate text-xs font-medium", toneClass)}>
            {status.tone === "running" ? (
              <span className="inline-flex items-center gap-1">
                <span className="animate-chat-text-shimmer">{status.label}</span>
              </span>
            ) : (
              status.label
            )}
          </p>
        ) : sub ? (
          <p className="text-muted-foreground truncate text-xs">{sub}</p>
        ) : null}
      </div>
      {action ? (
        <div className="opacity-0 transition-opacity group-hover:opacity-100">{action}</div>
      ) : null}
    </li>
  );
}
