"use client";

import { useEffect, useMemo, useState } from "react";
import { isTaskMessageTaskId } from "@multica/core/chat/queries";
import type { InvocationChatItem } from "./room-flow-utils";
import { UnicodeSpinner } from "@multica/ui/components/common/unicode-spinner";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { RoomParticipantAvatar } from "./room-participant-avatar";
import { RoomLiveStream } from "./room-live-stream";
import { RefreshCw, Square } from "lucide-react";

type ActionProps = {
  item: InvocationChatItem;
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
};

type Props = ActionProps;

export function RoomInvocationChatItem({
  item,
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
}: Props) {
  return (
    <AgentInvocationBubble
      item={item}
      onRetryAssignment={onRetryAssignment}
      onCancelAssignment={onCancelAssignment}
      retryingAssignmentId={retryingAssignmentId}
      cancellingAssignmentId={cancellingAssignmentId}
    />
  );
}

/** Inline manager status — sits in the message action row, before copy/reply tools. */
export function ManagerStatusInline({ item }: { item: InvocationChatItem }) {
  const elapsed = useElapsedSeconds(item.invocation.id, item.invocation.created_at);
  const label = item.phase === "queued" ? "排队中" : item.phase === "failed" ? "失败" : "思考中";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px]",
        item.phase === "failed" ? "text-destructive" : "text-muted-foreground",
      )}
      data-invocation-id={item.invocation.id}
      data-assignment-id={item.assignment.id}
      aria-live="polite"
      aria-busy={item.phase !== "failed"}
    >
      {item.phase !== "failed" ? (
        <UnicodeSpinner name="breathe" className="size-3 opacity-70" />
      ) : null}
      <span className={cn(item.phase === "running" && "animate-chat-text-shimmer")}>
        群管 {label}
      </span>
      {elapsed !== null && item.phase !== "failed" ? (
        <span className="opacity-70 tabular-nums">· {elapsed}s</span>
      ) : null}
    </span>
  );
}

function AgentInvocationBubble({
  item,
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
}: Props) {
  const { invocation, assignment, agentId, agentName, phase } = item;
  const taskId = invocation.task_id;
  const canStream =
    phase === "running" && !!taskId && isTaskMessageTaskId(taskId);
  const elapsed = useElapsedSeconds(invocation.id, invocation.created_at);

  return (
    <div
      className="group w-full space-y-1.5"
      data-invocation-id={invocation.id}
      data-assignment-id={assignment.id}
      aria-live="polite"
      aria-busy={phase !== "failed"}
    >
      <div className="flex flex-wrap items-center gap-2">
        <RoomParticipantAvatar actorType="agent" actorId={agentId} size={24} showStatusDot />
        <span className="text-muted-foreground text-xs font-medium">{agentName}</span>
        <PhaseBadge phase={phase} elapsed={elapsed} />
        <InvocationActionButtons
          item={item}
          onRetryAssignment={onRetryAssignment}
          onCancelAssignment={onCancelAssignment}
          retryingAssignmentId={retryingAssignmentId}
          cancellingAssignmentId={cancellingAssignmentId}
        />
      </div>
      <div
        className={cn(
          "rounded-2xl border px-3.5 py-2",
          phase === "failed"
            ? "border-destructive/30 bg-destructive/5"
            : "bg-card border-border/60 border-dashed",
        )}
      >
        {phase === "failed" ? (
          <FailedBody item={item} />
        ) : canStream ? (
          <RoomLiveStream taskId={taskId} />
        ) : (
          <WaitingBody agentName={agentName} phase={phase} elapsed={elapsed} />
        )}
      </div>
    </div>
  );
}

function InvocationActionButtons({
  item,
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
}: ActionProps) {
  const { assignment, phase } = item;
  const isRetrying = retryingAssignmentId === assignment.id;
  const isCancelling = cancellingAssignmentId === assignment.id;

  if (phase === "failed" && onRetryAssignment) {
    return (
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="text-muted-foreground hover:text-foreground h-6 px-1.5 text-[11px]"
        disabled={isRetrying}
        onClick={() => onRetryAssignment(assignment.id)}
      >
        <RefreshCw className={cn("mr-1 size-3", isRetrying && "animate-spin")} />
        {isRetrying ? "重试中…" : "重试"}
      </Button>
    );
  }

  if ((phase === "running" || phase === "queued") && onCancelAssignment) {
    return (
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="text-muted-foreground hover:text-foreground h-6 px-1.5 text-[11px]"
        disabled={isCancelling}
        onClick={() => onCancelAssignment(assignment.id)}
      >
        <Square className="mr-1 size-3" />
        {isCancelling ? "停止中…" : "停止"}
      </Button>
    );
  }

  return null;
}

function PhaseBadge({
  phase,
  elapsed,
}: {
  phase: InvocationChatItem["phase"];
  elapsed: number | null;
}) {
  const label =
    phase === "failed" ? "失败" : phase === "queued" ? "排队中" : "思考中";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px]",
        phase === "failed" ? "text-destructive" : "text-muted-foreground/80",
      )}
    >
      {phase !== "failed" ? (
        <UnicodeSpinner name="breathe" className="size-3 opacity-70" />
      ) : null}
      <span className={cn(phase === "running" && "animate-chat-text-shimmer")}>{label}</span>
      {elapsed !== null && phase !== "failed" ? (
        <span className="opacity-70 tabular-nums">· {elapsed}s</span>
      ) : null}
    </span>
  );
}

function FailedBody({ item }: { item: InvocationChatItem }) {
  const reason = item.failureReason?.trim();
  return (
    <div className="text-sm">
      <p className="text-destructive font-medium">处理失败</p>
      {reason ? (
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{reason}</p>
      ) : (
        <p className="text-muted-foreground mt-1 text-xs">任务未能完成，可点击重试。</p>
      )}
    </div>
  );
}

function WaitingBody({
  agentName,
  phase,
  elapsed,
}: {
  agentName: string;
  phase: InvocationChatItem["phase"];
  elapsed: number | null;
}) {
  const label = phase === "queued" ? "排队中" : "思考中";

  return (
    <div className="text-muted-foreground flex items-center gap-2 text-sm">
      <UnicodeSpinner name="breathe" className="opacity-70" />
      <span className={cn(phase === "running" && "animate-chat-text-shimmer")}>
        {agentName} {label}
        {elapsed !== null ? ` · ${elapsed}s` : ""}
      </span>
    </div>
  );
}

const waitAnchors = new Map<string, number>();

function waitAnchorMs(key: string, createdAt?: string): number {
  const existing = waitAnchors.get(key);
  if (existing !== undefined) return existing;
  const parsed = createdAt ? Date.parse(createdAt) : NaN;
  const anchor = Number.isFinite(parsed) ? parsed : Date.now();
  waitAnchors.set(key, anchor);
  return anchor;
}

function useElapsedSeconds(anchorKey: string, createdAt?: string): number | null {
  const anchor = useMemo(
    () => waitAnchorMs(anchorKey, createdAt),
    [anchorKey, createdAt],
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!createdAt) return null;
  return Math.max(0, Math.floor((now - anchor) / 1000));
}
