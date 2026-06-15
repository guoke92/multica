import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

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
  flowEvents: (wsId: string, roomId: string, topicId: string) =>
    [...roomKeys.all(wsId), roomId, "flow-events", topicId] as const,
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
  topicId: string | undefined,
) {
  return queryOptions({
    queryKey: roomKeys.flowEvents(wsId, roomId, topicId ?? ""),
    queryFn: async () => {
      const res = await api.listRoomFlowEvents(roomId, topicId!);
      return res.events;
    },
    enabled: !!wsId && !!roomId && !!topicId,
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
    queryFn: () => api.listRoomMessages(roomId),
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
