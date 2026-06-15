"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { isTaskMessageTaskId, taskMessagesOptions } from "@multica/core/chat/queries";
import { UnicodeSpinner } from "@multica/ui/components/common/unicode-spinner";
import { cn } from "@multica/ui/lib/utils";
import { TaskStatusPill } from "../chat/components/task-status-pill";
import { RoomLiveStream } from "./room-live-stream";
import type { MentionInvocation } from "@multica/core/types/room";

type Props = {
  invocations: MentionInvocation[];
  agentNameById: Map<string, string>;
};

/** Single in-flight @mention indicator for the room (queued OR running, never both). */
export function RoomActivityFooter({ invocations, agentNameById }: Props) {
  const active = useMemo(() => pickActiveInvocation(invocations), [invocations]);

  if (!active) return null;

  const agentLabel = agentNameById.get(active.target_id) ?? active.target_type;

  if (active.status === "running" && active.task_id && isTaskMessageTaskId(active.task_id)) {
    return (
      <RunningFooter
        key={active.id}
        invocationId={active.id}
        taskId={active.task_id}
        createdAt={active.created_at}
        agentLabel={agentLabel}
      />
    );
  }

  if (active.status === "queued" || active.status === "pending") {
    return (
      <QueuedFooter
        key={active.id}
        invocationId={active.id}
        createdAt={active.created_at}
        agentLabel={agentLabel}
      />
    );
  }

  return null;
}

function pickActiveInvocation(invocations: MentionInvocation[]): MentionInvocation | null {
  const running = invocations.find(
    (i) => i.status === "running" && i.task_id && isTaskMessageTaskId(i.task_id),
  );
  if (running) return running;
  return (
    invocations.find((i) => i.status === "queued" || i.status === "pending") ?? null
  );
}

function RunningFooter({
  invocationId,
  taskId,
  createdAt,
  agentLabel,
}: {
  invocationId: string;
  taskId: string;
  createdAt?: string;
  agentLabel: string;
}) {
  const { data: taskMessages = [] } = useQuery({
    ...taskMessagesOptions(taskId),
    enabled: isTaskMessageTaskId(taskId),
  });

  return (
    <div className="space-y-1.5" data-invocation-id={invocationId}>
      <RoomLiveStream taskId={taskId} agentLabel={agentLabel} />
      <TaskStatusPill
        pendingTask={{
          task_id: taskId,
          status: "running",
          created_at: createdAt,
        }}
        taskMessages={taskMessages}
        availability={undefined}
      />
    </div>
  );
}

const waitAnchors = new Map<string, number>();

function waitAnchorMs(invocationId: string, createdAt?: string): number {
  const existing = waitAnchors.get(invocationId);
  if (existing !== undefined) return existing;
  const parsed = createdAt ? Date.parse(createdAt) : NaN;
  const anchor = Number.isFinite(parsed) ? parsed : Date.now();
  waitAnchors.set(invocationId, anchor);
  return anchor;
}

function QueuedFooter({
  invocationId,
  createdAt,
  agentLabel,
}: {
  invocationId: string;
  createdAt?: string;
  agentLabel: string;
}) {
  const anchor = waitAnchorMs(invocationId, createdAt);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedSecs = Math.max(0, Math.floor((now - anchor) / 1000));

  return (
    <div
      className="text-muted-foreground flex items-center gap-2 px-1 text-xs"
      data-invocation-id={invocationId}
      aria-live="polite"
    >
      <UnicodeSpinner name="breathe" className="opacity-70" />
      <span>
        <span className={cn("animate-chat-text-shimmer")}>
          {agentLabel} 排队中
        </span>
        <span className="opacity-70"> · {elapsedSecs}s</span>
      </span>
    </div>
  );
}
