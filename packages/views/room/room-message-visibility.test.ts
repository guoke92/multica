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
});
