import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const ROOM_MESSAGES_PAGE_SIZE = 50;

export const roomKeys = {
  all: (wsId: string) => ["rooms", wsId] as const,
  list: (wsId: string) => [...roomKeys.all(wsId), "list"] as const,
  detail: (wsId: string, roomId: string) => [...roomKeys.all(wsId), roomId] as const,
  messages: (wsId: string, roomId: string) =>
    [...roomKeys.all(wsId), roomId, "messages"] as const,
  members: (wsId: string, roomId: string) =>
    [...roomKeys.all(wsId), roomId, "members"] as const,
  graph: (wsId: string, roomId: string) =>
    [...roomKeys.all(wsId), roomId, "graph"] as const,
};

export function roomGraphOptions(wsId: string, roomId: string) {
  return queryOptions({
    queryKey: roomKeys.graph(wsId, roomId),
    queryFn: () => api.getRoomGraph(roomId),
    enabled: !!wsId && !!roomId,
    placeholderData: (previousData) => previousData,
  });
}

export function roomDetailOptions(wsId: string, roomId: string) {
  return queryOptions({
    queryKey: roomKeys.detail(wsId, roomId),
    queryFn: () => api.getRoom(roomId),
    enabled: !!wsId && !!roomId,
  });
}

export function roomsListOptions(wsId: string) {
  return queryOptions({
    queryKey: roomKeys.list(wsId),
    queryFn: () => api.listRooms(),
    enabled: !!wsId,
  });
}

/** Cursor pagination for older messages (`before` = oldest loaded message id). */
export function roomMessagesInfiniteOptions(wsId: string, roomId: string) {
  return infiniteQueryOptions({
    queryKey: [...roomKeys.messages(wsId, roomId), "infinite"] as const,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.listRoomMessages(roomId, {
        limit: ROOM_MESSAGES_PAGE_SIZE,
        before: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < ROOM_MESSAGES_PAGE_SIZE) return undefined;
      return lastPage[0]?.id;
    },
    enabled: !!wsId && !!roomId,
    placeholderData: (previousData) => previousData,
  });
}

export function roomMembersOptions(wsId: string, roomId: string) {
  return queryOptions({
    queryKey: roomKeys.members(wsId, roomId),
    queryFn: () => api.listRoomMembers(roomId),
    enabled: !!wsId && !!roomId,
  });
}
