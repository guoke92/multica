import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoomDeliveryCard } from "./room-delivery-card";
import type { RoomMessage } from "@multica/core/types/room";

describe("RoomDeliveryCard", () => {
  it("renders checklist from card metadata", () => {
    const message: RoomMessage = {
      id: "m1",
      sender_type: "system",
      content: "贪吃蛇游戏",
      message_kind: "card",
      metadata: {
        status: "in_progress",
        current_phase: "requirement",
        checklist: [
          { phase_key: "requirement", title: "需求分析", status: "in_progress" },
          { phase_key: "development", title: "开发", status: "pending" },
        ],
      },
      created_at: new Date().toISOString(),
    };
    render(<RoomDeliveryCard message={message} />);
    expect(screen.getByText("贪吃蛇游戏")).toBeInTheDocument();
    expect(screen.getByText("需求分析")).toBeInTheDocument();
    expect(screen.getAllByText("in_progress").length).toBeGreaterThan(0);
  });
});
