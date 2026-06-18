import { describe, expect, it } from "vitest";
import type { MentionInvocation, RoomFlowEvent } from "@multica/core/types/room";
import {
  compareMonotonicId,
  groupFlowMessages,
  groupFlowTracks,
  projectFlowEvents,
  formatFlowTrackLine,
  formatFlowStepLine,
} from "./room-flow-utils";

function ev(
  partial: Partial<RoomFlowEvent> & Pick<RoomFlowEvent, "id" | "type" | "created_at">,
): RoomFlowEvent {
  return {
    room_id: "room-1",
    actor_type: "agent",
    payload: {},
    ...partial,
  };
}

describe("groupFlowTracks", () => {
  const agents = new Map([
    ["mgr", "群管"],
    ["req", "需求分析师"],
    ["arch", "系统架构师"],
  ]);

  it("orders invocation steps by monotonic event id", () => {
    const events: RoomFlowEvent[] = [
      ev({
        id: "1",
        type: "invocation_pending",
        created_at: "2026-06-17T10:00:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "2",
        type: "invocation_queued",
        created_at: "2026-06-17T10:01:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "3",
        type: "invocation_running",
        created_at: "2026-06-17T10:02:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "4",
        type: "invocation_succeeded",
        created_at: "2026-06-17T10:20:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
    ];

    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      managerAgentId: "mgr",
      invocationTargetById: new Map([["inv-req", "req"]]),
    });

    expect(tracks).toHaveLength(1);
    expect(formatFlowTrackLine(tracks[0]!)).toBe("需求分析师 · 完成");
    expect(tracks[0]?.steps).toHaveLength(4);
    expect(tracks[0]?.steps.map((s) => s.token)).toEqual([
      "待调度",
      "排队中",
      "思考中",
      "完成",
    ]);
  });

  it("separate invocations on same message stay separate tracks", () => {
    const events: RoomFlowEvent[] = [
      ev({
        id: "1",
        type: "invocation_running",
        created_at: "2026-06-17T10:02:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "2",
        type: "invocation_succeeded",
        created_at: "2026-06-17T10:20:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "3",
        type: "invocation_pending",
        created_at: "2026-06-17T10:21:00Z",
        message_id: "msg-1",
        invocation_id: "inv-arch",
        actor_id: "arch",
      }),
    ];

    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      managerAgentId: "mgr",
      invocationTargetById: new Map([
        ["inv-req", "req"],
        ["inv-arch", "arch"],
      ]),
    });

    expect(tracks).toHaveLength(2);
    expect(formatFlowTrackLine(tracks[0]!)).toBe("需求分析师 · 完成");
    expect(formatFlowTrackLine(tracks[1]!)).toBe("系统架构师 · 待调度");
  });

  it("includes user message as its own track", () => {
    const events: RoomFlowEvent[] = [
      ev({
        id: "0",
        type: "user_intent",
        actor_type: "user",
        actor_id: "user-1",
        created_at: "2026-06-17T09:59:00Z",
        message_id: "msg-1",
        payload: {
          sender_name: "张三",
          preview: "帮我打开一下吧",
        },
      }),
      ev({
        id: "1",
        type: "invocation_pending",
        created_at: "2026-06-17T10:00:00Z",
        message_id: "msg-1",
        invocation_id: "inv-mgr",
        actor_id: "mgr",
      }),
    ];

    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      managerAgentId: "mgr",
      memberNameById: new Map([["user-1", "张三"]]),
      invocationTargetById: new Map([["inv-mgr", "mgr"]]),
    });

    expect(tracks).toHaveLength(2);
    expect(formatFlowTrackLine(tracks[0]!)).toBe("张三 · 帮我打开一下吧");
    expect(formatFlowTrackLine(tracks[1]!, { managerAgentId: "mgr" })).toBe(
      "群管 · 待调度",
    );
  });

  it("keeps control events as atomic history in the same invocation track", () => {
    const events: RoomFlowEvent[] = [
      ev({
        id: "1",
        type: "manager_route_running",
        category: "control",
        step_id: "route:inv-mgr",
        created_at: "2026-06-17T10:00:00Z",
        message_id: "msg-1",
        invocation_id: "inv-mgr",
        actor_id: "mgr",
      }),
      ev({
        id: "2",
        type: "manager_route_succeeded",
        category: "control",
        step_id: "route:inv-mgr",
        created_at: "2026-06-17T10:00:05Z",
        message_id: "msg-1",
        invocation_id: "inv-mgr",
        actor_id: "mgr",
        payload: {
          label: "群管 → 路由给 需求分析师",
          target_agent_name: "需求分析师",
        },
      }),
      ev({
        id: "3",
        type: "invocation_running",
        created_at: "2026-06-17T10:01:00Z",
        message_id: "msg-1",
        invocation_id: "inv-mgr",
        actor_id: "mgr",
      }),
    ];

    const projected = projectFlowEvents(events);
    expect(projected).toHaveLength(3);

    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      managerAgentId: "mgr",
      invocationTargetById: new Map([["inv-mgr", "mgr"]]),
    });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.steps[0]?.actorName).toBe("群管");
    expect(formatFlowTrackLine(tracks[0]!, { managerAgentId: "mgr" })).toBe(
      "群管 · 分配 · 思考中",
    );
  });

  it("formats manager completion with routed target", () => {
    const events: RoomFlowEvent[] = [
      ev({
        id: "1",
        type: "manager_route_succeeded",
        category: "control",
        step_id: "route:inv-mgr",
        created_at: "2026-06-17T10:00:05Z",
        message_id: "msg-1",
        invocation_id: "inv-mgr",
        actor_id: "mgr",
        payload: {
          label: "群管 → 路由给 系统架构师",
          target_agent_name: "系统架构师",
        },
      }),
      ev({
        id: "2",
        type: "invocation_succeeded",
        created_at: "2026-06-17T10:01:00Z",
        message_id: "msg-1",
        invocation_id: "inv-mgr",
        actor_id: "mgr",
      }),
    ];

    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      managerAgentId: "mgr",
      invocationTargetById: new Map([["inv-mgr", "mgr"]]),
    });

    expect(formatFlowTrackLine(tracks[0]!, { managerAgentId: "mgr" })).toBe(
      "群管指定系统架构师回复",
    );
  });

  it("includes retry in the same invocation track", () => {
    const events: RoomFlowEvent[] = [
      ev({
        id: "1",
        type: "invocation_failed",
        created_at: "2026-06-17T10:20:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "2",
        type: "invocation_retried",
        created_at: "2026-06-17T10:30:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_type: "user",
        actor_id: "user-1",
      }),
      ev({
        id: "3",
        type: "invocation_queued",
        created_at: "2026-06-17T10:30:01Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "4",
        type: "invocation_succeeded",
        created_at: "2026-06-17T10:35:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
    ];

    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      managerAgentId: "mgr",
      invocationTargetById: new Map([["inv-req", "req"]]),
    });

    expect(tracks).toHaveLength(1);
    expect(formatFlowTrackLine(tracks[0]!)).toBe("需求分析师 · 完成");
    expect(tracks[0]?.steps.map((s) => s.token)).toEqual([
      "失败",
      "手动重试",
      "排队中",
      "完成",
    ]);
  });

  it("does not let stale invocation status override terminal flow events", () => {
    const events: RoomFlowEvent[] = [
      ev({
        id: "1",
        type: "invocation_pending",
        created_at: "2026-06-17T10:00:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "2",
        type: "invocation_succeeded",
        created_at: "2026-06-17T10:05:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
    ];
    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      invocationTargetById: new Map([["inv-req", "req"]]),
    });
    const staleInvocations = new Map<string, MentionInvocation>([
      [
        "inv-req",
        {
          id: "inv-req",
          message_id: "msg-1",
          target_type: "agent",
          target_id: "req",
          status: "pending",
        },
      ],
    ]);

    expect(
      formatFlowTrackLine(tracks[0]!, {
        agentNameById: agents,
        invocationTargetById: new Map([["inv-req", "req"]]),
        invocationById: staleInvocations,
      }),
    ).toBe("需求分析师 · 完成");
  });

  it("preserves cancel → retry → running chronological order", () => {
    const events: RoomFlowEvent[] = [
      ev({
        id: "1",
        type: "invocation_running",
        created_at: "2026-06-17T15:20:00Z",
        message_id: "msg-1",
        invocation_id: "inv-fe",
        actor_id: "fe",
      }),
      ev({
        id: "2",
        type: "invocation_manual_cancel",
        created_at: "2026-06-17T15:44:01Z",
        message_id: "msg-1",
        invocation_id: "inv-fe",
        actor_type: "user",
        actor_id: "user-1",
        payload: { manual_cancel: true },
      }),
      ev({
        id: "3",
        type: "invocation_manual_retry",
        created_at: "2026-06-17T15:44:02Z",
        message_id: "msg-1",
        invocation_id: "inv-fe",
        actor_type: "user",
        actor_id: "user-1",
      }),
      ev({
        id: "4",
        type: "invocation_running",
        created_at: "2026-06-17T15:44:03Z",
        message_id: "msg-1",
        invocation_id: "inv-fe",
        actor_id: "fe",
      }),
    ];

    const trackOpts = {
      agentNameById: new Map([["fe", "前端工程师"]]),
      invocationTargetById: new Map([["inv-fe", "fe"]]),
    };

    const tracks = groupFlowTracks(events, {
      ...trackOpts,
      memberNameById: new Map([["user-1", "dev"]]),
    });

    expect(tracks[0]?.steps.map((s) => s.token)).toEqual([
      "思考中",
      "手动取消",
      "手动重试",
      "思考中",
    ]);
    expect(
      formatFlowStepLine(tracks[0]!, tracks[0]!.steps[1]!, {
        ...trackOpts,
        memberNameById: new Map([["user-1", "dev"]]),
      }),
    ).toBe("dev · 手动取消");
    expect(
      formatFlowStepLine(tracks[0]!, tracks[0]!.steps[0]!, trackOpts),
    ).toBe("前端工程师 · 思考中");
  });
});

describe("groupFlowMessages", () => {
  const agents = new Map([
    ["mgr", "群管"],
    ["req", "需求分析师"],
  ]);
  const trackOpts = {
    agentNameById: agents,
    managerAgentId: "mgr",
    invocationTargetById: new Map([["inv-req", "req"]]),
  };

  it("orders steps by event id when created_at is identical", () => {
    const sameTime = "2026-06-17T10:00:00Z";
    const events: RoomFlowEvent[] = [
      ev({
        id: "300",
        type: "invocation_running",
        created_at: sameTime,
        message_id: "msg-100",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "100",
        type: "invocation_pending",
        created_at: sameTime,
        message_id: "msg-100",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "200",
        type: "invocation_queued",
        created_at: sameTime,
        message_id: "msg-100",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
    ];

    const groups = groupFlowMessages(events, trackOpts);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.messageId).toBe("msg-100");
    expect(groups[0]?.steps.map((s) => s.token)).toEqual([
      "待调度",
      "排队中",
      "思考中",
    ]);
  });

  it("orders messages by monotonic message_id", () => {
    const sameTime = "2026-06-17T10:00:00Z";
    const events: RoomFlowEvent[] = [
      ev({
        id: "2",
        type: "user_intent",
        actor_type: "user",
        actor_id: "user-1",
        created_at: sameTime,
        message_id: "msg-200",
        payload: { sender_name: "李四", preview: "第二条" },
      }),
      ev({
        id: "1",
        type: "user_intent",
        actor_type: "user",
        actor_id: "user-1",
        created_at: sameTime,
        message_id: "msg-100",
        payload: { sender_name: "张三", preview: "第一条" },
      }),
    ];

    const groups = groupFlowMessages(events, {
      ...trackOpts,
      memberNameById: new Map([["user-1", "张三"]]),
    });

    expect(groups.map((g) => g.messageId)).toEqual(["msg-100", "msg-200"]);
  });

  it("compareMonotonicId matches snowflake lexicographic order", () => {
    expect(compareMonotonicId("100", "200")).toBeLessThan(0);
    expect(compareMonotonicId("200", "100")).toBeGreaterThan(0);
    expect(compareMonotonicId("abc", "abc")).toBe(0);
  });
});
