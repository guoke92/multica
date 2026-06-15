"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentListOptions, memberListOptions } from "@multica/core/workspace/queries";
import { runtimeListOptions } from "@multica/core/runtimes/queries";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCreateRoom } from "@multica/core/room/mutations";
import { useAuthStore } from "@multica/core/auth";
import {
  defaultManagerAgentName,
  ROOM_MANAGER_DEFAULT_CUSTOM_PROMPT,
} from "@multica/core/room/manager-prompt";
import { RoomManagerPromptTabs } from "./room-manager-prompt-tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { ScrollArea } from "@multica/ui/components/ui/scroll-area";
import { ModelDropdown } from "../agents/components/model-dropdown";
import { RuntimePicker, isRuntimeUsableForUser } from "../agents/components/runtime-picker";
import type { Agent } from "@multica/core/types";
import type { MemberWithUser } from "@multica/core/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (roomId: string) => void;
};

export function CreateRoomDialog({ open, onOpenChange, onCreated }: Props) {
  const wsId = useWorkspaceId();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const createRoom = useCreateRoom(wsId);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery(
    runtimeListOptions(wsId),
  );

  const [name, setName] = useState("");
  const [enableManager, setEnableManager] = useState(true);
  const [managerMode, setManagerMode] = useState<"new" | "existing">("new");
  const [managerRuntimeId, setManagerRuntimeId] = useState("");
  const [managerModel, setManagerModel] = useState("");
  const [managerPrompt, setManagerPrompt] = useState(ROOM_MANAGER_DEFAULT_CUSTOM_PROMPT);
  const [existingManagerId, setExistingManagerId] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const managerDisplayName = defaultManagerAgentName(name);

  useEffect(() => {
    if (open && currentUserId) {
      setSelectedUserIds((prev) =>
        prev.includes(currentUserId) ? prev : [currentUserId, ...prev],
      );
    }
  }, [open, currentUserId]);

  useEffect(() => {
    if (!managerRuntimeId && runtimes.length > 0 && currentUserId) {
      const usable = runtimes.find((r) => isRuntimeUsableForUser(r, currentUserId));
      if (usable) setManagerRuntimeId(usable.id);
    }
  }, [runtimes, managerRuntimeId, currentUserId]);

  const activeAgents = useMemo(
    () => agents.filter((a: Agent) => !a.archived_at && a.runtime_id),
    [agents],
  );

  const selectedRuntime = runtimes.find((r) => r.id === managerRuntimeId) ?? null;

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleUser = (id: string) => {
    if (id === currentUserId) return;
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const memberIds = currentUserId
      ? [...new Set([currentUserId, ...selectedUserIds])]
      : selectedUserIds;
    const agentIds = [...new Set(selectedAgentIds)];

    const payload: Parameters<typeof createRoom.mutate>[0] = {
      name: trimmed,
      agent_member_ids: agentIds,
      member_user_ids: memberIds.filter((id) => id !== currentUserId),
    };

    if (enableManager) {
      if (managerMode === "new") {
        if (!managerRuntimeId) return;
        payload.manager_agent = {
          name: defaultManagerAgentName(trimmed),
          runtime_id: managerRuntimeId,
          model: managerModel || undefined,
          instructions: managerPrompt.trim() || undefined,
        };
      } else if (existingManagerId) {
        payload.manager_agent_id = existingManagerId;
      }
    }

    createRoom.mutate(payload, {
      onSuccess: (room) => {
        setName("");
        setEnableManager(true);
        setManagerMode("new");
        setManagerPrompt(ROOM_MANAGER_DEFAULT_CUSTOM_PROMPT);
        setExistingManagerId("");
        setSelectedAgentIds([]);
        setSelectedUserIds(currentUserId ? [currentUserId] : []);
        onOpenChange(false);
        onCreated(room.id);
      },
    });
  };

  const canSubmit =
    name.trim() &&
    (!enableManager ||
      (managerMode === "existing" && existingManagerId) ||
      (managerMode === "new" && managerRuntimeId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>新建协作群</DialogTitle>
          <DialogDescription>
            配置群管理 Agent 与工作成员。群管理负责路由任务与监督进度，会显示在成员列表中。
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(90vh-8rem)]">
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="room-name">群名称</Label>
              <Input
                id="room-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：需求开发"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={enableManager}
                onCheckedChange={(v) => setEnableManager(v === true)}
              />
              <Label>启用群管理（推荐）</Label>
            </div>

            {enableManager ? (
              <div className="border-border space-y-3 rounded-lg border p-3">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={managerMode === "new" ? "default" : "outline"}
                    onClick={() => setManagerMode("new")}
                  >
                    新建群管理
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={managerMode === "existing" ? "default" : "outline"}
                    onClick={() => setManagerMode("existing")}
                  >
                    已有 Agent
                  </Button>
                </div>

                {managerMode === "new" ? (
                  <>
                    {name.trim() ? (
                      <p className="text-muted-foreground text-xs">
                        群管理名称：<span className="text-foreground">{managerDisplayName}</span>
                      </p>
                    ) : null}
                    <RuntimePicker
                      runtimes={runtimes}
                      runtimesLoading={runtimesLoading}
                      members={members}
                      currentUserId={currentUserId ?? null}
                      selectedRuntimeId={managerRuntimeId}
                      onSelect={setManagerRuntimeId}
                    />
                    <div className="space-y-2">
                      <Label>模型</Label>
                      <ModelDropdown
                        runtimeId={managerRuntimeId || null}
                        runtimeOnline={selectedRuntime?.status === "online"}
                        value={managerModel}
                        onChange={setManagerModel}
                        disabled={!managerRuntimeId}
                      />
                    </div>
                    <RoomManagerPromptTabs
                      value={managerPrompt}
                      onChange={setManagerPrompt}
                    />
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label>选择 Agent</Label>
                    <select
                      className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                      value={existingManagerId}
                      onChange={(e) => setExistingManagerId(e.target.value)}
                    >
                      <option value="">请选择</option>
                      {activeAgents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Agent 成员（可被 @ 指派）</Label>
              <div className="border-border h-32 overflow-y-auto rounded-md border p-2">
                <ul>
                  {activeAgents.map((a) => (
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
                  {activeAgents.length === 0 ? (
                    <li className="text-muted-foreground px-2 py-3 text-xs">
                      暂无可用 Agent
                    </li>
                  ) : null}
                </ul>
              </div>
            </div>

            <div className="space-y-2">
              <Label>工作区成员</Label>
              <div className="border-border h-32 overflow-y-auto rounded-md border p-2">
                <ul>
                  {members.map((m: MemberWithUser) => {
                    const isSelf = m.user_id === currentUserId;
                    return (
                      <li key={m.user_id}>
                        <label
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5",
                            isSelf ? "cursor-default opacity-90" : "hover:bg-muted/60 cursor-pointer",
                          )}
                        >
                          <Checkbox
                            checked={isSelf || selectedUserIds.includes(m.user_id)}
                            disabled={isSelf}
                            onCheckedChange={() => toggleUser(m.user_id)}
                          />
                          <ActorAvatar actorType="member" actorId={m.user_id} size={20} />
                          <span className="text-sm">
                            {m.name || m.email}
                            {isSelf ? "（你）" : ""}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        </ScrollArea>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || createRoom.isPending}>
            创建
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
