"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { roomsListOptions, roomKeys } from "@multica/core/room/queries";
import { useWorkspaceId } from "@multica/core/hooks";
import { api } from "@multica/core/api";
import { memberListOptions, agentListOptions } from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@multica/ui/components/ui/resizable";
import { MessageSquare, Plus } from "lucide-react";
import { RoomView } from "./room-view";
import { CreateRoomDialog } from "./create-room-dialog";
import { useNavigation } from "../navigation";
import type { Room, RoomSnapshot } from "@multica/core/types/room";
import { RoomListItem } from "./room-list-item";
import {
  activityScore,
  resolveRoomMemberPreviews,
} from "./room-list-utils";

type Props = {
  roomId?: string;
};

export function RoomsPage({ roomId }: Props) {
  const wsId = useWorkspaceId();
  const nav = useNavigation();
  const { data: rooms = [] } = useQuery(roomsListOptions(wsId));
  const { data: workspaceMembers = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const [createOpen, setCreateOpen] = useState(false);

  const activeId = roomId ?? rooms[0]?.id;

  const openRoom = (id: string) => {
    const slug = nav.pathname.split("/")[1];
    if (slug) nav.push(`/${slug}/rooms/${id}`);
  };

  const userNames = useMemo(
    () => new Map(workspaceMembers.map((m) => [m.user_id, m.name || m.email])),
    [workspaceMembers],
  );
  const agentNames = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );

  const memberQueries = useQueries({
    queries: rooms.map((room) => ({
      queryKey: roomKeys.members(wsId, room.id),
      queryFn: () => api.listRoomMembers(room.id),
      enabled: !!wsId && !!room.id,
      staleTime: 60_000,
    })),
  });

  const memberPreviewsByRoomId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveRoomMemberPreviews>>();
    rooms.forEach((room, index) => {
      const members = memberQueries[index]?.data ?? [];
      map.set(
        room.id,
        resolveRoomMemberPreviews(
          members,
          userNames,
          agentNames,
          room.manager_agent_id,
        ),
      );
    });
    return map;
  }, [rooms, memberQueries, userNames, agentNames]);

  const roomsByActivity = useMemo(() => {
    return [...rooms].sort((a, b) => {
      const aActive = activityScore(a.snapshot);
      const bActive = activityScore(b.snapshot);
      if (aActive !== bActive) return bActive - aActive;
      const aTime = Date.parse(a.updated_at ?? "");
      const bTime = Date.parse(b.updated_at ?? "");
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return bTime - aTime;
      }
      return a.name.localeCompare(b.name);
    });
  }, [rooms]);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "multica_rooms_list_layout",
  });

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-full min-h-0 bg-background"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel
        id="list"
        defaultSize={288}
        minSize={200}
        maxSize={420}
        groupResizeBehavior="preserve-pixel-size"
      >
        <aside className="border-border flex h-full flex-col border-r">
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
          <ul className="flex-1 overflow-y-auto">
            {roomsByActivity.map((room) => (
              <li key={room.id}>
                <RoomListItem
                  name={room.name}
                  description={room.description}
                  snapshot={normalizeSnapshot(room.snapshot)}
                  updatedAt={room.updated_at}
                  members={memberPreviewsByRoomId.get(room.id) ?? []}
                  active={activeId === room.id}
                  onClick={() => openRoom(room.id)}
                />
              </li>
            ))}
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
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="detail" minSize="45%">
        <main className="flex h-full min-h-0 min-w-0 flex-col">
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
      </ResizablePanel>
      <CreateRoomDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={openRoom}
      />
    </ResizablePanelGroup>
  );
}

function normalizeSnapshot(snapshot: Room["snapshot"]): RoomSnapshot {
  if (snapshot && typeof snapshot === "object") {
    return snapshot;
  }
  return {};
}
