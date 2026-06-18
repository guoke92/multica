import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { workspaceKeys } from "../workspace/queries";
import { roomKeys } from "./queries";

export function useCreateRoom(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.createRoom>[0]) => api.createRoom(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
    },
  });
}

export function useUpdateRoomMessage(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { messageId: string; content: string }) =>
      api.updateRoomMessage(roomId, data.messageId, { content: data.content }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.messages(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.invocations(wsId, roomId) });
    },
  });
}

export function useRegenerateRoomAgentMessage(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api.regenerateRoomAgentMessage(roomId, messageId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.messages(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.invocations(wsId, roomId) });
    },
  });
}

export function useSendRoomMessage(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { content: string; quote_message_id?: string }) =>
      api.sendRoomMessage(roomId, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.messages(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.invocations(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.graph(wsId, roomId) });
    },
  });
}

export function useRetryInvocation(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invocationId: string) => api.retryInvocation(invocationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.invocations(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.messages(wsId, roomId) });
    },
  });
}

export function useCancelInvocation(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invocationId: string) => api.cancelRoomInvocation(roomId, invocationId),
    onSuccess: (updated) => {
      qc.setQueryData(
        roomKeys.invocations(wsId, roomId),
        (old: import("../types/room").MentionInvocation[] | undefined) => {
          if (!old) return old;
          const mapped = {
            id: updated.id,
            message_id: updated.message_id,
            target_type: updated.target_type,
            target_id: updated.target_id,
            status: updated.status,
            task_id: updated.task_id,
            response_message_id: updated.response_message_id,
            created_at: updated.created_at,
          };
          return old.map((i) =>
            i.id === updated.id ? { ...i, ...mapped } : i,
          );
        },
      );
      void qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
      void qc.invalidateQueries({ queryKey: roomKeys.detail(wsId, roomId) });
    },
  });
}

export function useResumeInvocation(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invocationId: string) => api.resumeInvocation(invocationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.invocations(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.messages(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.graph(wsId, roomId) });
    },
  });
}

export function useRetryRoomAssignment(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.retryRoomAssignment(roomId, assignmentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.graph(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.invocations(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.messages(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.detail(wsId, roomId) });
    },
  });
}

export function useCreateRoomAssignment(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.createRoomAssignment>[1]) =>
      api.createRoomAssignment(roomId, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.graph(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.detail(wsId, roomId) });
    },
  });
}

export function useCancelRoomAssignment(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.cancelRoomAssignment(roomId, assignmentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.graph(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.invocations(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.detail(wsId, roomId) });
    },
  });
}

export function useUpdateRoom(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.updateRoom>[1]) =>
      api.updateRoom(roomId, data),
    onSuccess: (room) => {
      qc.setQueryData(roomKeys.detail(wsId, roomId), room);
      void qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
    },
  });
}

export function useAddRoomMember(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      principal_type: string;
      principal_id: string;
      role?: string;
    }) => api.addRoomMember(roomId, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.members(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
    },
  });
}

export function useRemoveRoomMember(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { principal_type: string; principal_id: string }) =>
      api.removeRoomMember(roomId, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.members(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
    },
  });
}

export function useUpdateRoomMemberRole(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      principal_type: string;
      principal_id: string;
      role?: string;
      action?: string;
    }) => api.updateRoomMemberRole(roomId, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.members(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.detail(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
    },
  });
}

export function useLeaveRoom(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => api.leaveRoom(roomId),
    onSuccess: (_data, roomId) => {
      void qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
      void qc.removeQueries({ queryKey: roomKeys.detail(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.messages(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.invocations(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.members(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.workboard(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.topics(wsId, roomId) });
    },
  });
}

export function useArchiveRoom(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => api.archiveRoom(roomId),
    onSuccess: (_data, roomId) => {
      void qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
      void qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      void qc.removeQueries({ queryKey: roomKeys.detail(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.messages(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.invocations(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.members(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.workboard(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.topics(wsId, roomId) });
    },
  });
}
