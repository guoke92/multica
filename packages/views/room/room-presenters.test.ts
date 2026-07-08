import { describe, expect, it } from "vitest";
import { buildManagerStatusText, deriveManagerScene } from "./room-presenters";

describe("deriveManagerScene", () => {
  it("maps route intent to 指派", () => {
    expect(deriveManagerScene({ intent: "route", assignmentKind: "auto_review" })).toBe(
      "指派",
    );
  });

  it("maps review intent to 审核", () => {
    expect(deriveManagerScene({ intent: "review", assignmentKind: "auto_review" })).toBe(
      "审核",
    );
  });

  it("defaults auto_review without intent to 指派", () => {
    expect(deriveManagerScene({ assignmentKind: "auto_review" })).toBe("指派");
  });

  it("infers 指派 from dispatch outcome", () => {
    expect(
      deriveManagerScene({
        assignmentKind: "auto_review",
        outcome: { type: "dispatch", target_agent_id: "fe" },
      }),
    ).toBe("指派");
  });

  it("maps relay assign decision to 转派", () => {
    expect(
      deriveManagerScene({
        decision: {
          id: "dec-1",
          room_id: "room-1",
          source_message_id: "msg-1",
          action: "assign",
          payload: { relay_to: "fe" },
        },
      }),
    ).toBe("转派");
  });
});

describe("buildManagerStatusText", () => {
  it("shows dispatch target for route assignment", () => {
    expect(
      buildManagerStatusText(
        "指派",
        "succeeded",
        { type: "dispatch", target_agent_id: "fe" },
        "前端工程师",
      ),
    ).toBe("指派·前端工程师");
  });

  it("shows thinking state", () => {
    expect(buildManagerStatusText("审核", "running", undefined)).toBe("审核·思考中");
  });

  it("shows review complete", () => {
    expect(
      buildManagerStatusText("审核", "succeeded", { type: "review_complete" }),
    ).toBe("审核·处理完成");
  });

  it("shows dispatch target when assign succeeded but outcome type is failed", () => {
    expect(
      buildManagerStatusText(
        "指派",
        "succeeded",
        { type: "failed", reason: "dispatch succeeded but mention creation failed" },
        "前端工程师",
        {
          id: "dec-1",
          room_id: "room-1",
          source_message_id: "msg-1",
          action: "assign",
          created_assignment_ids: ["a-fe"],
          payload: { route_to: "fe" },
        },
      ),
    ).toBe("指派·前端工程师");
  });
});
