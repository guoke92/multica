import type {
  RoomAssignment,
  RoomAssignmentDependency,
  RoomInvocation,
  RoomInvocationEvent,
  RoomMessage,
} from "@multica/core/types/room";

export type FlowStep = {
  token: string;
  createdAt: string;
  event: RoomInvocationEvent;
  actorId: string;
  actorName: string;
};

/** One track = one assignment lifecycle. */
export type FlowTrack = {
  key: string;
  assignmentId: string;
  sourceMessageId?: string;
  kind: string;
  steps: FlowStep[];
  startedAt: string;
  updatedAt: string;
};

export type FlowGraphContext = {
  assignments: RoomAssignment[];
  assignment_dependencies: RoomAssignmentDependency[];
  invocations: RoomInvocation[];
};

export type FlowDisplayOpts = {
  managerAgentId?: string;
  memberNameById?: Map<string, string>;
  agentNameById?: Map<string, string>;
  graph?: FlowGraphContext;
};

export type GraphStatusCounts = {
  pending: number;
  blocked: number;
  queued: number;
  running: number;
  failed: number;
  completed: number;
};

export type AgentRunState = {
  label: string;
  tone: "running" | "queued" | "failed" | "paused";
};

const invocationStatusToken: Record<string, string> = {
  invocation_queued: "排队中",
  invocation_pending: "待调度",
  invocation_running: "思考中",
  invocation_succeeded: "完成",
  invocation_failed: "失败",
  invocation_timed_out: "超时",
  invocation_cancelled: "已取消",
  invocation_created: "已创建",
};

const assignmentStatusToken: Record<string, string> = {
  assignment_created: "已创建",
  assignment_completed: "完成",
  assignment_failed: "失败",
  assignment_cancelled: "已取消",
  assignment_retry: "手动重试",
};

const invocationStatusFromRow: Record<string, string> = {
  pending: "待调度",
  queued: "排队中",
  running: "思考中",
  delivered: "思考中",
  succeeded: "完成",
  failed: "失败",
  timed_out: "超时",
  cancelled: "已取消",
};

const assignmentStatusFromRow: Record<string, string> = {
  pending: "待处理",
  blocked: "等待汇合",
  running: "执行中",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
};

const humanInvocationEventTypes = new Set([
  "assignment_retry",
  "assignment_cancelled",
]);

/** Snowflake / UUIDv7 ids are monotonic — lexicographic order matches issuance order. */
export function compareMonotonicId(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function projectFlowEvents(events: RoomInvocationEvent[]): RoomInvocationEvent[] {
  return [...events].sort((a, b) => compareMonotonicId(a.id, b.id));
}

/** Failed assignment still actionable — latest row for assignee + source message. */
export function isUnresolvedFailedAssignment(
  assignment: RoomAssignment,
  assignments: RoomAssignment[],
): boolean {
  if (assignment.status !== "failed") return false;
  const related = assignments.filter(
    (a) =>
      a.assignee_id === assignment.assignee_id &&
      a.source_message_id === assignment.source_message_id,
  );
  const latest = latestByMonotonicId(related);
  return latest?.id === assignment.id;
}

/** Failed assignment that still needs human attention (not ack'd or superseded). */
export function needsAttentionFailure(
  assignment: RoomAssignment,
  assignments: RoomAssignment[],
): boolean {
  if (!isUnresolvedFailedAssignment(assignment, assignments)) return false;
  if (assignment.failure_acknowledged_at) return false;
  if (assignment.superseded_by_assignment_id) return false;
  return true;
}

export function countAttentionFailures(assignments: RoomAssignment[]): number {
  let count = 0;
  for (const assignment of assignments) {
    if (needsAttentionFailure(assignment, assignments)) {
      count += 1;
    }
  }
  return count;
}

export function computeGraphStatusCounts(
  assignments: RoomAssignment[],
  invocations: RoomInvocation[] = [],
): GraphStatusCounts {
  let pending = 0;
  let blocked = 0;
  let running = 0;
  let failed = 0;
  let completed = 0;

  for (const assignment of assignments) {
    switch (assignment.status) {
      case "pending":
        pending += 1;
        break;
      case "blocked":
        blocked += 1;
        break;
      case "running":
        running += 1;
        break;
      case "failed":
        if (needsAttentionFailure(assignment, assignments)) {
          failed += 1;
        }
        break;
      case "completed":
        completed += 1;
        break;
      default:
        break;
    }
  }

  const queued = invocations.filter((inv) => inv.status === "queued").length;
  const activeInvocations = invocations.filter((inv) =>
    ["running", "delivered"].includes(inv.status),
  ).length;
  running = Math.max(running, activeInvocations);

  return { pending, blocked, queued, running, failed, completed };
}

export function deriveAgentRunState(
  agentId: string,
  assignments: RoomAssignment[],
  invocations: RoomInvocation[],
): AgentRunState | undefined {
  const agentAssignments = assignments.filter(
    (a) => a.assignee_type === "agent" && a.assignee_id === agentId,
  );
  const agentInvocations = invocations.filter((inv) => inv.agent_id === agentId);

  const activeInvocation = agentInvocations.find((inv) =>
    ["running", "delivered"].includes(inv.status),
  );
  if (activeInvocation) {
    return { label: "正在处理", tone: "running" };
  }

  const queuedInvocation = agentInvocations.find((inv) =>
    ["pending", "queued"].includes(inv.status),
  );
  if (queuedInvocation) {
    return { label: "排队中", tone: "queued" };
  }

  const activeAssignment = agentAssignments.find((a) =>
    ["running", "pending", "blocked"].includes(a.status),
  );
  if (activeAssignment) {
    if (activeAssignment.status === "blocked") {
      return { label: "等待汇合", tone: "queued" };
    }
    if (activeAssignment.status === "running") {
      return { label: "正在处理", tone: "running" };
    }
    return { label: "排队中", tone: "queued" };
  }

  const pausedInvocation = agentInvocations.find((inv) => inv.status === "paused");
  if (pausedInvocation) {
    return { label: "已暂停", tone: "paused" };
  }

  // Member badge reflects latest terminal state, not historical failures.
  const latestAssignment = latestByMonotonicId(agentAssignments);
  const latestInvocation = latestByMonotonicId(agentInvocations);

  if (latestAssignment?.status === "completed") {
    return undefined;
  }

  if (latestAssignment?.status === "failed") {
    if (needsAttentionFailure(latestAssignment, agentAssignments)) {
      return { label: "失败", tone: "failed" };
    }
    return undefined;
  }

  if (latestInvocation?.status === "succeeded") {
    return undefined;
  }

  if (latestInvocation && ["failed", "timed_out"].includes(latestInvocation.status)) {
    return {
      label: latestInvocation.status === "timed_out" ? "已超时" : "失败",
      tone: "failed",
    };
  }

  return undefined;
}

function latestByMonotonicId<T extends { id: string }>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items.reduce((latest, item) =>
    compareMonotonicId(item.id, latest.id) > 0 ? item : latest,
  );
}

export type InvocationChatPresentation = "manager_status" | "agent_bubble";
export type InvocationChatPhase = "running" | "queued" | "failed";

export type InvocationChatItem = {
  invocation: RoomInvocation;
  assignment: RoomAssignment;
  agentId: string;
  agentName: string;
  sourceMessageId: string;
  presentation: InvocationChatPresentation;
  phase: InvocationChatPhase;
  failureReason?: string;
};

export type ChatTimelineEntry =
  | { kind: "message"; message: RoomMessage }
  | { kind: "invocation"; item: InvocationChatItem };

/** @deprecated Prefer InvocationChatItem */
export type ActiveInvocationSlot = {
  invocation: RoomInvocation;
  agentId: string;
  agentName: string;
  phase: "running" | "queued";
};

const activeInvocationStatuses = new Set(["running", "delivered", "queued", "pending"]);
const failedInvocationStatuses = new Set(["failed", "timed_out", "cancelled"]);

function assignmentMap(assignments: RoomAssignment[]): Map<string, RoomAssignment> {
  return new Map(assignments.map((a) => [a.id, a]));
}

function resolveInvocationPresentation(
  assignment: RoomAssignment,
  managerAgentId?: string,
): InvocationChatPresentation {
  if (assignment.kind === "auto_review") {
    return "manager_status";
  }
  if (
    managerAgentId &&
    assignment.assignee_type === "agent" &&
    assignment.assignee_id === managerAgentId
  ) {
    return "manager_status";
  }
  return "agent_bubble";
}

function resolveInvocationPhase(
  inv: RoomInvocation,
  assignment: RoomAssignment,
): InvocationChatPhase | null {
  if (["running", "delivered"].includes(inv.status)) return "running";
  if (["queued", "pending"].includes(inv.status)) return "queued";
  if (failedInvocationStatuses.has(inv.status)) return "failed";
  if (assignment.status === "failed") return "failed";
  if (activeInvocationStatuses.has(inv.status)) {
    return assignment.status === "running" ? "running" : "queued";
  }
  return null;
}

/** Active + failed invocations rendered in the chat timeline. */
export function buildInvocationChatItems(
  invocations: RoomInvocation[],
  assignments: RoomAssignment[],
  messages: RoomMessage[],
  agentNameById: Map<string, string>,
  managerAgentId?: string,
): InvocationChatItem[] {
  const messageIds = new Set(messages.map((m) => m.id));
  const byAssignment = assignmentMap(assignments);
  const latestByAssignment = new Map<string, RoomInvocation>();

  for (const inv of invocations) {
    const prev = latestByAssignment.get(inv.assignment_id);
    if (!prev || compareMonotonicId(inv.id, prev.id) > 0) {
      latestByAssignment.set(inv.assignment_id, inv);
    }
  }

  const items: InvocationChatItem[] = [];
  for (const inv of latestByAssignment.values()) {
    const assignment = byAssignment.get(inv.assignment_id);
    if (!assignment) continue;
    if (inv.output_message_id && messageIds.has(inv.output_message_id)) continue;
    if (assignment.output_message_id && messageIds.has(assignment.output_message_id)) {
      continue;
    }

    const phase = resolveInvocationPhase(inv, assignment);
    if (!phase) continue;

    const agentId =
      assignment.assignee_type === "agent" ? assignment.assignee_id : inv.agent_id;
    items.push({
      invocation: inv,
      assignment,
      agentId,
      agentName:
        agentNameById.get(agentId) ??
        agentNameById.get(inv.agent_id) ??
        "Agent",
      sourceMessageId: assignment.source_message_id || inv.source_message_id,
      presentation: resolveInvocationPresentation(assignment, managerAgentId),
      phase,
      failureReason: inv.failure_reason ?? assignment.reason,
    });
  }

  return items.sort((a, b) => compareMonotonicId(a.invocation.id, b.invocation.id));
}

/** Interleave messages with agent invocation placeholders anchored on source messages. */
export function buildChatTimeline(
  messages: RoomMessage[],
  items: InvocationChatItem[],
): ChatTimelineEntry[] {
  const agentItems = items.filter((item) => item.presentation === "agent_bubble");
  const bySource = new Map<string, InvocationChatItem[]>();
  for (const item of agentItems) {
    if (!item.sourceMessageId) continue;
    const list = bySource.get(item.sourceMessageId) ?? [];
    list.push(item);
    bySource.set(item.sourceMessageId, list);
  }

  const entries: ChatTimelineEntry[] = [];
  const attached = new Set<string>();

  for (const message of messages) {
    entries.push({ kind: "message", message });
    const related = bySource.get(message.id) ?? [];
    for (const item of related) {
      entries.push({ kind: "invocation", item });
      attached.add(item.invocation.id);
    }
  }

  for (const item of agentItems) {
    if (attached.has(item.invocation.id)) continue;
    entries.push({ kind: "invocation", item });
  }

  return entries;
}

/** Latest manager status chip per triggering message (not a separate chat row). */
export function managerStatusByMessageId(
  items: InvocationChatItem[],
): Map<string, InvocationChatItem> {
  const map = new Map<string, InvocationChatItem>();
  for (const item of items) {
    if (item.presentation !== "manager_status" || !item.sourceMessageId) continue;
    const prev = map.get(item.sourceMessageId);
    if (!prev || compareMonotonicId(item.invocation.id, prev.invocation.id) > 0) {
      map.set(item.sourceMessageId, item);
    }
  }
  return map;
}

/** Drop assignment-level lifecycle duplicates when invocation events carry the same signal. */
export function collapseRedundantFlowSteps(steps: FlowStep[]): FlowStep[] {
  const types = new Set(steps.map((step) => step.event.type));
  const skipAssignment = new Set<string>();
  if (types.has("invocation_created")) {
    skipAssignment.add("assignment_created");
  }
  if (types.has("invocation_succeeded")) {
    skipAssignment.add("assignment_completed");
  }
  if (
    types.has("invocation_failed") ||
    types.has("invocation_timed_out") ||
    types.has("invocation_cancelled")
  ) {
    skipAssignment.add("assignment_failed");
  }

  const filtered = steps.filter(
    (step) => !skipAssignment.has(step.event.type),
  );

  const result: FlowStep[] = [];
  for (const step of filtered) {
    const prev = result[result.length - 1];
    if (prev && prev.token === step.token) continue;
    result.push(step);
  }
  return result;
}

/** @deprecated Prefer buildInvocationChatItems */
export function listActiveInvocationSlots(
  invocations: RoomInvocation[],
  messages: RoomMessage[],
  agentNameById: Map<string, string>,
): ActiveInvocationSlot[] {
  const messageIds = new Set(messages.map((m) => m.id));

  return invocations
    .filter((inv) => {
      if (!activeInvocationStatuses.has(inv.status)) return false;
      if (inv.output_message_id && messageIds.has(inv.output_message_id)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => compareMonotonicId(a.id, b.id))
    .map((inv) => ({
      invocation: inv,
      agentId: inv.agent_id,
      agentName: agentNameById.get(inv.agent_id) ?? "Agent",
      phase: ["running", "delivered"].includes(inv.status) ? "running" : "queued",
    }));
}

function sortStepsByEventId(steps: FlowStep[]): FlowStep[] {
  return [...steps].sort((a, b) => compareMonotonicId(a.event.id, b.event.id));
}

function assignmentById(
  graph: FlowGraphContext | undefined,
  assignmentId: string,
): RoomAssignment | undefined {
  return graph?.assignments.find((a) => a.id === assignmentId);
}

function invocationForAssignment(
  graph: FlowGraphContext | undefined,
  assignmentId: string,
): RoomInvocation | undefined {
  if (!graph) return undefined;
  const active = graph.invocations.filter((inv) => inv.assignment_id === assignmentId);
  if (active.length === 0) return undefined;
  return [...active].sort((a, b) =>
    compareMonotonicId(b.created_at ?? b.id, a.created_at ?? a.id),
  )[0];
}

export function resolveAssignmentAgentId(
  assignmentId: string,
  graph?: FlowGraphContext,
): string | undefined {
  const inv = invocationForAssignment(graph, assignmentId);
  if (inv?.agent_id) return inv.agent_id;
  const assignment = assignmentById(graph, assignmentId);
  if (assignment?.assignee_type === "agent") {
    return assignment.assignee_id;
  }
  return undefined;
}

export function computeJoinProgress(
  assignmentId: string,
  graph: FlowGraphContext,
): { completed: number; total: number } {
  const deps = graph.assignment_dependencies.filter(
    (d) => d.assignment_id === assignmentId,
  );
  const total = deps.length;
  let completed = 0;
  for (const dep of deps) {
    const prereq = graph.assignments.find(
      (a) => a.id === dep.depends_on_assignment_id,
    );
    if (prereq?.status === "completed") {
      completed += 1;
    }
  }
  return { completed, total };
}

function buildFlowStep(
  event: RoomInvocationEvent,
  opts: {
    agentNameById: Map<string, string>;
    managerAgentId?: string;
    memberNameById?: Map<string, string>;
    graph?: FlowGraphContext;
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

export function resolveFlowTrackKey(event: RoomInvocationEvent): string | null {
  if (!event.assignment_id) return null;
  return `asgn:${event.assignment_id}`;
}

export function resolveFlowStepActorId(
  event: RoomInvocationEvent,
  opts: {
    managerAgentId?: string;
    graph?: FlowGraphContext;
  },
): string {
  if (event.actor_type === "user" && event.actor_id) {
    return event.actor_id;
  }

  const agentId = resolveAssignmentAgentId(event.assignment_id, opts.graph);
  if (agentId) {
    return agentId;
  }

  if (event.actor_type === "agent" && event.actor_id) {
    return event.actor_id;
  }
  if (opts.managerAgentId) {
    return opts.managerAgentId;
  }
  return event.actor_id ?? "system";
}

export function resolveFlowActorName(
  event: RoomInvocationEvent,
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

export function flowStepToken(
  event: RoomInvocationEvent,
  actorName: string,
): string {
  const assignmentToken = assignmentStatusToken[event.type];
  if (assignmentToken) {
    return assignmentToken;
  }

  const invocationToken = invocationStatusToken[event.type];
  if (invocationToken) {
    return invocationToken;
  }

  const payload = event.payload ?? {};
  if (typeof payload.label === "string" && payload.label) {
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
    return payload.label;
  }

  return event.type.replace(/^(assignment_|invocation_)/, "").replace(/_/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assignmentKindLabel(kind: string): string {
  switch (kind) {
    case "join":
      return "汇合";
    case "mention":
      return "提及";
    case "manager_route":
      return "群管路由";
    case "auto_review":
      return "自动审阅";
    default:
      return kind || "任务";
  }
}

function formatJoinLine(
  assignment: RoomAssignment,
  graph: FlowGraphContext,
  token: string,
): string {
  const { completed, total } = computeJoinProgress(assignment.id, graph);
  if (total > 0) {
    return `汇合 ${completed}/${total} · ${token}`;
  }
  return `汇合 · ${token}`;
}

function resolveTrackAgentName(
  track: FlowTrack,
  step: FlowStep,
  opts?: FlowDisplayOpts,
): string {
  const agentId = resolveAssignmentAgentId(track.assignmentId, opts?.graph);
  if (agentId) {
    const name = opts?.agentNameById?.get(agentId);
    if (name) return name;
  }
  const payloadName = step.event.payload?.agent_name;
  if (typeof payloadName === "string" && payloadName) {
    return payloadName;
  }
  return step.actorName;
}

function isHumanAssignmentStep(step: FlowStep): boolean {
  if (humanInvocationEventTypes.has(step.event.type)) {
    return true;
  }
  return (
    step.event.type === "assignment_cancelled" && step.event.actor_type === "user"
  );
}

function isAgentInvocationStatusStep(step: FlowStep): boolean {
  return step.event.type.startsWith("invocation_") && !isHumanAssignmentStep(step);
}

export function formatFlowStepLine(
  track: FlowTrack,
  step: FlowStep,
  opts?: FlowDisplayOpts,
): string {
  const assignment = assignmentById(opts?.graph, track.assignmentId);
  if (assignment?.kind === "join" && opts?.graph) {
    return formatJoinLine(assignment, opts.graph, step.token);
  }

  if (opts?.managerAgentId && step.actorId === opts.managerAgentId) {
    return `群管 · ${step.token}`;
  }
  if (isHumanAssignmentStep(step)) {
    return `${step.actorName} · ${step.token}`;
  }
  if (isAgentInvocationStatusStep(step)) {
    return `${resolveTrackAgentName(track, step, opts)} · ${step.token}`;
  }
  if (assignment) {
    if (
      assignment.assignee_type === "agent" &&
      ["manager_route", "manager_relay", "mention", "reassign"].includes(assignment.kind)
    ) {
      return `${resolveTrackAgentName(track, step, opts)} · ${step.token}`;
    }
    if (assignment.kind === "auto_review") {
      return `群管 · ${step.token}`;
    }
    return `${assignmentKindLabel(assignment.kind)} · ${step.token}`;
  }
  return `${step.actorName} · ${step.token}`;
}

/** Group invocation events into one track per assignment. */
export function groupFlowTracks(
  events: RoomInvocationEvent[],
  opts: {
    agentNameById: Map<string, string>;
    managerAgentId?: string;
    memberNameById?: Map<string, string>;
    graph?: FlowGraphContext;
  },
): FlowTrack[] {
  const projected = projectFlowEvents(events);
  const tracks = new Map<string, FlowTrack>();

  for (const event of projected) {
    const trackKey = resolveFlowTrackKey(event);
    if (!trackKey || !event.assignment_id) continue;

    const step = buildFlowStep(event, opts);
    let track = tracks.get(trackKey);
    if (!track) {
      const assignment = assignmentById(opts.graph, event.assignment_id);
      track = {
        key: trackKey,
        assignmentId: event.assignment_id,
        sourceMessageId: assignment?.source_message_id,
        kind: assignment?.kind ?? "",
        steps: [],
        startedAt: event.created_at,
        updatedAt: event.created_at,
      };
      tracks.set(trackKey, track);
    }

    track.steps.push(step);
    track.updatedAt = event.created_at;
  }

  for (const track of tracks.values()) {
    track.steps = collapseRedundantFlowSteps(sortStepsByEventId(track.steps));
    const first = track.steps[0];
    const last = track.steps[track.steps.length - 1];
    if (first) track.startedAt = first.createdAt;
    if (last) track.updatedAt = last.createdAt;
  }

  return [...tracks.values()].sort((a, b) => {
    const messageCmp = compareMonotonicId(
      a.sourceMessageId ?? "",
      b.sourceMessageId ?? "",
    );
    if (messageCmp !== 0) return messageCmp;
    const aFirst = a.steps[0]?.event.id ?? a.key;
    const bFirst = b.steps[0]?.event.id ?? b.key;
    return compareMonotonicId(aFirst, bFirst);
  });
}

export function flowTrackLatestStep(track: FlowTrack): FlowStep | undefined {
  if (track.steps.length === 0) return undefined;
  return track.steps[track.steps.length - 1];
}

export function resolveFlowTrackDisplayStep(
  track: FlowTrack,
  graph?: FlowGraphContext,
  opts?: {
    agentNameById: Map<string, string>;
    managerAgentId?: string;
  },
): FlowStep | undefined {
  const last = flowTrackLatestStep(track);
  if (last) return last;

  const assignment = assignmentById(graph, track.assignmentId);
  if (!assignment) return undefined;

  const inv = invocationForAssignment(graph, track.assignmentId);
  const liveToken =
    (inv && invocationStatusFromRow[inv.status]) ||
    assignmentStatusFromRow[assignment.status];
  if (!liveToken) return undefined;

  const fallbackEvent: RoomInvocationEvent = {
    id: `live:${track.assignmentId}`,
    room_id: assignment.room_id,
    assignment_id: track.assignmentId,
    invocation_id: inv?.id,
    type: inv ? `invocation_${inv.status}` : `assignment_${assignment.status}`,
    created_at: assignment.updated_at ?? assignment.created_at ?? "",
    actor_type: "agent",
    payload: {},
  };
  const actorId = resolveAssignmentAgentId(track.assignmentId, graph) ?? "system";
  return {
    token: liveToken,
    createdAt: fallbackEvent.created_at,
    event: { ...fallbackEvent, actor_id: actorId },
    actorId,
    actorName: resolveFlowActorName(
      fallbackEvent,
      actorId,
      opts?.agentNameById ?? new Map(),
      opts?.managerAgentId,
    ),
  };
}

export function formatFlowTrackLine(
  track: FlowTrack,
  opts?: FlowDisplayOpts & {
    invocationById?: Map<string, RoomInvocation>;
  },
): string {
  const displayOpts: FlowDisplayOpts = {
    managerAgentId: opts?.managerAgentId,
    memberNameById: opts?.memberNameById,
    agentNameById: opts?.agentNameById,
    graph: opts?.graph,
  };
  const step = resolveFlowTrackDisplayStep(track, opts?.graph, {
    agentNameById: opts?.agentNameById ?? new Map(),
    managerAgentId: opts?.managerAgentId,
  });
  if (!step) return "…";
  return formatFlowStepLine(track, step, displayOpts);
}

export function isActiveFlowTrack(
  track: FlowTrack,
  graph?: FlowGraphContext,
): boolean {
  const assignment = assignmentById(graph, track.assignmentId);
  if (
    assignment &&
    ["pending", "blocked", "running"].includes(assignment.status)
  ) {
    return true;
  }

  const inv = invocationForAssignment(graph, track.assignmentId);
  if (
    inv &&
    ["pending", "queued", "running", "delivered"].includes(inv.status)
  ) {
    return true;
  }

  const last = flowTrackLatestStep(track);
  if (!last) return false;

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
    type === "assignment_created"
  ) {
    return true;
  }
  return false;
}

export function flowTrackTone(track: FlowTrack, graph?: FlowGraphContext): string {
  const assignment = assignmentById(graph, track.assignmentId);
  if (assignment?.status === "failed") return "text-destructive";
  const inv = invocationForAssignment(graph, track.assignmentId);
  if (inv && ["failed", "timed_out"].includes(inv.status)) {
    return "text-destructive";
  }

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
    assignment?.status === "running"
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
    type === "invocation_queued"
  ) {
    return "text-foreground";
  }
  return "text-muted-foreground/70";
}

export function flowTrackSurface(track: FlowTrack, graph?: FlowGraphContext): string {
  const assignment = assignmentById(graph, track.assignmentId);
  if (assignment?.status === "failed") return "bg-destructive/8";
  const inv = invocationForAssignment(graph, track.assignmentId);
  if (inv && ["failed", "timed_out"].includes(inv.status)) {
    return "bg-destructive/8";
  }

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
  if (type === "invocation_running" || assignment?.status === "running") {
    return "bg-primary/8";
  }
  if (type === "invocation_pending" || type === "invocation_queued") {
    return "bg-muted/50";
  }
  return "";
}

export function buildInvocationAgentMap(
  invocations: RoomInvocation[],
): Map<string, string> {
  return new Map(invocations.map((inv) => [inv.id, inv.agent_id]));
}

export function isFlowTrackAttentionFailure(
  track: FlowTrack,
  graph?: FlowGraphContext,
): boolean {
  const assignment = assignmentById(graph, track.assignmentId);
  if (!assignment || !graph) return false;
  return needsAttentionFailure(assignment, graph.assignments);
}

/** Resolve the chat message to scroll to for a flow track. */
export function resolveFlowScrollMessageId(
  track: FlowTrack,
  messages: RoomMessage[],
  graph?: FlowGraphContext,
): string | undefined {
  const assignment = assignmentById(graph, track.assignmentId);
  const candidates = [
    track.sourceMessageId,
    assignment?.source_message_id,
  ].filter((id): id is string => Boolean(id));

  const messageIds = new Set(messages.map((m) => m.id));
  for (const id of candidates) {
    if (messageIds.has(id)) return id;
  }

  const anchor = candidates[0];
  if (!anchor || messages.length === 0) {
    return messages[messages.length - 1]?.id;
  }

  let before: RoomMessage | undefined;
  let after: RoomMessage | undefined;
  for (const message of messages) {
    if (compareMonotonicId(message.id, anchor) <= 0) {
      if (!before || compareMonotonicId(message.id, before.id) > 0) {
        before = message;
      }
    } else if (!after) {
      after = message;
    }
  }
  return before?.id ?? after?.id ?? messages[messages.length - 1]?.id;
}
