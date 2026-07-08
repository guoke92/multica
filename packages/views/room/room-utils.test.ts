import { describe, expect, it } from "vitest";
import {
  buildQuoteMentionPrefix,
  resolveRoomAgentChatSummary,
  truncatePreview,
} from "./room-utils";

describe("buildQuoteMentionPrefix", () => {
  it("auto-mentions agent sender", () => {
    expect(
      buildQuoteMentionPrefix(
        { sender_type: "agent", sender_id: "agent-1" },
        "Research",
        "user-1",
      ),
    ).toBe("[@Research](mention://agent/agent-1) ");
  });

  it("skips self mention for user sender", () => {
    expect(
      buildQuoteMentionPrefix(
        { sender_type: "user", sender_id: "user-1" },
        "Me",
        "user-1",
      ),
    ).toBe("");
  });

  it("skips system messages", () => {
    expect(
      buildQuoteMentionPrefix({ sender_type: "system" }, "系统", "user-1"),
    ).toBe("");
  });
});

describe("truncatePreview", () => {
  it("truncates long text", () => {
    const long = "a".repeat(200);
    expect(truncatePreview(long, 50).endsWith("…")).toBe(true);
  });
});

describe("resolveRoomAgentChatSummary", () => {
  it("prefers message.content over detailed_explanation", () => {
    const message = {
      id: "1",
      sender_type: "agent",
      content: "简短摘要",
      metadata: { detailed_explanation: "很长".repeat(100) },
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(resolveRoomAgentChatSummary(message, "transcript")).toBe("简短摘要");
  });
});
