"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { roomsListOptions } from "@multica/core/room/queries";
import { useWorkspaceId } from "@multica/core/hooks";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { MessageSquare, Plus } from "lucide-react";
import { RoomView } from "./room-view";
import { CreateRoomDialog } from "./create-room-dialog";
import { useNavigation } from "../navigation";
import type { Room, RoomSnapshot } from "@multica/core/types/room";

type Props = {
  roomId?: string;
};

function roomActivityLabel(snapshot: RoomSnapshot): string | null {
  const active =
    (snapshot.running_count ?? 0) +
    (snapshot.pending_count ?? 0) +
    (snapshot.queued_count ?? 0);
  if (active > 0) return `${active} 个任务进行中`;
  if (snapshot.failed_count) return `${snapshot.failed_count} 个失败`;
  if (snapshot.timed_out_count) return `${snapshot.timed_out_count} 个超时`;
  return null;
}

export function RoomsPage({ roomId }: Props) {
  const wsId = useWorkspaceId();
  const nav = useNavigation();
  const { data: rooms = [] } = useQuery(roomsListOptions(wsId));
  const [createOpen, setCreateOpen] = useState(false);

  const activeId = roomId ?? rooms[0]?.id;

  const openRoom = (id: string) => {
    const slug = nav.pathname.split("/")[1];
    if (slug) nav.push(`/${slug}/rooms/${id}`);
  };

  const roomsByActivity = useMemo(() => {
    return [...rooms].sort((a, b) => {
      const aActive = activityScore(a.snapshot);
      const bActive = activityScore(b.snapshot);
      if (aActive !== bActive) return bActive - aActive;
      return b.name.localeCompare(a.name);
    });
  }, [rooms]);

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="border-border flex w-72 shrink-0 flex-col border-r">
        <div className="border-border flex items-center justify-between border-b px-3 py-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="text-muted-foreground size-4" />
            <p className="text-sm font-semibold">协作群</p>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="新建协作群"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <ul className="flex-1 overflow-y-auto p-1.5">
          {roomsByActivity.map((room) => {
            const hint = roomActivityLabel(
              room.snapshot && typeof room.snapshot === "object"
                ? room.snapshot
                : {},
            );
            return (
              <li key={room.id}>
                <button
                  type="button"
                  onClick={() => openRoom(room.id)}
                  className={cn(
                    "hover:bg-muted/80 w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                    activeId === room.id && "bg-muted",
                  )}
                >
                  <p className="truncate text-sm font-medium">{room.name}</p>
                  {hint ? (
                    <p className="text-muted-foreground mt-0.5 truncate text-xs">
                      {hint}
                    </p>
                  ) : room.description ? (
                    <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                      {room.description}
                    </p>
                  ) : null}
                </button>
              </li>
            );
          })}
          {rooms.length === 0 ? (
            <li className="text-muted-foreground px-3 py-8 text-center text-xs">
              <p>暂无协作群</p>
              <Button
                size="sm"
                variant="link"
                className="mt-2 h-auto p-0"
                onClick={() => setCreateOpen(true)}
              >
                创建第一个群
              </Button>
            </li>
          ) : null}
        </ul>
      </aside>
      <main className="min-w-0 flex-1">
        {activeId ? (
          <RoomView
            roomId={activeId}
            onArchived={() => {
              const slug = nav.pathname.split("/")[1];
              if (slug) nav.push(`/${slug}/rooms`);
            }}
          />
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
            <MessageSquare className="size-10 opacity-30" />
            <p>选择或创建一个协作群</p>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              新建协作群
            </Button>
          </div>
        )}
      </main>
      <CreateRoomDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={openRoom}
      />
    </div>
  );
}

function activityScore(snapshot: Room["snapshot"]): number {
  if (!snapshot || typeof snapshot !== "object") return 0;
  return (
    (snapshot.running_count ?? 0) * 3 +
    (snapshot.queued_count ?? 0) * 2 +
    (snapshot.pending_count ?? 0) +
    (snapshot.failed_count ?? 0) +
    (snapshot.timed_out_count ?? 0) * 2
  );
}
