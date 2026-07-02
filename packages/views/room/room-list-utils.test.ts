import { describe, expect, it } from "vitest";
import {
  activityScore,
  buildRoomListSubtitle,
  resolveRoomMemberPreviews,
} from "./room-list-utils";

describe("buildRoomListSubtitle", () => {
  it("prioritizes @mention follow-ups", () => {
    expect(
      buildRoomListSubtitle({ mention_unread_count: 2 }),
    ).toMatchObject({
      tone: "mention",
      badgeCount: 2,
    });
  });

  it("shows failure attention before processing", () => {
    expect(
      buildRoomListSubtitle({
        failed_count: 1,
        running_count: 2,
      }),
    ).toMatchObject({
      text: "1 个失败待确认",
      tone: "danger",
      badgeCount: 1,
    });
  });

  it("shows manager processing state", () => {
    expect(
      buildRoomListSubtitle({ manager_active_count: 1 }),
    ).toMatchObject({
      text: "群管处理中",
      tone: "active",
    });
  });
});

describe("resolveRoomMemberPreviews", () => {
  it("builds up to four member tiles excluding manager from the main loop", () => {
    const previews = resolveRoomMemberPreviews(
      [
        { principal_type: "user", principal_id: "u1" },
        { principal_type: "agent", principal_id: "a1" },
        { principal_type: "agent", principal_id: "mgr" },
      ],
      new Map([["u1", "张三"]]),
      new Map([
        ["a1", "前端工程师"],
        ["mgr", "群管"],
      ]),
      "mgr",
    );
    expect(previews.map((p) => p.name)).toEqual(["张三", "前端工程师", "群管"]);
  });
});

describe("activityScore", () => {
  it("ranks mention unread above idle rooms", () => {
    expect(
      activityScore({ mention_unread_count: 1 }),
    ).toBeGreaterThan(activityScore({}));
  });
});
