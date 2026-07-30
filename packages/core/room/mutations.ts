import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { workspaceKeys } from "../workspace/queries";
import {
  appendOptimisticRoomMessage,
  patchRoomGraph,
  patchSendGraphResponse,
  reconcileOptimisticRoomMessage,
  removeOptimisticRoomMessage,
  refreshRoomGraphNow,
  roomMessagesInfiniteKey,
} from "./room-cache";
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
    onSuccess: (resp) => {
      void qc.invalidateQueries({ queryKey: roomKeys.messages(wsId, roomId) });
      if (resp) {
        patchRoomGraph(qc, wsId, roomId, (graph) =>
          patchSendGraphResponse(graph, {
            assignments: resp.assignments,
            invocations: resp.invocations,
          }),
        );
      } else {
        refreshRoomGraphNow(qc, wsId, roomId);
      }
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
      refreshRoomGraphNow(qc, wsId, roomId);
    },
  });
}

export function useSendRoomMessage(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      content: string;
      quote_message_id?: string;
      sender_id: string;
    }) => api.sendRoomMessage(roomId, data),
    onMutate: async (variables) => {
      const optimistic = {
        id: `optimistic-${Date.now()}`,
        sender_type: "user",
        sender_id: variables.sender_id,
        content: variables.content,
        quote_message_id: variables.quote_message_id,
        created_at: new Date().toISOString(),
      };
      appendOptimisticRoomMessage(qc, wsId, roomId, optimistic);
      return { optimisticId: optimistic.id };
    },
    onSuccess: (resp, _variables, context) => {
      if (resp?.message) {
        reconcileOptimisticRoomMessage(qc, wsId, roomId, resp.message);
      } else if (context?.optimisticId) {
        void qc.invalidateQueries({
          queryKey: roomMessagesInfiniteKey(wsId, roomId),
        });
      }
      patchRoomGraph(qc, wsId, roomId, (graph) =>
        patchSendGraphResponse(graph, {
          assignments: resp?.assignments,
          invocations: resp?.invocations,
          mentions: resp?.mentions,
        }),
      );
    },
    onError: (_err, _variables, context) => {
      if (!context?.optimisticId) return;
      removeOptimisticRoomMessage(qc, wsId, roomId, context.optimisticId);
    },
  });
}

export function useRetryRoomAssignment(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.retryRoomAssignment(roomId, assignmentId),
    onSuccess: () => {
      refreshRoomGraphNow(qc, wsId, roomId);
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
      refreshRoomGraphNow(qc, wsId, roomId);
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
      refreshRoomGraphNow(qc, wsId, roomId);
      void qc.invalidateQueries({ queryKey: roomKeys.detail(wsId, roomId) });
    },
  });
}

export function useAckRoomAssignmentFailure(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.ackRoomAssignmentFailure(roomId, assignmentId),
    onSuccess: () => {
      refreshRoomGraphNow(qc, wsId, roomId);
      void qc.invalidateQueries({ queryKey: roomKeys.detail(wsId, roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.list(wsId) });
    },
  });
}

export function useRespondRoomHumanInteraction(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      interactionId: string;
      option_id?: string;
      response_text?: string;
      approved?: boolean;
      reject_reason?: string;
    }) =>
      api.respondRoomHumanInteraction(roomId, data.interactionId, {
        option_id: data.option_id,
        response_text: data.response_text,
        approved: data.approved,
        reject_reason: data.reject_reason,
      }),
    onSuccess: (resp) => {
      refreshRoomGraphNow(qc, wsId, roomId);
      if (resp.message) {
        reconcileOptimisticRoomMessage(qc, wsId, roomId, resp.message);
        void qc.invalidateQueries({
          queryKey: roomMessagesInfiniteKey(wsId, roomId),
        });
      }
      if (resp.assignments?.length || resp.invocations?.length) {
        patchRoomGraph(qc, wsId, roomId, (graph) =>
          patchSendGraphResponse(graph, {
            assignments: resp.assignments,
            invocations: resp.invocations,
          }),
        );
      }
    },
  });
}

export function useDismissRoomHumanInteraction(wsId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (interactionId: string) =>
      api.dismissRoomHumanInteraction(roomId, interactionId),
    onSuccess: () => {
      refreshRoomGraphNow(qc, wsId, roomId);
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
      void qc.removeQueries({ queryKey: roomKeys.members(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.graph(wsId, roomId) });
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
      void qc.removeQueries({ queryKey: roomKeys.members(wsId, roomId) });
      void qc.removeQueries({ queryKey: roomKeys.graph(wsId, roomId) });
    },
  });
}
