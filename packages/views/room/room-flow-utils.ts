import type { MentionInvocation, RoomFlowEvent } from "@multica/core/types/room";

export type FlowStep = {
  token: string;
  createdAt: string;
  event: RoomFlowEvent;
  actorId: string;
  actorName: string;
};

/** One track = one agent invocation lifecycle (queued → … → terminal). */
export type FlowTrack = {
  key: string;
  invocationId?: string;
  messageId?: string;
  steps: FlowStep[];
  startedAt: string;
  updatedAt: string;
};

const invocationStatusToken: Record<string, string> = {
  invocation_queued: "queued",
  invocation_pending: "pending",
  invocation_running: "思考中",
  invocation_succeeded: "完成",
  invocation_failed: "失败",
  invocation_timed_out: "超时",
  invocation_cancelled: "已取消",
  invocation_retried: "重试",
};

export function projectFlowEvents(events: RoomFlowEvent[]): RoomFlowEvent[] {
  const chronological = [...events].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const byKey = new Map<string, RoomFlowEvent>();
  const order: string[] = [];

  for (const event of chronological) {
    const key =
      (event.category === "control" || event.category === "confirm") && event.step_id
        ? `step:${event.step_id}`
        : `event:${event.id}`;
    if (!byKey.has(key)) {
      order.push(key);
    }
    byKey.set(key, event);
  }

  return order
    .map((key) => byKey.get(key))
    .filter((event): event is RoomFlowEvent => Boolean(event));
}

/** Map each event to the invocation track it belongs to. */
export function resolveFlowTrackKey(event: RoomFlowEvent): string | null {
  if (event.invocation_id) {
    return `inv:${event.invocation_id}`;
  }
  if (event.step_id) {
    const prefix = event.step_id.indexOf(":");
    if (prefix > 0) {
      return `inv:${event.step_id.slice(prefix + 1)}`;
    }
  }
  return null;
}

export function resolveFlowStepActorId(
  event: RoomFlowEvent,
  opts: {
    managerAgentId?: string;
    invocationTargetById?: Map<string, string>;
  },
): string {
  if (event.invocation_id && opts.invocationTargetById?.has(event.invocation_id)) {
    return opts.invocationTargetById.get(event.invocation_id)!;
  }

  if (
    event.category === "control" ||
    event.category === "confirm" ||
    event.type.startsWith("manager_")
  ) {
    if (event.actor_type === "agent" && event.actor_id) {
      return event.actor_id;
    }
    if (opts.managerAgentId) {
      return opts.managerAgentId;
    }
  }

  if (event.actor_type === "agent" && event.actor_id) {
    return event.actor_id;
  }
  return event.actor_id ?? "system";
}

export function resolveFlowActorName(
  event: RoomFlowEvent,
  actorId: string,
  agentNameById: Map<string, string>,
  managerAgentId?: string,
): string {
  if (managerAgentId && actorId === managerAgentId) {
    return "群管";
  }
  if (typeof event.payload?.agent_name === "string" && event.payload.agent_name) {
    const name = event.payload.agent_name;
    if (agentNameById.get(actorId) === name || !agentNameById.has(actorId)) {
      return name;
    }
  }
  return agentNameById.get(actorId) ?? (actorId === "system" ? "系统" : "Agent");
}

export function flowStepToken(event: RoomFlowEvent, actorName: string): string {
  if (invocationStatusToken[event.type]) {
    return invocationStatusToken[event.type];
  }

  const payload = event.payload ?? {};
  if (typeof payload.label === "string" && payload.label) {
    if (payload.label.includes("路由给")) {
      return payload.label.replace(/^群管\s*→\s*/u, "");
    }
    const stripped = payload.label.replace(
      new RegExp(`^${escapeRegExp(actorName)}\\s*·\\s*`),
      "",
    );
    if (
      stripped &&
      stripped !== payload.label &&
      stripped.length <= 16 &&
      !stripped.includes(" → ")
    ) {
      return stripped;
    }
  }

  switch (event.type) {
    case "manager_route_running":
      return "路由中";
    case "manager_route_succeeded":
      return "已分配";
    case "manager_route_failed":
      return "路由失败";
    case "manager_relay_succeeded":
      return "接力";
    case "manager_escalate":
      return "升级介入";
    case "agent_at_succeeded":
      return "互@";
    case "human_confirm_accepted":
      return "已确认";
    case "human_confirm_rejected":
      return "已拒绝";
    case "topic_compressed":
      return "阶段压缩";
    default:
      return event.type.replace(/^invocation_/, "").replace(/_/g, " ");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Group events into one track per agent invocation (full call lifecycle). */
export function groupFlowTracks(
  events: RoomFlowEvent[],
  opts: {
    agentNameById: Map<string, string>;
    managerAgentId?: string;
    invocationTargetById?: Map<string, string>;
  },
): FlowTrack[] {
  const projected = projectFlowEvents(events);
  const tracks = new Map<string, FlowTrack>();

  for (const event of projected) {
    const trackKey = resolveFlowTrackKey(event);
    if (!trackKey) continue;

    const actorId = resolveFlowStepActorId(event, opts);
    const actorName = resolveFlowActorName(
      event,
      actorId,
      opts.agentNameById,
      opts.managerAgentId,
    );
    const token = flowStepToken(event, actorName);

    let track = tracks.get(trackKey);
    if (!track) {
      track = {
        key: trackKey,
        invocationId: event.invocation_id,
        messageId: event.message_id ?? event.from_message_id,
        steps: [],
        startedAt: event.created_at,
        updatedAt: event.created_at,
      };
      tracks.set(trackKey, track);
    }

    if (!track.messageId) {
      track.messageId = event.message_id ?? event.from_message_id;
    }
    if (!track.invocationId && event.invocation_id) {
      track.invocationId = event.invocation_id;
    }

    const last = track.steps[track.steps.length - 1];
    if (
      last &&
      last.token === token &&
      last.actorId === actorId &&
      last.event.type === event.type
    ) {
      last.createdAt = event.created_at;
      last.event = event;
      track.updatedAt = event.created_at;
      continue;
    }

    track.steps.push({
      token,
      createdAt: event.created_at,
      event,
      actorId,
      actorName,
    });
    track.updatedAt = event.created_at;
  }

  return [...tracks.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export function flowTrackLatestStep(track: FlowTrack): FlowStep | undefined {
  return track.steps[track.steps.length - 1];
}

export function flowTrackCurrentStatus(track: FlowTrack): string {
  return flowTrackLatestStep(track)?.token ?? "…";
}

export function formatFlowTrackLine(track: FlowTrack): string {
  const last = flowTrackLatestStep(track);
  if (!last) return "…";
  return `${last.actorName} · ${last.token}`;
}

export function flowTrackTone(track: FlowTrack): string {
  const last = flowTrackLatestStep(track)?.event.type ?? "";
  if (last.includes("failed") || last.includes("rejected") || last.includes("timed_out")) {
    return "text-destructive";
  }
  if (last.includes("succeeded") || last.includes("accepted")) {
    return "text-green-600 dark:text-green-500";
  }
  if (last.includes("running") || last === "invocation_running") {
    return "text-primary";
  }
  return "text-muted-foreground";
}

export function flowStepTone(step: FlowStep): string {
  const type = step.event.type;
  if (type.includes("failed") || type.includes("rejected") || type.includes("timed_out")) {
    return "text-destructive";
  }
  if (type.includes("succeeded") || type.includes("accepted")) {
    return "text-green-600 dark:text-green-500";
  }
  if (type.includes("running") || type === "invocation_running") {
    return "text-primary";
  }
  return "text-muted-foreground";
}

export function buildInvocationTargetMap(
  invocations: MentionInvocation[],
): Map<string, string> {
  return new Map(invocations.map((inv) => [inv.id, inv.target_id]));
}
