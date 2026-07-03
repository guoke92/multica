import { describe, expect, it } from "vitest";
import type {
  RoomAssignment,
  RoomAssignmentDependency,
  RoomInvocation,
  RoomInvocationEvent,
  RoomManagerDecision,
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
  needsAttentionFailure,
  projectFlowEvents,
  resolveFlowScrollMessageId,
  resolveFlowTrackElapsedSeconds,
  resolveFlowTrackTimerAnchor,
  isFlowTrackLiveForTimer,
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
    assignment({ id: "a1", kind: "mention", status: "pending", source_message_id: "msg-1" }),
    assignment({ id: "a2", kind: "mention", status: "blocked", source_message_id: "msg-2" }),
    assignment({ id: "a3", kind: "mention", status: "running", source_message_id: "msg-3" }),
    assignment({ id: "a4", kind: "mention", status: "failed", source_message_id: "msg-4" }),
    assignment({ id: "a5", kind: "mention", status: "completed", source_message_id: "msg-5" }),
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

  it("ignores superseded failed assignments in status counts", () => {
    const superseded: RoomAssignment[] = [
      assignment({
        id: "100",
        kind: "manager_route",
        status: "failed",
        assignee_id: "arch",
        source_message_id: "msg-1",
      }),
      assignment({
        id: "200",
        kind: "manager_route",
        status: "completed",
        assignee_id: "arch",
        source_message_id: "msg-1",
      }),
    ];
    expect(computeGraphStatusCounts(superseded, [])).toMatchObject({
      failed: 0,
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

  it("clears failed badge after retry succeeds on same assignment", () => {
    const agentAssignments: RoomAssignment[] = [
      assignment({
        id: "200",
        kind: "manager_route",
        status: "completed",
        assignee_id: "arch",
      }),
    ];
    const agentInvocations: RoomInvocation[] = [
      {
        id: "100",
        assignment_id: "200",
        source_message_id: "msg-1",
        agent_id: "arch",
        status: "failed",
      },
      {
        id: "300",
        assignment_id: "200",
        source_message_id: "msg-1",
        agent_id: "arch",
        status: "succeeded",
      },
    ];
    expect(
      deriveAgentRunState("arch", agentAssignments, agentInvocations),
    ).toBeUndefined();
  });

  it("clears failed badge when a newer assignment completes", () => {
    const agentAssignments: RoomAssignment[] = [
      assignment({
        id: "100",
        kind: "manager_route",
        status: "failed",
        assignee_id: "arch",
      }),
      assignment({
        id: "200",
        kind: "manager_route",
        status: "completed",
        assignee_id: "arch",
      }),
    ];
    expect(deriveAgentRunState("arch", agentAssignments, [])).toBeUndefined();
  });

  it("shows failed only when latest assignment or invocation is terminal failure", () => {
    const agentAssignments: RoomAssignment[] = [
      assignment({
        id: "200",
        kind: "mention",
        status: "failed",
        assignee_id: "fe",
      }),
    ];
    const agentInvocations: RoomInvocation[] = [
      {
        id: "100",
        assignment_id: "200",
        source_message_id: "msg-1",
        agent_id: "fe",
        status: "failed",
      },
    ];
    expect(deriveAgentRunState("fe", agentAssignments, agentInvocations)).toEqual({
      label: "失败",
      tone: "failed",
    });
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
      { token: "已创建", createdAt: "2026-06-18T10:00:00Z", actorId: "req", actorName: "Agent", event: ev({ id: "1", type: "assignment_created", created_at: "2026-06-18T10:00:00Z", assignment_id: "a1" }) },
      { token: "已创建", createdAt: "2026-06-18T10:00:00Z", actorId: "req", actorName: "Agent", event: ev({ id: "2", type: "invocation_created", created_at: "2026-06-18T10:00:00Z", assignment_id: "a1", invocation_id: "i1" }) },
      { token: "思考中", createdAt: "2026-06-18T10:01:00Z", actorId: "req", actorName: "Agent", event: ev({ id: "3", type: "invocation_running", created_at: "2026-06-18T10:01:00Z", assignment_id: "a1", invocation_id: "i1" }) },
      { token: "完成", createdAt: "2026-06-18T10:02:00Z", actorId: "req", actorName: "Agent", event: ev({ id: "4", type: "assignment_completed", created_at: "2026-06-18T10:02:00Z", assignment_id: "a1" }) },
      { token: "完成", createdAt: "2026-06-18T10:02:00Z", actorId: "req", actorName: "Agent", event: ev({ id: "5", type: "invocation_succeeded", created_at: "2026-06-18T10:02:00Z", assignment_id: "a1", invocation_id: "i1" }) },
    ];
    const collapsed = collapseRedundantFlowSteps(steps);
    expect(collapsed.map((s) => s.token)).toEqual(["已创建", "思考中", "完成"]);
  });

  it("formats manager auto_review tracks with task and status", () => {
    const graph = {
      assignments: [
        assignment({
          id: "asgn-mgr",
          kind: "auto_review",
          status: "completed",
          assignee_id: "mgr",
          source_message_id: "msg-user",
        }),
      ],
      assignment_dependencies: [] as RoomAssignmentDependency[],
      invocations: [
        {
          id: "inv-mgr",
          assignment_id: "asgn-mgr",
          source_message_id: "msg-user",
          agent_id: "mgr",
          status: "succeeded",
        },
      ],
      decisions: [] as RoomManagerDecision[],
    };
    const events: RoomInvocationEvent[] = [
      ev({
        id: "100",
        type: "invocation_running",
        created_at: "2026-06-18T10:00:00Z",
        assignment_id: "asgn-mgr",
        invocation_id: "inv-mgr",
        actor_id: "mgr",
      }),
      ev({
        id: "200",
        type: "invocation_succeeded",
        created_at: "2026-06-18T10:00:30Z",
        assignment_id: "asgn-mgr",
        invocation_id: "inv-mgr",
        actor_id: "mgr",
      }),
    ];
    const tracks = groupFlowTracks(events, {
      agentNameById: new Map([["mgr", "群管"], ["fe", "前端工程师"]]),
      managerAgentId: "mgr",
      graph,
    });
    expect(
      formatFlowTrackLine(tracks[0]!, {
        agentNameById: new Map([["mgr", "群管"], ["fe", "前端工程师"]]),
        managerAgentId: "mgr",
        graph,
      }),
    ).toBe("群管 · 路由审阅 · 完成");
  });

  it("shows manager decision action in flow timeline", () => {
    const graph = {
      assignments: [
        assignment({
          id: "asgn-mgr",
          kind: "auto_review",
          status: "completed",
          assignee_id: "mgr",
          source_message_id: "msg-user",
        }),
      ],
      assignment_dependencies: [] as RoomAssignmentDependency[],
      invocations: [
        {
          id: "inv-mgr",
          assignment_id: "asgn-mgr",
          source_message_id: "msg-user",
          agent_id: "mgr",
          status: "succeeded",
        },
      ],
      decisions: [
        {
          id: "dec-1",
          room_id: "room-1",
          source_message_id: "msg-user",
          invocation_id: "inv-mgr",
          action: "assign",
          payload: { route_to: "fe" },
        },
      ] satisfies RoomManagerDecision[],
    };
    const tracks = groupFlowTracks(
      [
        ev({
          id: "200",
          type: "invocation_succeeded",
          created_at: "2026-06-18T10:00:30Z",
          assignment_id: "asgn-mgr",
          invocation_id: "inv-mgr",
          actor_id: "mgr",
        }),
      ],
      {
        agentNameById: new Map([["mgr", "群管"], ["fe", "前端工程师"]]),
        managerAgentId: "mgr",
        graph,
      },
    );
    expect(
      formatFlowTrackLine(tracks[0]!, {
        agentNameById: new Map([["mgr", "群管"], ["fe", "前端工程师"]]),
        managerAgentId: "mgr",
        graph,
      }),
    ).toBe("群管 · 分配 前端工程师 · 完成");
  });

  it("shows manager relay reason in flow timeline", () => {
    const graph = {
      assignments: [
        assignment({
          id: "asgn-mgr",
          kind: "auto_review",
          status: "completed",
          assignee_id: "mgr",
          source_message_id: "msg-user",
        }),
      ],
      assignment_dependencies: [] as RoomAssignmentDependency[],
      invocations: [
        {
          id: "inv-mgr",
          assignment_id: "asgn-mgr",
          source_message_id: "msg-user",
          agent_id: "mgr",
          status: "succeeded",
        },
      ],
      decisions: [
        {
          id: "dec-1",
          room_id: "room-1",
          source_message_id: "msg-user",
          invocation_id: "inv-mgr",
          action: "assign",
          payload: {
            relay_to: "fe",
            relay_reason: "需补充单元测试与落盘验证",
          },
        },
      ] satisfies RoomManagerDecision[],
    };
    const tracks = groupFlowTracks(
      [
        ev({
          id: "200",
          type: "invocation_succeeded",
          created_at: "2026-06-18T10:00:30Z",
          assignment_id: "asgn-mgr",
          invocation_id: "inv-mgr",
          actor_id: "mgr",
        }),
      ],
      {
        agentNameById: new Map([["mgr", "群管"], ["fe", "前端工程师"]]),
        managerAgentId: "mgr",
        graph,
      },
    );
    expect(
      formatFlowTrackLine(tracks[0]!, {
        agentNameById: new Map([["mgr", "群管"], ["fe", "前端工程师"]]),
        managerAgentId: "mgr",
        graph,
      }),
    ).toBe("群管 · 转派 前端工程师（需补充单元测试与落盘验证） · 完成");
  });

  it("shows failure escalation task while manager is replanning", () => {
    const graph = {
      assignments: [
        assignment({
          id: "asgn-mgr",
          kind: "auto_review",
          status: "running",
          assignee_id: "mgr",
          source_message_id: "msg-user",
          reason: JSON.stringify({
            escalation: "role_failure",
            failed_assignment_id: "asgn-fe",
            failed_agent_id: "fe",
          }),
        }),
      ],
      assignment_dependencies: [] as RoomAssignmentDependency[],
      invocations: [
        {
          id: "inv-mgr",
          assignment_id: "asgn-mgr",
          source_message_id: "msg-user",
          agent_id: "mgr",
          status: "running",
        },
      ],
      decisions: [] as RoomManagerDecision[],
    };
    const tracks = groupFlowTracks(
      [
        ev({
          id: "100",
          type: "invocation_running",
          created_at: "2026-06-18T10:00:00Z",
          assignment_id: "asgn-mgr",
          invocation_id: "inv-mgr",
          actor_id: "mgr",
        }),
      ],
      {
        agentNameById: new Map([["mgr", "群管"], ["fe", "前端工程师"]]),
        managerAgentId: "mgr",
        graph,
      },
    );
    expect(
      formatFlowTrackLine(tracks[0]!, {
        agentNameById: new Map([["mgr", "群管"], ["fe", "前端工程师"]]),
        managerAgentId: "mgr",
        graph,
      }),
    ).toBe("群管 · 处置 前端工程师 失败 · 思考中");
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

describe("needsAttentionFailure", () => {
  it("counts only unacked unsuperseded latest failures", () => {
    const assignments: RoomAssignment[] = [
      assignment({ id: "a1", kind: "mention", status: "failed", assignee_id: "agent-a" }),
      assignment({
        id: "a2",
        kind: "mention",
        status: "failed",
        assignee_id: "agent-b",
        failure_acknowledged_at: "2026-06-18T10:00:00Z",
      }),
      assignment({
        id: "a3",
        kind: "mention",
        status: "failed",
        assignee_id: "agent-c",
        superseded_by_assignment_id: "a4",
      }),
      assignment({ id: "300", kind: "mention", status: "failed", assignee_id: "req" }),
      assignment({ id: "400", kind: "mention", status: "completed", assignee_id: "req" }),
    ];
    expect(needsAttentionFailure(assignments[0]!, assignments)).toBe(true);
    expect(needsAttentionFailure(assignments[1]!, assignments)).toBe(false);
    expect(needsAttentionFailure(assignments[2]!, assignments)).toBe(false);
    expect(needsAttentionFailure(assignments[3]!, assignments)).toBe(false);
  });
});

describe("resolveFlowScrollMessageId", () => {
  const messages: RoomMessage[] = [
    { id: "100", sender_type: "user", content: "a", created_at: "2026-06-18T10:00:00Z" },
    { id: "200", sender_type: "user", content: "b", created_at: "2026-06-18T10:01:00Z" },
    { id: "300", sender_type: "user", content: "c", created_at: "2026-06-18T10:02:00Z" },
  ];

  it("prefers the assignment source message when present", () => {
    const track = {
      key: "asgn:1",
      assignmentId: "asgn-1",
      sourceMessageId: "200",
      kind: "mention",
      steps: [],
      startedAt: "",
      updatedAt: "",
    };
    expect(resolveFlowScrollMessageId(track, messages)).toBe("200");
  });

  it("falls back to nearest message when source is missing from list", () => {
    const track = {
      key: "asgn:1",
      assignmentId: "asgn-1",
      sourceMessageId: "250",
      kind: "auto_review",
      steps: [],
      startedAt: "",
      updatedAt: "",
    };
    expect(resolveFlowScrollMessageId(track, messages)).toBe("200");
  });
});

describe("flow track timer", () => {
  const graph = {
    assignments: [
      assignment({ id: "asgn-1", kind: "mention", status: "completed" }),
      assignment({ id: "asgn-live", kind: "mention", status: "running" }),
    ],
    assignment_dependencies: [],
    invocations: [
      {
        id: "inv-1",
        assignment_id: "asgn-1",
        source_message_id: "msg-1",
        agent_id: "req",
        status: "succeeded",
        created_at: "2026-06-18T10:00:00Z",
        completed_at: "2026-06-18T10:00:45Z",
      },
      {
        id: "inv-live",
        assignment_id: "asgn-live",
        source_message_id: "msg-1",
        agent_id: "arch",
        status: "running",
        created_at: "2026-06-18T10:05:00Z",
      },
    ] as RoomInvocation[],
  };

  const doneTrack = {
    key: "asgn:asgn-1",
    assignmentId: "asgn-1",
    kind: "mention",
    steps: [],
    startedAt: "2026-06-18T10:00:00Z",
    updatedAt: "2026-06-18T10:00:45Z",
  };

  const liveTrack = {
    key: "asgn:asgn-live",
    assignmentId: "asgn-live",
    kind: "mention",
    steps: [
      {
        token: "思考中",
        createdAt: "2026-06-18T10:05:01Z",
        actorId: "arch",
        actorName: "系统架构师",
        event: ev({
          id: "900",
          type: "invocation_running",
          created_at: "2026-06-18T10:05:01Z",
          assignment_id: "asgn-live",
        }),
      },
    ],
    startedAt: "2026-06-18T10:05:00Z",
    updatedAt: "2026-06-18T10:05:01Z",
  };

  it("uses invocation created_at as timer anchor", () => {
    expect(resolveFlowTrackTimerAnchor(doneTrack, graph)).toEqual({
      key: "inv-1",
      createdAt: "2026-06-18T10:00:00Z",
    });
  });

  it("computes static elapsed for completed tracks", () => {
    expect(resolveFlowTrackElapsedSeconds(doneTrack, graph)).toBe(45);
  });

  it("marks running invocations as live", () => {
    expect(isFlowTrackLiveForTimer(liveTrack, graph)).toBe(true);
    expect(resolveFlowTrackElapsedSeconds(liveTrack, graph)).toBeNull();
  });
});

describe("invocation inline anchoring", () => {
  const userMsg: RoomMessage = {
    id: "msg-user",
    sender_type: "user",
    sender_id: "user-1",
    content: "build snake",
    created_at: "2026-06-18T10:00:00Z",
  };
  const agentMsg: RoomMessage = {
    id: "msg-agent-out",
    sender_type: "agent",
    sender_id: "fe",
    content: "done",
    quote_message_id: "msg-user",
    created_at: "2026-06-18T10:05:00Z",
  };
  const agents = new Map([
    ["mgr", "群管"],
    ["fe", "前端工程师"],
  ]);

  it("hides role-agent slot once output message is in the timeline", () => {
    const assignments: RoomAssignment[] = [
      assignment({
        id: "a-route",
        kind: "manager_route",
        status: "running",
        assignee_id: "fe",
        source_message_id: "msg-user",
        output_message_id: "msg-agent-out",
      }),
    ];
    const invocations: RoomInvocation[] = [
      {
        id: "inv-route",
        assignment_id: "a-route",
        source_message_id: "msg-user",
        agent_id: "fe",
        status: "running",
        output_message_id: "msg-agent-out",
      },
    ];

    const items = buildInvocationChatItems(
      invocations,
      assignments,
      [userMsg, agentMsg],
      agents,
      "mgr",
    );
    expect(items).toHaveLength(0);
  });

  it("shows post-output manager review on agent trigger message", () => {
    const assignments: RoomAssignment[] = [
      assignment({
        id: "a-review",
        kind: "auto_review",
        status: "completed",
        assignee_id: "mgr",
        source_message_id: "msg-agent-out",
      }),
    ];
    const invocations: RoomInvocation[] = [
      {
        id: "inv-review",
        assignment_id: "a-review",
        source_message_id: "msg-agent-out",
        agent_id: "mgr",
        intent: "review",
        status: "succeeded",
        outcome: { type: "review_complete" },
      },
    ];

    const items = buildInvocationChatItems(
      invocations,
      assignments,
      [userMsg, agentMsg],
      agents,
      "mgr",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      presentation: "manager_status",
      sourceMessageId: "msg-agent-out",
      phase: "succeeded",
    });
  });

  it("keeps dispatch outcome on the user trigger message", () => {
    const assignments: RoomAssignment[] = [
      assignment({
        id: "a-review",
        kind: "auto_review",
        status: "completed",
        assignee_id: "mgr",
        source_message_id: "msg-user",
      }),
    ];
    const invocations: RoomInvocation[] = [
      {
        id: "inv-review",
        assignment_id: "a-review",
        source_message_id: "msg-user",
        agent_id: "mgr",
        intent: "route",
        status: "succeeded",
        outcome: { type: "dispatch", target_agent_id: "fe" },
      },
    ];

    const items = buildInvocationChatItems(
      invocations,
      assignments,
      [userMsg, agentMsg],
      agents,
      "mgr",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      presentation: "manager_status",
      sourceMessageId: "msg-user",
      phase: "succeeded",
    });
  });
});
