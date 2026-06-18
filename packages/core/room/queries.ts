import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const ROOM_MESSAGES_PAGE_SIZE = 50;

export const roomKeys = {
  all: (wsId: string) => ["rooms", wsId] as const,
  list: (wsId: string) => [...roomKeys.all(wsId), "list"] as const,
  detail: (wsId: string, roomId: string) => [...roomKeys.all(wsId), roomId] as const,
  messages: (wsId: string, roomId: string) =>
    [...roomKeys.all(wsId), roomId, "messages"] as const,
  invocations: (wsId: string, roomId: string) =>
    [...roomKeys.all(wsId), roomId, "invocations"] as const,
  members: (wsId: string, roomId: string) =>
    [...roomKeys.all(wsId), roomId, "members"] as const,
  workboard: (wsId: string, roomId: string) =>
    [...roomKeys.all(wsId), roomId, "workboard"] as const,
  topics: (wsId: string, roomId: string) =>
    [...roomKeys.all(wsId), roomId, "topics"] as const,
  flowEvents: (wsId: string, roomId: string, scope: string = "room") =>
    [...roomKeys.all(wsId), roomId, "flow-events", scope] as const,
};

export function roomWorkboardOptions(wsId: string, roomId: string) {
  return queryOptions({
    queryKey: roomKeys.workboard(wsId, roomId),
    queryFn: () => api.getRoomWorkboard(roomId),
    enabled: !!wsId && !!roomId,
    refetchInterval: 5000,
  });
}

export function roomTopicsOptions(wsId: string, roomId: string) {
  return queryOptions({
    queryKey: roomKeys.topics(wsId, roomId),
    queryFn: async () => {
      const res = await api.listRoomTopics(roomId);
      return res.topics;
    },
    enabled: !!wsId && !!roomId,
  });
}

export function roomFlowEventsOptions(
  wsId: string,
  roomId: string,
  topicId?: string,
) {
  const scope = topicId ? `topic:${topicId}` : "room";
  return queryOptions({
    queryKey: roomKeys.flowEvents(wsId, roomId, scope),
    queryFn: async () => {
      const res = await api.listRoomFlowEvents(roomId, topicId ? { topicId } : undefined);
      return res.events;
    },
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

export function roomDetailOptions(wsId: string, roomId: string) {
  return queryOptions({
    queryKey: roomKeys.detail(wsId, roomId),
    queryFn: () => api.getRoom(roomId),
    enabled: !!wsId && !!roomId,
  });
}

export function roomMessagesOptions(wsId: string, roomId: string) {
  return queryOptions({
    queryKey: roomKeys.messages(wsId, roomId),
    queryFn: () =>
      api.listRoomMessages(roomId, { limit: ROOM_MESSAGES_PAGE_SIZE }),
    enabled: !!wsId && !!roomId,
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
  });
}

export function roomInvocationsOptions(wsId: string, roomId: string) {
  return queryOptions({
    queryKey: roomKeys.invocations(wsId, roomId),
    queryFn: () => api.listRoomInvocations(roomId),
    enabled: !!wsId && !!roomId,
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      const active = rows.some(
        (inv) =>
          inv.status === "running" ||
          inv.status === "queued" ||
          inv.status === "pending",
      );
      return active ? 3000 : false;
    },
  });
}

export function roomMembersOptions(wsId: string, roomId: string) {
  return queryOptions({
    queryKey: roomKeys.members(wsId, roomId),
    queryFn: () => api.listRoomMembers(roomId),
    enabled: !!wsId && !!roomId,
  });
}
