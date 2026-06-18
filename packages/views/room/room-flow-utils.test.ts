import { describe, expect, it } from "vitest";
import type {
  RoomAssignment,
  RoomAssignmentDependency,
  RoomInvocation,
  RoomInvocationEvent,
  RoomMessage,
} from "@multica/core/types/room";
import {
  buildChatTimeline,
  buildInvocationChatItems,
  collapseRedundantFlowSteps,
  compareMonotonicId,
  computeGraphStatusCounts,
  computeJoinProgress,
  deriveAgentRunState,
  formatFlowStepLine,
  formatFlowTrackLine,
  groupFlowTracks,
  listActiveInvocationSlots,
  managerStatusByMessageId,
  projectFlowEvents,
} from "./room-flow-utils";

function ev(
  partial: Partial<RoomInvocationEvent> &
    Pick<RoomInvocationEvent, "id" | "type" | "created_at" | "assignment_id">,
): RoomInvocationEvent {
  return {
    room_id: "room-1",
    actor_type: "agent",
    payload: {},
    ...partial,
  };
}

function assignment(
  partial: Partial<RoomAssignment> & Pick<RoomAssignment, "id" | "kind" | "status">,
): RoomAssignment {
  return {
    room_id: "room-1",
    source_message_id: "msg-1",
    assignee_type: "agent",
    assignee_id: "req",
    ...partial,
  };
}

describe("groupFlowTracks", () => {
  const agents = new Map([
    ["mgr", "群管"],
    ["req", "需求分析师"],
    ["arch", "系统架构师"],
  ]);

  const graph = {
    assignments: [
      assignment({ id: "asgn-req", kind: "mention", status: "running", assignee_id: "req" }),
      assignment({ id: "asgn-arch", kind: "mention", status: "pending", assignee_id: "arch" }),
      assignment({ id: "asgn-join", kind: "join", status: "blocked", assignee_id: "mgr" }),
    ],
    assignment_dependencies: [
      {
        id: "dep-1",
        assignment_id: "asgn-join",
        depends_on_assignment_id: "asgn-req",
      },
      {
        id: "dep-2",
        assignment_id: "asgn-join",
        depends_on_assignment_id: "asgn-arch",
      },
    ] as RoomAssignmentDependency[],
    invocations: [
      {
        id: "inv-req",
        assignment_id: "asgn-req",
        source_message_id: "msg-1",
        agent_id: "req",
        status: "running",
      },
      {
        id: "inv-arch",
        assignment_id: "asgn-arch",
        source_message_id: "msg-1",
        agent_id: "arch",
        status: "pending",
      },
    ] as RoomInvocation[],
  };

  it("orders invocation steps by monotonic event id within an assignment track", () => {
    const events: RoomInvocationEvent[] = [
      ev({
        id: "1",
        type: "invocation_pending",
        created_at: "2026-06-17T10:00:00Z",
        assignment_id: "asgn-req",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "2",
        type: "invocation_queued",
        created_at: "2026-06-17T10:01:00Z",
        assignment_id: "asgn-req",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "3",
        type: "invocation_running",
        created_at: "2026-06-17T10:02:00Z",
        assignment_id: "asgn-req",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "4",
        type: "invocation_succeeded",
        created_at: "2026-06-17T10:20:00Z",
        assignment_id: "asgn-req",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
    ];

    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      managerAgentId: "mgr",
      graph,
    });

    expect(tracks).toHaveLength(1);
    expect(formatFlowTrackLine(tracks[0]!, { agentNameById: agents, graph })).toBe(
      "需求分析师 · 完成",
    );
    expect(tracks[0]?.steps).toHaveLength(4);
    expect(tracks[0]?.steps.map((s) => s.token)).toEqual([
      "待调度",
      "排队中",
      "思考中",
      "完成",
    ]);
  });

  it("keeps separate assignments as separate tracks", () => {
    const events: RoomInvocationEvent[] = [
      ev({
        id: "1",
        type: "invocation_running",
        created_at: "2026-06-17T10:02:00Z",
        assignment_id: "asgn-req",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "2",
        type: "invocation_succeeded",
        created_at: "2026-06-17T10:20:00Z",
        assignment_id: "asgn-req",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "3",
        type: "assignment_created",
        created_at: "2026-06-17T10:21:00Z",
        assignment_id: "asgn-arch",
        actor_id: "arch",
        payload: { kind: "mention" },
      }),
    ];

    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      managerAgentId: "mgr",
      graph,
    });

    expect(tracks).toHaveLength(2);
    expect(formatFlowTrackLine(tracks[0]!, { agentNameById: agents, graph })).toBe(
      "需求分析师 · 完成",
    );
    expect(formatFlowTrackLine(tracks[1]!, { agentNameById: agents, graph })).toBe(
      "系统架构师 · 已创建",
    );
  });

  it("formats join assignments with completed/total progress", () => {
    const joinGraph = {
      ...graph,
      assignments: [
        assignment({ id: "asgn-req", kind: "mention", status: "completed", assignee_id: "req" }),
        assignment({ id: "asgn-arch", kind: "mention", status: "running", assignee_id: "arch" }),
        assignment({ id: "asgn-join", kind: "join", status: "blocked", assignee_id: "mgr" }),
      ],
    };
    const events: RoomInvocationEvent[] = [
      ev({
        id: "1",
        type: "assignment_created",
        created_at: "2026-06-17T10:22:00Z",
        assignment_id: "asgn-join",
        actor_id: "mgr",
        payload: { kind: "join", status: "blocked" },
      }),
    ];

    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      managerAgentId: "mgr",
      graph: joinGraph,
    });

    expect(computeJoinProgress("asgn-join", joinGraph)).toEqual({
      completed: 1,
      total: 2,
    });
    expect(
      formatFlowTrackLine(tracks[0]!, {
        agentNameById: agents,
        managerAgentId: "mgr",
        graph: joinGraph,
      }),
    ).toBe("汇合 1/2 · 已创建");
  });

  it("preserves retry in the same assignment track", () => {
    const events: RoomInvocationEvent[] = [
      ev({
        id: "1",
        type: "invocation_failed",
        created_at: "2026-06-17T10:20:00Z",
        assignment_id: "asgn-req",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "2",
        type: "assignment_retry",
        created_at: "2026-06-17T10:30:00Z",
        assignment_id: "asgn-req",
        actor_type: "user",
        actor_id: "user-1",
      }),
      ev({
        id: "3",
        type: "invocation_queued",
        created_at: "2026-06-17T10:30:01Z",
        assignment_id: "asgn-req",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "4",
        type: "invocation_succeeded",
        created_at: "2026-06-17T10:35:00Z",
        assignment_id: "asgn-req",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
    ];

    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      memberNameById: new Map([["user-1", "dev"]]),
      graph,
    });

    expect(tracks).toHaveLength(1);
    expect(formatFlowTrackLine(tracks[0]!, { agentNameById: agents, graph })).toBe(
      "需求分析师 · 完成",
    );
    expect(
      formatFlowStepLine(tracks[0]!, tracks[0]!.steps[1]!, {
        memberNameById: new Map([["user-1", "dev"]]),
        graph,
      }),
    ).toBe("dev · 手动重试");
  });
});

describe("graph helpers", () => {
  const assignments: RoomAssignment[] = [
    assignment({ id: "a1", kind: "mention", status: "pending" }),
    assignment({ id: "a2", kind: "mention", status: "blocked" }),
    assignment({ id: "a3", kind: "mention", status: "running" }),
    assignment({ id: "a4", kind: "mention", status: "failed" }),
    assignment({ id: "a5", kind: "mention", status: "completed" }),
  ];
  const invocations: RoomInvocation[] = [
    {
      id: "i1",
      assignment_id: "a3",
      source_message_id: "msg-1",
      agent_id: "req",
      status: "queued",
    },
  ];

  it("computes status counts from assignments and invocations", () => {
    expect(computeGraphStatusCounts(assignments, invocations)).toEqual({
      pending: 1,
      blocked: 1,
      queued: 1,
      running: 1,
      failed: 1,
      completed: 1,
    });
  });

  it("derives agent run state from graph rows", () => {
    expect(deriveAgentRunState("req", assignments, invocations)).toEqual({
      label: "排队中",
      tone: "queued",
    });
    expect(deriveAgentRunState("arch", assignments, invocations)).toBeUndefined();
  });

  it("compareMonotonicId matches snowflake lexicographic order", () => {
    expect(compareMonotonicId("100", "200")).toBeLessThan(0);
    expect(compareMonotonicId("200", "100")).toBeGreaterThan(0);
    expect(compareMonotonicId("abc", "abc")).toBe(0);
  });

  it("lists active invocation slots until output message appears", () => {
    const agents = new Map([["fe", "前端工程师"]]);
    const messages: RoomMessage[] = [
      {
        id: "out-1",
        sender_type: "agent",
        sender_id: "fe",
        content: "done",
        created_at: "2026-06-18T10:00:00Z",
      },
    ];
    const invocations: RoomInvocation[] = [
      {
        id: "200",
        assignment_id: "a-run",
        source_message_id: "msg-1",
        agent_id: "fe",
        status: "running",
        task_id: "task-1",
      },
      {
        id: "inv-done",
        assignment_id: "a-done",
        source_message_id: "msg-1",
        agent_id: "fe",
        status: "succeeded",
        output_message_id: "out-1",
      },
      {
        id: "100",
        assignment_id: "a-queue",
        source_message_id: "msg-2",
        agent_id: "arch",
        status: "queued",
      },
    ];

    const slots = listActiveInvocationSlots(invocations, messages, agents);
    expect(slots).toHaveLength(2);
    expect(slots.find((s) => s.agentId === "fe")).toMatchObject({
      agentName: "前端工程师",
      phase: "running",
    });
    expect(slots.find((s) => s.agentId === "arch")).toMatchObject({
      phase: "queued",
    });
  });

  it("buildInvocationChatItems separates manager status from agent bubbles", () => {
    const agents = new Map([
      ["mgr", "群管"],
      ["arch", "系统架构师"],
    ]);
    const assignments: RoomAssignment[] = [
      assignment({
        id: "a-review",
        kind: "auto_review",
        status: "running",
        assignee_id: "mgr",
        source_message_id: "msg-user",
      }),
      assignment({
        id: "a-route",
        kind: "manager_route",
        status: "failed",
        assignee_id: "arch",
        source_message_id: "msg-user",
        reason: "empty agent response",
      }),
    ];
    const invocations: RoomInvocation[] = [
      {
        id: "inv-review",
        assignment_id: "a-review",
        source_message_id: "msg-user",
        agent_id: "mgr",
        status: "running",
      },
      {
        id: "inv-route",
        assignment_id: "a-route",
        source_message_id: "msg-user",
        agent_id: "arch",
        status: "failed",
        failure_reason: "empty agent response",
      },
    ];
    const messages: RoomMessage[] = [
      {
        id: "msg-user",
        sender_type: "user",
        sender_id: "user-1",
        content: "review this",
        created_at: "2026-06-18T10:00:00Z",
      },
    ];

    const items = buildInvocationChatItems(
      invocations,
      assignments,
      messages,
      agents,
      "mgr",
    );
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.assignment.id === "a-review")).toMatchObject({
      presentation: "manager_status",
      phase: "running",
    });
    expect(items.find((i) => i.assignment.id === "a-route")).toMatchObject({
      presentation: "agent_bubble",
      phase: "failed",
      agentName: "系统架构师",
    });

    const timeline = buildChatTimeline(messages, items);
    expect(timeline.map((e) => e.kind)).toEqual(["message", "invocation"]);
  });

  it("managerStatusByMessageId keeps latest manager chip per message", () => {
    const agents = new Map([["mgr", "群管"]]);
    const items = buildInvocationChatItems(
      [
        {
          id: "inv-1",
          assignment_id: "a-1",
          source_message_id: "msg-1",
          agent_id: "mgr",
          status: "succeeded",
        },
        {
          id: "inv-2",
          assignment_id: "a-2",
          source_message_id: "msg-1",
          agent_id: "mgr",
          status: "running",
        },
      ] as RoomInvocation[],
      [
        assignment({ id: "a-1", kind: "auto_review", status: "completed", assignee_id: "mgr", source_message_id: "msg-1" }),
        assignment({ id: "a-2", kind: "auto_review", status: "running", assignee_id: "mgr", source_message_id: "msg-1" }),
      ],
      [{ id: "msg-1", sender_type: "user", sender_id: "u1", content: "hi", created_at: "2026-06-18T10:00:00Z" }],
      agents,
      "mgr",
    );
    const map = managerStatusByMessageId(items);
    expect(map.get("msg-1")?.assignment.id).toBe("a-2");
  });

  it("collapseRedundantFlowSteps drops duplicate assignment lifecycle events", () => {
    const steps = [
      { token: "已创建", event: ev({ id: "1", type: "assignment_created", created_at: "2026-06-18T10:00:00Z", assignment_id: "a1" }) },
      { token: "已创建", event: ev({ id: "2", type: "invocation_created", created_at: "2026-06-18T10:00:00Z", assignment_id: "a1", invocation_id: "i1" }) },
      { token: "思考中", event: ev({ id: "3", type: "invocation_running", created_at: "2026-06-18T10:01:00Z", assignment_id: "a1", invocation_id: "i1" }) },
      { token: "完成", event: ev({ id: "4", type: "assignment_completed", created_at: "2026-06-18T10:02:00Z", assignment_id: "a1" }) },
      { token: "完成", event: ev({ id: "5", type: "invocation_succeeded", created_at: "2026-06-18T10:02:00Z", assignment_id: "a1", invocation_id: "i1" }) },
    ];
    const collapsed = collapseRedundantFlowSteps(steps);
    expect(collapsed.map((s) => s.token)).toEqual(["已创建", "思考中", "完成"]);
  });

  it("shows assignee name for manager_route assignment failures in flow timeline", () => {
    const graph = {
      assignments: [
        assignment({
          id: "asgn-arch",
          kind: "manager_route",
          status: "failed",
          assignee_id: "arch",
          source_message_id: "msg-user",
        }),
      ],
      assignment_dependencies: [] as RoomAssignmentDependency[],
      invocations: [
        {
          id: "inv-arch",
          assignment_id: "asgn-arch",
          source_message_id: "msg-user",
          agent_id: "arch",
          status: "failed",
        },
      ],
    };
    const tracks = groupFlowTracks(
      [
        ev({
          id: "300",
          type: "assignment_failed",
          created_at: "2026-06-18T10:00:00Z",
          assignment_id: "asgn-arch",
        }),
      ],
      {
        agentNameById: new Map([["arch", "系统架构师"]]),
        graph,
      },
    );
    expect(formatFlowTrackLine(tracks[0]!, { agentNameById: new Map([["arch", "系统架构师"]]), graph })).toBe(
      "系统架构师 · 失败",
    );
  });

  it("projectFlowEvents sorts by id", () => {
    const events = projectFlowEvents([
      ev({
        id: "300",
        type: "invocation_running",
        created_at: "2026-06-17T10:00:00Z",
        assignment_id: "asgn-req",
      }),
      ev({
        id: "100",
        type: "invocation_pending",
        created_at: "2026-06-17T10:00:00Z",
        assignment_id: "asgn-req",
      }),
    ]);
    expect(events.map((e) => e.id)).toEqual(["100", "300"]);
  });
});
