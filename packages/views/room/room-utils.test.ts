import { describe, expect, it } from "vitest";
import { buildQuoteMentionPrefix, buildThreadForest, resolveInvocationAttribution, resolveRoomAgentChatSummary, truncatePreview } from "./room-utils";

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

describe("buildThreadForest", () => {
  it("nests quoted messages", () => {
    const messages = [
      { id: "1", sender_type: "user", content: "root", created_at: "2026-01-01T00:00:00Z" },
      {
        id: "2",
        sender_type: "user",
        content: "reply",
        quote_message_id: "1",
        created_at: "2026-01-01T00:01:00Z",
      },
    ] as import("@multica/core/types/room").RoomMessage[];
    const forest = buildThreadForest(messages);
    expect(forest).toHaveLength(1);
    expect(forest[0]?.children).toHaveLength(1);
    expect(forest[0]?.children[0]?.root.id).toBe("2");
  });

  it("treats orphan quotes as roots", () => {
    const messages = [
      {
        id: "2",
        sender_type: "user",
        content: "orphan",
        quote_message_id: "missing",
        created_at: "2026-01-01T00:00:00Z",
      },
    ] as import("@multica/core/types/room").RoomMessage[];
    expect(buildThreadForest(messages)).toHaveLength(1);
  });

  it("breaks quote cycles", () => {
    const messages = [
      { id: "a", sender_type: "user", content: "a", quote_message_id: "b", created_at: "2026-01-01T00:00:00Z" },
      { id: "b", sender_type: "user", content: "b", quote_message_id: "a", created_at: "2026-01-01T00:01:00Z" },
    ] as import("@multica/core/types/room").RoomMessage[];
    const forest = buildThreadForest(messages);
    expect(forest).toHaveLength(2);
    expect(forest.every((n) => n.children.length === 0)).toBe(true);
  });
});

describe("resolveInvocationAttribution", () => {
  const root = {
    id: "u1",
    sender_type: "user",
    content: "hi",
    created_at: "2026-01-01T00:00:00Z",
  } as import("@multica/core/types/room").RoomMessage;

  it("shows manager attribution for routed execute invocations", () => {
    const invocations = [
      { id: "m1", message_id: "u1", target_id: "mgr", intent: "route", target_type: "agent" },
      { id: "e1", message_id: "u1", target_id: "a1", intent: "execute", target_type: "agent" },
    ] as import("@multica/core/types/room").MentionInvocation[];
    expect(
      resolveInvocationAttribution(
        invocations[1]!,
        root,
        invocations,
        new Map(),
        new Map([["a1", "分析师"]]),
        "mgr",
      ),
    ).toBe("由群管理分配指定");
  });

  it("shows user @ attribution for direct mentions", () => {
    const invocations = [
      { id: "e1", message_id: "u1", target_id: "a1", intent: "execute", target_type: "agent" },
    ] as import("@multica/core/types/room").MentionInvocation[];
    expect(
      resolveInvocationAttribution(
        invocations[0]!,
        root,
        invocations,
        new Map(),
        new Map(),
        "mgr",
      ),
    ).toBe("用户 @指定");
  });
});
