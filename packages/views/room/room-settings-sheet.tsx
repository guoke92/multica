"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@multica/ui/components/ui/sheet";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Textarea } from "@multica/ui/components/ui/textarea";
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
import {
  useArchiveRoom,
  useLeaveRoom,
  useUpdateRoom,
} from "@multica/core/room/mutations";
import { api } from "@multica/core/api";
import { memberListOptions } from "@multica/core/workspace/queries";
import { runtimeListOptions } from "@multica/core/runtimes/queries";
import { useAuthStore } from "@multica/core/auth";
import {
  defaultManagerAgentName,
  ROOM_MANAGER_DEFAULT_CUSTOM_PROMPT,
} from "@multica/core/room/manager-prompt";
import { RoomManagerPromptTabs } from "./room-manager-prompt-tabs";
import { ModelDropdown } from "../agents/components/model-dropdown";
import { RuntimePicker } from "../agents/components/runtime-picker";
import type { Room } from "@multica/core/types/room";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room: Room;
  wsId: string;
  canManage: boolean;
  isOwner: boolean;
  onArchived?: () => void;
  onLeft?: () => void;
};

export function RoomSettingsSheet({
  open,
  onOpenChange,
  room,
  wsId,
  canManage,
  isOwner,
  onArchived,
  onLeft,
}: Props) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description);
  const [managerRuntimeId, setManagerRuntimeId] = useState("");
  const [managerModel, setManagerModel] = useState("");
  const [managerPrompt, setManagerPrompt] = useState(ROOM_MANAGER_DEFAULT_CUSTOM_PROMPT);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [saving, setSaving] = useState(false);

  const updateRoom = useUpdateRoom(wsId, room.id);
  const archiveRoom = useArchiveRoom(wsId);
  const leaveRoom = useLeaveRoom(wsId);

  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery(
    runtimeListOptions(wsId),
  );
  const { data: managerAgent } = useQuery({
    queryKey: ["agent", room.manager_agent_id],
    queryFn: () => api.getAgent(room.manager_agent_id!),
    enabled: open && !!room.manager_agent_id,
  });

  const selectedRuntime = runtimes.find((r) => r.id === managerRuntimeId) ?? null;

  useEffect(() => {
    if (!open) return;
    setName(room.name);
    setDescription(room.description);
    setManagerPrompt(
      room.policy?.manager_custom_prompt?.trim() || ROOM_MANAGER_DEFAULT_CUSTOM_PROMPT,
    );
  }, [open, room.name, room.description, room.policy?.manager_custom_prompt]);

  useEffect(() => {
    if (!managerAgent) return;
    setManagerRuntimeId(managerAgent.runtime_id ?? "");
    setManagerModel(managerAgent.model ?? "");
  }, [managerAgent]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("群名称不能为空");
      return;
    }
    setSaving(true);
    try {
      const payload: Parameters<typeof api.updateRoom>[1] = {
        name: trimmed,
        description,
      };
      if (room.manager_agent_id) {
        payload.manager_custom_prompt = managerPrompt.trim();
        if (managerRuntimeId) payload.manager_runtime_id = managerRuntimeId;
        payload.manager_model = managerModel;
      }
      await updateRoom.mutateAsync(payload);
      toast.success("群信息已更新");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = () => {
    archiveRoom.mutate(room.id, {
      onSuccess: () => {
        setConfirmArchive(false);
        onOpenChange(false);
        onArchived?.();
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "归档失败");
      },
    });
  };

  const handleLeave = () => {
    leaveRoom.mutate(room.id, {
      onSuccess: () => {
        setConfirmLeave(false);
        onOpenChange(false);
        onLeft?.();
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "退出失败");
      },
    });
  };

  const dirty =
    name.trim() !== room.name ||
    description !== (room.description ?? "") ||
    (room.manager_agent_id &&
      (managerPrompt.trim() !== (room.policy?.manager_custom_prompt?.trim() ?? ROOM_MANAGER_DEFAULT_CUSTOM_PROMPT) ||
        managerRuntimeId !== (managerAgent?.runtime_id ?? "") ||
        managerModel !== (managerAgent?.model ?? "")));

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-5 py-4 text-left">
            <SheetTitle>群设置</SheetTitle>
            <SheetDescription>修改群信息、群管理 Agent，或归档/退出群聊</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {canManage ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="room-settings-name">群名称</Label>
                  <Input
                    id="room-settings-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="room-settings-desc">群描述</Label>
                  <Textarea
                    id="room-settings-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="可选"
                  />
                </div>

                {room.manager_agent_id ? (
                  <div className="border-border space-y-3 rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">群管理 Agent</p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {managerAgent?.name ?? defaultManagerAgentName(name)}
                      </p>
                    </div>
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
                  </div>
                ) : null}

                <Button
                  onClick={() => void handleSave()}
                  disabled={!dirty || saving || updateRoom.isPending || !name.trim()}
                >
                  {saving || updateRoom.isPending ? "保存中…" : "保存修改"}
                </Button>

                <div className="border-t pt-5">
                  <p className="text-sm font-medium">危险操作</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    归档后群聊将从列表移除，进行中的 @ 任务会被取消，且不可恢复。
                  </p>
                  <Button
                    variant="destructive"
                    className="mt-3"
                    onClick={() => setConfirmArchive(true)}
                  >
                    归档此群
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                仅群主或管理员可修改群名称与描述。
              </p>
            )}

            {!isOwner ? (
              <div className={canManage ? "border-t pt-5" : ""}>
                <p className="text-sm font-medium">退出群聊</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  退出后将不再收到此群消息，聊天记录对你不可见。
                </p>
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => setConfirmLeave(true)}
                >
                  退出群聊
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground border-t pt-5 text-xs">
                群主需先将群主转让给其他成员后才能退出群聊。
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {confirmArchive ? (
        <AlertDialog open onOpenChange={(v) => !archiveRoom.isPending && setConfirmArchive(v)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>归档此协作群？</AlertDialogTitle>
              <AlertDialogDescription>
                「{room.name}」将从列表中移除，进行中的 @ 任务会被取消。此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={archiveRoom.isPending}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleArchive}
                disabled={archiveRoom.isPending}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {archiveRoom.isPending ? "归档中…" : "确认归档"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {confirmLeave ? (
        <AlertDialog open onOpenChange={(v) => !leaveRoom.isPending && setConfirmLeave(v)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>退出此协作群？</AlertDialogTitle>
              <AlertDialogDescription>
                退出「{room.name}」后，你将无法继续查看或发送消息。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={leaveRoom.isPending}>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handleLeave} disabled={leaveRoom.isPending}>
                {leaveRoom.isPending ? "退出中…" : "确认退出"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
