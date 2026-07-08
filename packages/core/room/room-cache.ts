import type { QueryClient } from "@tanstack/react-query";
import type {
  RoomAssignment,
  RoomGraphSnapshot,
  RoomInvocation,
  RoomMessage,
  RoomMessageMention,
  RoomManagerDecision,
  RoomInvocationEvent,
} from "../types/room";
import { roomKeys } from "./queries";

const graphRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

function graphTimerKey(wsId: string, roomId: string): string {
  return `${wsId}:${roomId}`;
}

export function scheduleRoomGraphRefresh(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  delayMs = 400,
): void {
  const key = graphTimerKey(wsId, roomId);
  const existing = graphRefreshTimers.get(key);
  if (existing) clearTimeout(existing);
  graphRefreshTimers.set(
    key,
    setTimeout(() => {
      graphRefreshTimers.delete(key);
      void qc.invalidateQueries({ queryKey: roomKeys.graph(wsId, roomId) });
    }, delayMs),
  );
}

export function refreshRoomGraphNow(
  qc: QueryClient,
  wsId: string,
  roomId: string,
): void {
  const key = graphTimerKey(wsId, roomId);
  const existing = graphRefreshTimers.get(key);
  if (existing) clearTimeout(existing);
  graphRefreshTimers.delete(key);
  void qc.invalidateQueries({ queryKey: roomKeys.graph(wsId, roomId) });
}

export function patchRoomGraph(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  updater: (graph: RoomGraphSnapshot) => RoomGraphSnapshot,
): void {
  qc.setQueryData<RoomGraphSnapshot | undefined>(
    roomKeys.graph(wsId, roomId),
    (old) => {
      if (!old) return old;
      return updater(old);
    },
  );
}

export function upsertGraphInvocations(
  graph: RoomGraphSnapshot,
  incoming: RoomInvocation[],
): RoomGraphSnapshot {
  if (incoming.length === 0) return graph;
  const byId = new Map(graph.invocations.map((inv) => [inv.id, inv]));
  for (const inv of incoming) {
    byId.set(inv.id, inv);
  }
  return { ...graph, invocations: [...byId.values()] };
}

export function upsertGraphAssignments(
  graph: RoomGraphSnapshot,
  incoming: RoomAssignment[],
): RoomGraphSnapshot {
  if (incoming.length === 0) return graph;
  const byId = new Map(graph.assignments.map((a) => [a.id, a]));
  for (const assignment of incoming) {
    byId.set(assignment.id, assignment);
  }
  return { ...graph, assignments: [...byId.values()] };
}

export function upsertGraphMentions(
  graph: RoomGraphSnapshot,
  incoming: RoomMessageMention[],
): RoomGraphSnapshot {
  if (incoming.length === 0) return graph;
  const byId = new Map(graph.mentions.map((m) => [m.id, m]));
  for (const mention of incoming) {
    byId.set(mention.id, mention);
  }
  return { ...graph, mentions: [...byId.values()] };
}

export function patchGraphInvocation(
  graph: RoomGraphSnapshot,
  invocationId: string,
  patch: Partial<RoomInvocation>,
): RoomGraphSnapshot {
  const idx = graph.invocations.findIndex((inv) => inv.id === invocationId);
  if (idx < 0) return graph;
  const invocations = [...graph.invocations];
  invocations[idx] = { ...invocations[idx]!, ...patch };
  return { ...graph, invocations };
}

export function patchGraphAssignment(
  graph: RoomGraphSnapshot,
  assignmentId: string,
  patch: Partial<RoomAssignment>,
): RoomGraphSnapshot {
  const idx = graph.assignments.findIndex((a) => a.id === assignmentId);
  if (idx < 0) return graph;
  const assignments = [...graph.assignments];
  assignments[idx] = { ...assignments[idx]!, ...patch };
  return { ...graph, assignments };
}

export function appendGraphInvocationEvent(
  graph: RoomGraphSnapshot,
  event: RoomInvocationEvent,
): RoomGraphSnapshot {
  if (graph.invocation_events.some((e) => e.id === event.id)) return graph;
  return {
    ...graph,
    invocation_events: [event, ...graph.invocation_events],
  };
}

export function upsertGraphDecision(
  graph: RoomGraphSnapshot,
  decision: RoomManagerDecision,
): RoomGraphSnapshot {
  const idx = graph.decisions.findIndex((d) => d.id === decision.id);
  if (idx >= 0) {
    const decisions = [...graph.decisions];
    decisions[idx] = decision;
    return { ...graph, decisions };
  }
  return { ...graph, decisions: [decision, ...graph.decisions] };
}

export function roomMessagesInfiniteKey(wsId: string, roomId: string) {
  return [...roomKeys.messages(wsId, roomId), "infinite"] as const;
}

type MessagesInfiniteData = {
  pages: RoomMessage[][];
  pageParams: unknown[];
};

/** Newest loaded page is always pages[0]. */
function updateNewestMessagePage(
  old: MessagesInfiniteData | undefined,
  updater: (page: RoomMessage[]) => RoomMessage[],
): MessagesInfiniteData | undefined {
  if (!old?.pages.length) return old;
  const pages = [...old.pages];
  pages[0] = updater(pages[0]!);
  return { ...old, pages };
}

export function appendRoomMessage(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  message: RoomMessage,
): void {
  const key = roomMessagesInfiniteKey(wsId, roomId);
  qc.setQueryData<MessagesInfiniteData | undefined>(key, (old) =>
    updateNewestMessagePage(old, (page) => {
      if (page.some((m) => m.id === message.id)) return page;
      return [...page, message];
    }),
  );
}

export function reconcileOptimisticRoomMessage(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  message: RoomMessage,
): void {
  const key = roomMessagesInfiniteKey(wsId, roomId);
  qc.setQueryData<MessagesInfiniteData | undefined>(key, (old) =>
    updateNewestMessagePage(old, (page) => {
      if (page.some((m) => m.id === message.id)) {
        return page.filter((m) => !m.id.startsWith("optimistic-"));
      }
      let optimisticIdx = -1;
      for (let j = page.length - 1; j >= 0; j -= 1) {
        if (page[j]!.id.startsWith("optimistic-")) {
          optimisticIdx = j;
          break;
        }
      }
      if (optimisticIdx >= 0) {
        const optimistic = page[optimisticIdx]!;
        const next = [...page];
        next[optimisticIdx] = {
          ...optimistic,
          ...message,
          id: message.id,
          content: message.content || optimistic.content,
          created_at: message.created_at || optimistic.created_at,
          sender_id: message.sender_id ?? optimistic.sender_id,
          sender_type: message.sender_type || optimistic.sender_type,
          quote_message_id:
            message.quote_message_id ?? optimistic.quote_message_id,
        };
        return next;
      }
      return [...page, { ...message, created_at: message.created_at ?? "" }];
    }),
  );
}

export function appendOptimisticRoomMessage(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  message: RoomMessage,
): void {
  appendRoomMessage(qc, wsId, roomId, message);
}

export function removeOptimisticRoomMessage(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  optimisticId: string,
): void {
  const key = roomMessagesInfiniteKey(wsId, roomId);
  qc.setQueryData<MessagesInfiniteData | undefined>(key, (old) =>
    updateNewestMessagePage(old, (page) => page.filter((m) => m.id !== optimisticId)),
  );
}

export function patchSendGraphResponse(
  graph: RoomGraphSnapshot,
  patch: {
    assignments?: RoomAssignment[];
    invocations?: RoomInvocation[];
    mentions?: RoomMessageMention[];
  },
): RoomGraphSnapshot {
  let next = graph;
  if (patch.assignments?.length) {
    next = upsertGraphAssignments(next, patch.assignments);
  }
  if (patch.invocations?.length) {
    next = upsertGraphInvocations(next, patch.invocations);
  }
  if (patch.mentions?.length) {
    next = upsertGraphMentions(next, patch.mentions);
  }
  return next;
}
