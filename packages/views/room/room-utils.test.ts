import { describe, expect, it } from "vitest";
import {
  buildQuoteMentionPrefix,
  resolveAssignmentAttribution,
  resolveRoomAgentChatSummary,
  truncatePreview,
} from "./room-utils";

describe("resolveAssignmentAttribution", () => {
  it("labels manager-routed role agents", () => {
    expect(
      resolveAssignmentAttribution(
        { id: "a1", kind: "manager_route" },
        [],
        "fe",
      ),
    ).toBe("由群管分配指定");
  });

  it("labels user mentions", () => {
    expect(
      resolveAssignmentAttribution(
        { id: "a1", kind: "mention" },
        [
          {
            id: "m1",
            message_id: "msg-1",
            assignment_id: "a1",
            target_type: "agent",
            target_id: "fe",
            source_type: "manual",
          },
        ],
        "fe",
      ),
    ).toBe("用户 @ 指定");
  });
});

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
