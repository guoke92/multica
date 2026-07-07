import { describe, expect, it } from "vitest";
import { RoomGraphSnapshotSchema } from "./schemas";

describe("RoomGraphSnapshotSchema", () => {
  it("accepts API-shaped graph snapshot", () => {
    const sample = {
      messages: [
        {
          id: "019eda03-8bf5-7ccd-b320-b55cfb648c20",
          sender_type: "user",
          sender_id: "40ee67dc-bdaa-42a8-8f22-81d59b1ff5ab",
          content: "hello",
          metadata: { task_id: "3234508a-9aa5-4730-9143-3439b0443f42" },
          created_at: "2026-06-18T09:15:26.070058Z",
        },
      ],
      mentions: [],
      assignments: [
        {
          id: "019eda03-8bf9-7a6f-b500-415cf8c15272",
          room_id: "2788438f-5f31-4dad-ac02-010cac673cf4",
          source_message_id: "019eda03-8bf5-7ccd-b320-b55cfb648c20",
          assignee_type: "agent",
          assignee_id: "fa5763d7-00c1-4fbf-9d12-a94548a91a58",
          kind: "auto_review",
          status: "completed",
          created_at: "2026-06-18T09:15:26.073927Z",
          updated_at: "2026-06-18T09:15:53.000000Z",
        },
      ],
      assignment_dependencies: [],
      invocations: [
        {
          id: "019eda03-8bfe-72fd-bb37-34393e92cfde",
          room_id: "2788438f-5f31-4dad-ac02-010cac673cf4",
          assignment_id: "019eda03-8bf9-7a6f-b500-415cf8c15272",
          source_message_id: "019eda03-8bf5-7ccd-b320-b55cfb648c20",
          agent_id: "fa5763d7-00c1-4fbf-9d12-a94548a91a58",
          intent: "review",
          status: "succeeded",
          task_id: "53730721-5d23-411c-9598-43a597003d53",
        },
      ],
      decisions: [
        {
          id: "dec-1",
          room_id: "2788438f-5f31-4dad-ac02-010cac673cf4",
          source_message_id: "019eda03-8bf5-7ccd-b320-b55cfb648c20",
          action: "route",
          payload: { target_agent_id: "0828e924-544c-4ec2-9fa8-d6df81ccb61c" },
          created_assignment_ids: ["019eda03-f76e-7cc9-8f9f-685ab85c51e3"],
        },
      ],
      invocation_events: [
        {
          id: "evt-1",
          room_id: "2788438f-5f31-4dad-ac02-010cac673cf4",
          assignment_id: "019eda03-8bf9-7a6f-b500-415cf8c15272",
          type: "assignment_created",
          actor_type: "system",
          payload: { kind: "auto_review", status: "pending" },
          created_at: "2026-06-18T09:15:26.073927Z",
        },
      ],
    };
    const result = RoomGraphSnapshotSchema.safeParse(sample);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues, null, 2)).toBe(
      true,
    );
  });

  it("preserves invocation outcome from API", () => {
    const raw = {
      messages: [],
      mentions: [],
      assignments: [],
      assignment_dependencies: [],
      invocations: [
        {
          id: "inv-1",
          assignment_id: "asgn-1",
          source_message_id: "msg-1",
          agent_id: "mgr-1",
          status: "succeeded",
          outcome: { type: "dispatch", target_agent_id: "agent-fe" },
        },
      ],
      decisions: [],
      invocation_events: [],
    };
    const result = RoomGraphSnapshotSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invocations[0]?.outcome).toEqual({
        type: "dispatch",
        target_agent_id: "agent-fe",
      });
    }
  });

  it("accepts null invocation outcome from API", () => {
    const raw = {
      messages: [],
      mentions: [],
      assignments: [],
      assignment_dependencies: [],
      invocations: [
        {
          id: "inv-1",
          assignment_id: "asgn-1",
          source_message_id: "msg-1",
          agent_id: "agent-1",
          status: "running",
          outcome: null,
        },
      ],
      decisions: [],
      invocation_events: [],
    };
    const result = RoomGraphSnapshotSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invocations[0]?.outcome).toBeUndefined();
    }
  });

  it("accepts invocation outcome missing type", () => {
    const raw = {
      messages: [],
      mentions: [],
      assignments: [],
      assignment_dependencies: [],
      invocations: [
        {
          id: "inv-1",
          assignment_id: "asgn-1",
          source_message_id: "msg-1",
          agent_id: "agent-1",
          status: "succeeded",
          outcome: { target_agent_id: "agent-fe", reason: "legacy row" },
        },
      ],
      decisions: [],
      invocation_events: [],
    };
    const result = RoomGraphSnapshotSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invocations[0]?.outcome?.type).toBe("unknown");
    }
  });

  it("accepts invocation events with null payload", () => {
    const raw = {
      messages: [],
      mentions: [],
      assignments: [],
      assignment_dependencies: [],
      invocations: [],
      decisions: [],
      invocation_events: [
        {
          id: "evt-1",
          type: "assignment_created",
          actor_type: "system",
          payload: null,
        },
      ],
    };
    const result = RoomGraphSnapshotSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invocation_events[0]?.payload).toEqual({});
    }
  });

  it("rejects raw DB byte payloads (base64 strings)", () => {
    const rawDbShape = {
      messages: [],
      mentions: [],
      assignments: [
        {
          id: "019eda03-8bf9-7a6f-b500-415cf8c15272",
          room_id: { Bytes: "abc", Valid: true },
          source_message_id: "019eda03-8bf5-7ccd-b320-b55cfb648c20",
          assignee_type: "agent",
          assignee_id: "fa5763d7-00c1-4fbf-9d12-a94548a91a58",
          kind: "auto_review",
          status: "completed",
        },
      ],
      assignment_dependencies: [],
      invocations: [],
      decisions: [],
      invocation_events: [
        {
          id: "evt-1",
          room_id: "2788438f-5f31-4dad-ac02-010cac673cf4",
          assignment_id: "019eda03-8bf9-7a6f-b500-415cf8c15272",
          type: "assignment_created",
          actor_type: "system",
          payload: "eyJraW5kIjoiYXV0b19yZXZpZXcifQ==",
          created_at: "2026-06-18T09:15:26.073927Z",
        },
      ],
    };
    const result = RoomGraphSnapshotSchema.safeParse(rawDbShape);
    expect(result.success).toBe(false);
  });
});
