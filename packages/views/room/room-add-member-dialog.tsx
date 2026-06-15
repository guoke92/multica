"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentListOptions, memberListOptions } from "@multica/core/workspace/queries";
import { useAddRoomMember } from "@multica/core/room/mutations";
import type { RoomMember } from "@multica/core/types/room";
import type { Agent } from "@multica/core/types";
import type { MemberWithUser } from "@multica/core/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { Label } from "@multica/ui/components/ui/label";
import { ScrollArea } from "@multica/ui/components/ui/scroll-area";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  wsId: string;
  existingMembers: RoomMember[];
  isOwner: boolean;
};

export function RoomAddMemberDialog({
  open,
  onOpenChange,
  roomId,
  wsId,
  existingMembers,
  isOwner,
}: Props) {
  const addMember = useAddRoomMember(wsId, roomId);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const existingKeys = useMemo(
    () => new Set(existingMembers.map((m) => `${m.principal_type}:${m.principal_id}`)),
    [existingMembers],
  );

  const availableAgents = useMemo(
    () =>
      agents.filter(
        (a: Agent) =>
          !a.archived_at &&
          a.runtime_id &&
          !existingKeys.has(`agent:${a.id}`),
      ),
    [agents, existingKeys],
  );

  const availableUsers = useMemo(
    () =>
      members.filter(
        (m: MemberWithUser) => !existingKeys.has(`user:${m.user_id}`),
      ),
    [members, existingKeys],
  );

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleUser = (id: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const reset = () => {
    setSelectedAgentIds([]);
    setSelectedUserIds([]);
  };

  const handleSubmit = async () => {
    const tasks: Array<{ principal_type: string; principal_id: string; role?: string }> = [
      ...selectedAgentIds.map((id) => ({ principal_type: "agent", principal_id: id })),
      ...selectedUserIds.map((id) => ({ principal_type: "user", principal_id: id })),
    ];
    if (tasks.length === 0) return;

    try {
      for (const t of tasks) {
        await addMember.mutateAsync(t);
      }
      toast.success(`已添加 ${tasks.length} 名成员`);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加成员失败");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>添加群成员</DialogTitle>
          <DialogDescription>
            选择要加入的工作区成员或 Agent。
            {isOwner ? " 可将成员设为管理员（在成员列表中操作）。" : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <div className="space-y-2">
            <Label>Agent</Label>
            <ScrollArea className="border-border h-32 rounded-md border">
              <ul className="p-2">
                {availableAgents.map((a) => (
                  <li key={a.id}>
                    <label className="hover:bg-muted/60 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5">
                      <Checkbox
                        checked={selectedAgentIds.includes(a.id)}
                        onCheckedChange={() => toggleAgent(a.id)}
                      />
                      <ActorAvatar actorType="agent" actorId={a.id} size={20} showStatusDot />
                      <span className="text-sm">{a.name}</span>
                    </label>
                  </li>
                ))}
                {availableAgents.length === 0 ? (
                  <li className="text-muted-foreground px-2 py-3 text-xs">暂无可添加的 Agent</li>
                ) : null}
              </ul>
            </ScrollArea>
          </div>
          <div className="space-y-2">
            <Label>工作区成员</Label>
            <ScrollArea className="border-border h-32 rounded-md border">
              <ul className="p-2">
                {availableUsers.map((m) => (
                  <li key={m.user_id}>
                    <label
                      className={cn(
                        "hover:bg-muted/60 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                      )}
                    >
                      <Checkbox
                        checked={selectedUserIds.includes(m.user_id)}
                        onCheckedChange={() => toggleUser(m.user_id)}
                      />
                      <ActorAvatar actorType="member" actorId={m.user_id} size={20} />
                      <span className="text-sm">{m.name || m.email}</span>
                    </label>
                  </li>
                ))}
                {availableUsers.length === 0 ? (
                  <li className="text-muted-foreground px-2 py-3 text-xs">暂无可添加的成员</li>
                ) : null}
              </ul>
            </ScrollArea>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={
              addMember.isPending ||
              (selectedAgentIds.length === 0 && selectedUserIds.length === 0)
            }
          >
            {addMember.isPending ? "添加中…" : "添加"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
