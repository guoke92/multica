"use client";

import { useQuery } from "@tanstack/react-query";
import { isTaskMessageTaskId, taskMessagesOptions } from "@multica/core/chat/queries";
import type { RoomMessage } from "@multica/core/types/room";
import { buildTimeline, ProcessTimelineView } from "../common/task-transcript";
import { splitTimeline } from "../chat/lib/copy-text";
import {
  resolveRoomAgentChatSummary,
  roomAgentHasExpandableProcess,
} from "./room-utils";
import { Markdown } from "../common/markdown";

function parseMessageMetadata(meta: unknown): Record<string, string> {
  if (!meta || typeof meta !== "object") return {};
  const o = meta as Record<string, unknown>;
  const out: Record<string, string> = {};
  if (typeof o.task_id === "string") out.task_id = o.task_id;
  return out;
}

/** Final agent reply body — summary markdown plus optional expandable process. */
export function AgentMessageBody({ message }: { message: RoomMessage }) {
  const meta = parseMessageMetadata(message.metadata);
  const taskId = meta.task_id ?? null;

  const { data: taskMessages = [] } = useQuery({
    ...taskMessagesOptions(taskId ?? ""),
    enabled: !!taskId && isTaskMessageTaskId(taskId),
  });
  const timeline = buildTimeline(taskMessages);
  const { middle } = splitTimeline(timeline);
  const transcriptText = timeline
    .filter((i) => i.type === "text" || i.type === "thinking")
    .map((i) => i.content ?? "")
    .join("");

  const summary = resolveRoomAgentChatSummary(message, transcriptText);
  const expandable = roomAgentHasExpandableProcess(message, {
    transcriptText,
    processStepCount: middle.length,
  });

  return (
    <div className="space-y-1.5">
      <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <Markdown>{summary || "已完成"}</Markdown>
      </div>
      {expandable && middle.length > 0 ? (
        <ProcessTimelineView items={timeline} processOnly />
      ) : null}
    </div>
  );
}
