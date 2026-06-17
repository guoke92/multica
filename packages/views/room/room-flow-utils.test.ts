import { describe, expect, it } from "vitest";
import type { RoomFlowEvent } from "@multica/core/types/room";
import {
  groupFlowTracks,
  projectFlowEvents,
  formatFlowTrackLine,
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

  it("one track per invocation with in-place status updates", () => {
    const events: RoomFlowEvent[] = [
      ev({
        id: "1",
        type: "invocation_queued",
        created_at: "2026-06-17T10:00:00Z",
        message_id: "msg-1",
        invocation_id: "inv-req",
        actor_id: "req",
      }),
      ev({
        id: "2",
        type: "invocation_pending",
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
    expect(formatFlowTrackLine(tracks[1]!)).toBe("系统架构师 · pending");
  });

  it("merges control steps into the same invocation track", () => {
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
    expect(projected).toHaveLength(2);

    const tracks = groupFlowTracks(events, {
      agentNameById: agents,
      managerAgentId: "mgr",
      invocationTargetById: new Map([["inv-mgr", "mgr"]]),
    });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.steps[0]?.actorName).toBe("群管");
    expect(formatFlowTrackLine(tracks[0]!)).toBe("群管 · 思考中");
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
      "重试",
      "queued",
      "完成",
    ]);
  });
});
