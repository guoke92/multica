import type { MentionInvocation, RoomFlowEvent } from "@multica/core/types/room";

export type FlowStep = {
  token: string;
  createdAt: string;
  event: RoomFlowEvent;
  actorId: string;
  actorName: string;
};

/** One track = one agent invocation lifecycle (queued → … → terminal), or one user message. */
export type FlowTrack = {
  key: string;
  invocationId?: string;
  messageId?: string;
  steps: FlowStep[];
  startedAt: string;
  updatedAt: string;
};

export type FlowDisplayOpts = {
  managerAgentId?: string;
  memberNameById?: Map<string, string>;
  agentNameById?: Map<string, string>;
  invocationTargetById?: Map<string, string>;
};

const invocationStatusToken: Record<string, string> = {
  invocation_queued: "排队中",
  invocation_pending: "待调度",
  invocation_running: "思考中",
  invocation_succeeded: "完成",
  invocation_failed: "失败",
  invocation_timed_out: "超时",
  invocation_cancelled: "已取消",
  invocation_retried: "手动重试",
};

const humanInvocationEventTypes = new Set([
  "invocation_manual_cancel",
  "invocation_manual_retry",
  "invocation_retried",
]);

const invocationStatusFromInvocation: Record<string, string> = {
  pending: "待调度",
  queued: "排队中",
  running: "思考中",
  delivered: "思考中",
};

/** Snowflake / UUIDv7 ids are monotonic — lexicographic order matches issuance order. */
export function compareMonotonicId(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function resolveEventMessageId(event: RoomFlowEvent): string | null {
  return event.message_id ?? event.from_message_id ?? null;
}

export function projectFlowEvents(events: RoomFlowEvent[]): RoomFlowEvent[] {
  return [...events].sort((a, b) => compareMonotonicId(a.id, b.id));
}

function sortStepsByEventId(steps: FlowStep[]): FlowStep[] {
  return [...steps].sort((a, b) => compareMonotonicId(a.event.id, b.event.id));
}

function buildFlowStep(
  event: RoomFlowEvent,
  opts: {
    agentNameById: Map<string, string>;
    managerAgentId?: string;
    memberNameById?: Map<string, string>;
    invocationTargetById?: Map<string, string>;
  },
): FlowStep {
  const actorId = resolveFlowStepActorId(event, opts);
  const actorName = resolveFlowActorName(
    event,
    actorId,
    opts.agentNameById,
    opts.managerAgentId,
    opts.memberNameById,
  );
  return {
    token: flowStepToken(event, actorName),
    createdAt: event.created_at,
    event,
    actorId,
    actorName,
  };
}

export function virtualTrackForStep(step: FlowStep, messageId: string): FlowTrack {
  return {
    key: step.event.invocation_id
      ? `inv:${step.event.invocation_id}`
      : `msg:${messageId}`,
    invocationId: step.event.invocation_id,
    messageId,
    steps: [step],
    startedAt: step.createdAt,
    updatedAt: step.createdAt,
  };
}

/** One group per user message; steps are all flow events for that message, ordered by event id. */
export type FlowMessageGroup = {
  messageId: string;
  steps: FlowStep[];
};

export function groupFlowMessages(
  events: RoomFlowEvent[],
  opts: {
    agentNameById: Map<string, string>;
    managerAgentId?: string;
    memberNameById?: Map<string, string>;
    invocationTargetById?: Map<string, string>;
  },
): FlowMessageGroup[] {
  const projected = projectFlowEvents(events);
  const groups = new Map<string, FlowStep[]>();

  for (const event of projected) {
    const messageId = resolveEventMessageId(event);
    if (!messageId) continue;
    const step = buildFlowStep(event, opts);
    const steps = groups.get(messageId) ?? [];
    steps.push(step);
    groups.set(messageId, steps);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => compareMonotonicId(a, b))
    .map(([messageId, steps]) => ({
      messageId,
      steps: sortStepsByEventId(steps),
    }));
}

export function flattenFlowMessageSteps(
  groups: FlowMessageGroup[],
): Array<{ messageId: string; step: FlowStep }> {
  return groups.flatMap((group) =>
    group.steps.map((step) => ({ messageId: group.messageId, step })),
  );
}

export function isLatestInvocationStep(
  step: FlowStep,
  steps: FlowStep[],
): boolean {
  const invocationId = step.event.invocation_id;
  if (!invocationId) return true;
  let latest = step;
  for (const candidate of steps) {
    if (
      candidate.event.invocation_id === invocationId &&
      compareMonotonicId(candidate.event.id, latest.event.id) > 0
    ) {
      latest = candidate;
    }
  }
  return latest.event.id === step.event.id;
}

/** Map each event to the invocation track it belongs to. */
export function resolveFlowTrackKey(event: RoomFlowEvent): string | null {
  if (event.type === "user_intent" && event.message_id) {
    return `msg:${event.message_id}`;
  }
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
  if (event.actor_type === "user" && event.actor_id) {
    return event.actor_id;
  }

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
  memberNameById?: Map<string, string>,
): string {
  if (event.actor_type === "user") {
    const senderName = event.payload?.sender_name;
    if (typeof senderName === "string" && senderName) {
      return senderName;
    }
    return memberNameById?.get(actorId) ?? "用户";
  }

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
  if (event.type === "invocation_manual_cancel") {
    return "手动取消";
  }
  if (event.type === "invocation_manual_retry" || event.type === "invocation_retried") {
    return "手动重试";
  }
  if (event.type === "invocation_cancelled") {
    if (event.payload?.manual_cancel === true) {
      return "手动取消";
    }
    return "已取消";
  }

  const statusToken = invocationStatusToken[event.type];
  if (statusToken) {
    return statusToken;
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
    case "user_intent":
      return "发送消息";
    case "manager_route_running":
      return "分配中";
    case "manager_route_succeeded":
      return "已分配";
    case "manager_route_failed":
      return "分配失败";
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

function findManagerRouteTarget(track: FlowTrack): string | undefined {
  for (let i = track.steps.length - 1; i >= 0; i--) {
    const step = track.steps[i]!;
    const payload = step.event.payload ?? {};
    if (typeof payload.target_agent_name === "string" && payload.target_agent_name) {
      return payload.target_agent_name;
    }
    const label = payload.label;
    if (typeof label === "string") {
      const match = label.match(/路由给\s*(.+)$/u);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    if (step.token.startsWith("路由给 ")) {
      return step.token.replace(/^路由给\s*/u, "").trim();
    }
  }
  return undefined;
}

function formatUserIntentLine(step: FlowStep): string {
  const preview = step.event.payload?.preview;
  if (typeof preview === "string" && preview.trim()) {
    return `${step.actorName} · ${preview}`;
  }
  return `${step.actorName} · 发送消息`;
}

function isHumanInvocationStep(step: FlowStep): boolean {
  if (humanInvocationEventTypes.has(step.event.type)) {
    return true;
  }
  return (
    step.event.type === "invocation_cancelled" &&
    step.event.payload?.manual_cancel === true
  );
}

function isAgentInvocationStatusStep(step: FlowStep): boolean {
  return step.event.type.startsWith("invocation_") && !isHumanInvocationStep(step);
}

function resolveTrackAgentName(
  track: FlowTrack,
  step: FlowStep,
  opts?: FlowDisplayOpts,
): string {
  if (track.invocationId && opts?.invocationTargetById?.has(track.invocationId)) {
    const targetId = opts.invocationTargetById.get(track.invocationId)!;
    const name = opts.agentNameById?.get(targetId);
    if (name) {
      return name;
    }
  }
  const payloadName = step.event.payload?.agent_name;
  if (typeof payloadName === "string" && payloadName) {
    return payloadName;
  }
  return step.actorName;
}

function formatManagerFlowLine(track: FlowTrack, step: FlowStep): string {
  const targetName = findManagerRouteTarget(track);
  const type = step.event.type;
  const token = step.token;

  if (type === "invocation_succeeded" || (type.includes("succeeded") && token === "完成")) {
    if (targetName) {
      return `群管指定${targetName}回复`;
    }
    return "群管回复完成";
  }

  if (type.includes("failed") || type.includes("timed_out")) {
    return targetName ? `群管分配${targetName}失败` : `群管 · ${token}`;
  }

  if (type === "manager_route_succeeded" || token === "已分配" || token.startsWith("路由给 ")) {
    const routedTo = token.startsWith("路由给 ") ? token.replace(/^路由给\s*/u, "") : targetName;
    return routedTo ? `群管 · 分配 · ${routedTo}` : "群管 · 分配";
  }

  if (type === "manager_route_running" || token === "分配中") {
    return "群管 · 分配 · 思考中";
  }

  if (type === "manager_relay_succeeded") {
    const relayTarget =
      typeof step.event.payload?.target_agent_name === "string"
        ? step.event.payload.target_agent_name
        : undefined;
    return relayTarget ? `群管接力给${relayTarget}` : "群管 · 接力";
  }

  if (type === "manager_escalate") {
    return "群管 · 升级介入";
  }

  if (type === "invocation_running" || token === "思考中") {
    return targetName ? "群管 · 分配 · 思考中" : "群管 · 思考中";
  }

  if (type === "invocation_pending" || type === "invocation_queued") {
    return `群管 · ${token}`;
  }

  return `群管 · ${token}`;
}

export function formatFlowStepLine(
  track: FlowTrack,
  step: FlowStep,
  opts?: FlowDisplayOpts,
): string {
  if (step.event.type === "user_intent") {
    return formatUserIntentLine(step);
  }
  if (opts?.managerAgentId && step.actorId === opts.managerAgentId) {
    return formatManagerFlowLine(track, step);
  }
  if (isHumanInvocationStep(step)) {
    return `${step.actorName} · ${step.token}`;
  }
  if (isAgentInvocationStatusStep(step)) {
    return `${resolveTrackAgentName(track, step, opts)} · ${step.token}`;
  }
  return `${step.actorName} · ${step.token}`;
}

/** Group events into one track per agent invocation (full call lifecycle). */
export function groupFlowTracks(
  events: RoomFlowEvent[],
  opts: {
    agentNameById: Map<string, string>;
    managerAgentId?: string;
    memberNameById?: Map<string, string>;
    invocationTargetById?: Map<string, string>;
  },
): FlowTrack[] {
  const projected = projectFlowEvents(events);
  const tracks = new Map<string, FlowTrack>();

  for (const event of projected) {
    const trackKey = resolveFlowTrackKey(event);
    if (!trackKey) continue;

    const step = buildFlowStep(event, opts);

    let track = tracks.get(trackKey);
    if (!track) {
      track = {
        key: trackKey,
        invocationId: event.invocation_id,
        messageId: resolveEventMessageId(event) ?? undefined,
        steps: [],
        startedAt: event.created_at,
        updatedAt: event.created_at,
      };
      tracks.set(trackKey, track);
    }

    const messageId = resolveEventMessageId(event);
    if (!track.messageId && messageId) {
      track.messageId = messageId;
    }
    if (!track.invocationId && event.invocation_id) {
      track.invocationId = event.invocation_id;
    }

    track.steps.push(step);
    track.updatedAt = event.created_at;
  }

  for (const track of tracks.values()) {
    track.steps = sortStepsByEventId(track.steps);
    const first = track.steps[0];
    const last = track.steps[track.steps.length - 1];
    if (first) {
      track.startedAt = first.createdAt;
    }
    if (last) {
      track.updatedAt = last.createdAt;
    }
  }

  return [...tracks.values()].sort((a, b) => {
    const messageCmp = compareMonotonicId(a.messageId ?? "", b.messageId ?? "");
    if (messageCmp !== 0) return messageCmp;
    const aFirst = a.steps[0]?.event.id ?? a.key;
    const bFirst = b.steps[0]?.event.id ?? b.key;
    return compareMonotonicId(aFirst, bFirst);
  });
}

export function isActiveFlowStep(
  step: FlowStep,
  allSteps: FlowStep[],
  invocationById?: Map<string, MentionInvocation>,
): boolean {
  if (!isLatestInvocationStep(step, allSteps)) {
    return false;
  }
  if (step.event.invocation_id && invocationById) {
    const inv = invocationById.get(step.event.invocation_id);
    if (
      inv &&
      (inv.status === "pending" ||
        inv.status === "queued" ||
        inv.status === "running" ||
        inv.status === "delivered")
    ) {
      return true;
    }
  }
  const type = step.event.type;
  if (
    type.includes("failed") ||
    type.includes("rejected") ||
    type.includes("timed_out")
  ) {
    return true;
  }
  if (
    type === "invocation_running" ||
    type === "invocation_pending" ||
    type === "invocation_queued" ||
    type === "manager_route_running"
  ) {
    return true;
  }
  return false;
}

export function flowStepSurface(step: FlowStep): string {
  const type = step.event.type;
  if (
    type.includes("failed") ||
    type.includes("rejected") ||
    type.includes("timed_out")
  ) {
    return "bg-destructive/8";
  }
  if (type === "invocation_running" || type === "manager_route_running") {
    return "bg-primary/8";
  }
  if (type === "invocation_pending" || type === "invocation_queued") {
    return "bg-muted/50";
  }
  return "";
}

export function flowTrackLatestStep(track: FlowTrack): FlowStep | undefined {
  if (track.steps.length === 0) return undefined;
  return track.steps[track.steps.length - 1];
}

/** Prefer live invocation status when flow events lag behind the invocation row. */
export function resolveFlowTrackDisplayStep(
  track: FlowTrack,
  invocationById?: Map<string, MentionInvocation>,
  opts?: {
    agentNameById: Map<string, string>;
    managerAgentId?: string;
    invocationTargetById?: Map<string, string>;
  },
): FlowStep | undefined {
  const last = flowTrackLatestStep(track);
  if (last) {
    return last;
  }
  if (!track.invocationId || !invocationById || !opts) {
    return last;
  }
  const inv = invocationById.get(track.invocationId);
  if (!inv) {
    return last;
  }
  const liveToken = invocationStatusFromInvocation[inv.status];
  if (!liveToken) {
    return last;
  }
  const fallbackEvent: RoomFlowEvent = {
    id: `live:${track.invocationId}`,
    room_id: "",
    type:
      inv.status === "pending"
        ? "invocation_pending"
        : inv.status === "queued"
          ? "invocation_queued"
          : "invocation_running",
    created_at: track.updatedAt,
    actor_type: "agent",
    payload: {},
    invocation_id: track.invocationId,
  };
  const actorId = resolveFlowStepActorId(fallbackEvent, opts);
  const fallbackStep: FlowStep = {
    token: liveToken,
    createdAt: track.updatedAt,
    event: fallbackEvent,
    actorId,
    actorName: resolveFlowActorName(
      fallbackEvent,
      actorId,
      opts.agentNameById,
      opts.managerAgentId,
    ),
  };
  const actorName = resolveTrackAgentName(
    track,
    fallbackStep,
    {
      agentNameById: opts.agentNameById,
      invocationTargetById: opts.invocationTargetById,
    },
  );
  return {
    token: liveToken,
    createdAt: track.updatedAt,
    event: {
      ...fallbackEvent,
      actor_id: actorId,
      payload: { agent_name: actorName },
    },
    actorId,
    actorName,
  };
}

export function formatFlowTrackLine(
  track: FlowTrack,
  opts?: FlowDisplayOpts & {
    invocationById?: Map<string, MentionInvocation>;
    trackOpts?: {
      agentNameById: Map<string, string>;
      managerAgentId?: string;
      invocationTargetById?: Map<string, string>;
    };
  },
): string {
  const displayOpts: FlowDisplayOpts = {
    managerAgentId: opts?.managerAgentId ?? opts?.trackOpts?.managerAgentId,
    memberNameById: opts?.memberNameById,
    agentNameById: opts?.agentNameById ?? opts?.trackOpts?.agentNameById,
    invocationTargetById:
      opts?.invocationTargetById ?? opts?.trackOpts?.invocationTargetById,
  };
  const step = resolveFlowTrackDisplayStep(
    track,
    opts?.invocationById,
    displayOpts.agentNameById && displayOpts.invocationTargetById
      ? {
          agentNameById: displayOpts.agentNameById,
          managerAgentId: displayOpts.managerAgentId,
          invocationTargetById: displayOpts.invocationTargetById,
        }
      : opts?.trackOpts,
  );
  if (!step) return "…";
  return formatFlowStepLine(track, step, displayOpts);
}

export function isActiveFlowTrack(
  track: FlowTrack,
  invocationById?: Map<string, MentionInvocation>,
): boolean {
  const last = flowTrackLatestStep(track);
  if (!last) {
    if (track.invocationId && invocationById) {
      const inv = invocationById.get(track.invocationId);
      return (
        inv?.status === "pending" ||
        inv?.status === "queued" ||
        inv?.status === "running" ||
        inv?.status === "delivered"
      );
    }
    return false;
  }
  const type = last.event.type;
  if (
    type.includes("failed") ||
    type.includes("rejected") ||
    type.includes("timed_out")
  ) {
    return true;
  }
  if (
    type === "invocation_running" ||
    type === "invocation_pending" ||
    type === "invocation_queued" ||
    type === "manager_route_running"
  ) {
    return true;
  }
  return false;
}

export function flowTrackTone(track: FlowTrack): string {
  const last = flowTrackLatestStep(track);
  if (!last) return "text-muted-foreground";
  const type = last.event.type;

  if (
    type.includes("failed") ||
    type.includes("rejected") ||
    type.includes("timed_out")
  ) {
    return "text-destructive";
  }
  if (
    type === "invocation_running" ||
    type === "invocation_pending" ||
    type === "invocation_queued" ||
    type === "manager_route_running"
  ) {
    return "text-foreground";
  }
  return "text-muted-foreground/70";
}

export function flowStepTone(step: FlowStep): string {
  const type = step.event.type;
  if (
    type.includes("failed") ||
    type.includes("rejected") ||
    type.includes("timed_out")
  ) {
    return "text-destructive";
  }
  if (
    type === "invocation_running" ||
    type === "invocation_pending" ||
    type === "invocation_queued" ||
    type === "manager_route_running"
  ) {
    return "text-foreground";
  }
  return "text-muted-foreground/70";
}

export function flowTrackSurface(track: FlowTrack): string {
  const last = flowTrackLatestStep(track);
  if (!last) return "";
  const type = last.event.type;
  if (
    type.includes("failed") ||
    type.includes("rejected") ||
    type.includes("timed_out")
  ) {
    return "bg-destructive/8";
  }
  if (type === "invocation_running" || type === "manager_route_running") {
    return "bg-primary/8";
  }
  if (type === "invocation_pending" || type === "invocation_queued") {
    return "bg-muted/50";
  }
  return "";
}

export function buildInvocationTargetMap(
  invocations: MentionInvocation[],
): Map<string, string> {
  return new Map(invocations.map((inv) => [inv.id, inv.target_id]));
}
