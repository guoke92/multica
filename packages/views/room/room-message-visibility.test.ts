import { describe, expect, it } from "vitest";
import { shouldHideRoomMessage } from "./room-message-visibility";
import type { RoomMessage } from "@multica/core/types/room";

function systemMessage(kind: string): RoomMessage {
  return {
    id: "1",
    sender_type: "system",
    content: "test",
    message_kind: kind,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("shouldHideRoomMessage", () => {
  it("hides workflow hint kinds from chat timeline (v2.3)", () => {
    for (const kind of ["route_hint", "relay_hint", "agent_at", "escalate_hint"]) {
      expect(shouldHideRoomMessage(systemMessage(kind))).toBe(true);
    }
  });

  it("shows generic system notifications", () => {
    expect(shouldHideRoomMessage(systemMessage("chat"))).toBe(false);
  });

  it("hides manager agent messages except notify_user", () => {
    const managerId = "mgr-1";
    expect(
      shouldHideRoomMessage(
        {
          id: "1",
          sender_type: "agent",
          sender_id: managerId,
          content: "routing",
          created_at: "2026-01-01T00:00:00Z",
        },
        managerId,
      ),
    ).toBe(true);
    expect(
      shouldHideRoomMessage(
        {
          id: "2",
          sender_type: "agent",
          sender_id: managerId,
          content: "[@dev](mention://member/u1) 请确认是否继续简化",
          metadata: { manager_notify_user: true },
          created_at: "2026-01-01T00:00:00Z",
        },
        managerId,
      ),
    ).toBe(false);
  });

  it("shows manager dispatch messages in chat timeline", () => {
    const managerId = "mgr-1";
    expect(
      shouldHideRoomMessage(
        {
          id: "3",
          sender_type: "agent",
          sender_id: managerId,
          content: "[@fe](mention://agent/fe-1) 请继续：创建文件",
          metadata: { manager_dispatch: true },
          created_at: "2026-01-01T00:00:00Z",
        },
        managerId,
      ),
    ).toBe(false);
  });
});
