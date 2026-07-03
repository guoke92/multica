"use client";

import { isTaskMessageTaskId, taskMessagesOptions } from "@multica/core/chat/queries";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Square } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { UnicodeSpinner } from "@multica/ui/components/common/unicode-spinner";
import type { InvocationChatItem } from "./room-flow-utils";
import { useElapsedSeconds } from "./room-elapsed-timer";
import { RoomParticipantAvatar } from "./room-participant-avatar";
import { RoomLiveStream } from "./room-live-stream";

const SOFT_WARN_SECONDS = 90;

type Props = {
  item: InvocationChatItem;
  agentNameById: Map<string, string>;
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
};

export function RoleAgentInvocationSkin({
  item,
  agentNameById,
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
}: Props) {
  const { invocation, assignment, agentId, phase } = item;
  const agentName = agentNameById.get(agentId) ?? "Agent";
  const elapsed = useElapsedSeconds(invocation.id, invocation.created_at);
  const isSoftWarn =
    (phase === "running" || phase === "queued") && elapsed !== null && elapsed >= SOFT_WARN_SECONDS;

  const taskId = invocation.task_id;
  const canStream = phase !== "failed" && !!taskId && isTaskMessageTaskId(taskId);

  useQuery({
    ...taskMessagesOptions(taskId ?? ""),
    enabled: canStream,
  });

  const skinTone =
    phase === "failed" ? "destructive" : phase === "cancelled" ? "muted" : isSoftWarn ? "warning" : "normal";
  const statusLabel =
    phase === "failed"
      ? "失败"
      : phase === "cancelled"
        ? "已取消"
        : phase === "queued"
          ? "排队中"
          : "思考中";

  return (
    <div
      className="group w-full space-y-1"
      data-invocation-id={invocation.id}
      data-assignment-id={assignment.id}
      data-role-agent-invocation
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <RoomParticipantAvatar actorType="agent" actorId={agentId} size={20} showStatusDot />
        <span className="text-muted-foreground text-xs font-medium">{agentName}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px]",
            skinTone === "destructive" && "text-destructive",
            skinTone === "warning" && "text-amber-600 dark:text-amber-400",
            skinTone === "normal" && "text-muted-foreground/80"
          )}
        >
          {phase === "running" || phase === "queued" ? (
            <UnicodeSpinner name="breathe" className="size-3 opacity-70" />
          ) : null}
          <span className={cn(phase === "running" && "animate-chat-text-shimmer")}>{statusLabel}</span>
          {elapsed !== null && (phase === "running" || phase === "queued") ? (
            <span className="opacity-70 tabular-nums">· {elapsed}s</span>
          ) : null}
        </span>
        <InvocationActionButtons
          item={item}
          agentNameById={agentNameById}
          onRetryAssignment={onRetryAssignment}
          onCancelAssignment={onCancelAssignment}
          retryingAssignmentId={retryingAssignmentId}
          cancellingAssignmentId={cancellingAssignmentId}
        />
      </div>

      <div
        className={cn(
          "rounded-xl border px-3 py-1.5",
          phase === "failed"
            ? "border-destructive/30 bg-destructive/5"
            : phase === "cancelled"
              ? "bg-muted/50 border-border/40"
              : "bg-card border-border/60 border-dashed"
        )}
      >
        {phase === "failed" ? (
          <FailedBody item={item} />
        ) : phase === "cancelled" ? (
          <CancelledBody agentName={agentName} />
        ) : canStream ? (
          <RoomLiveStream taskId={taskId} />
        ) : phase === "queued" ? (
          <WaitingBody label={`${agentName} 排队中`} elapsed={elapsed} />
        ) : invocation.status === "succeeded" ? (
          <SucceededBody />
        ) : (
          <WaitingBody label={`${agentName} 思考中`} elapsed={elapsed} />
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
}: Props) {
  const { assignment, phase } = item;
  const isRetrying = retryingAssignmentId === assignment.id;
  const isCancelling = cancellingAssignmentId === assignment.id;

  if ((phase === "failed" || phase === "cancelled") && onRetryAssignment) {
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

function CancelledBody({ agentName }: { agentName: string }) {
  return (
    <div className="text-muted-foreground text-sm">
      {agentName} 已取消
    </div>
  );
}

function WaitingBody({ label, elapsed }: { label: string; elapsed: number | null }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-sm">
      <UnicodeSpinner name="breathe" className="opacity-70" />
      <span className="animate-chat-text-shimmer">
        {label}
        {elapsed !== null ? ` · ${elapsed}s` : ""}
      </span>
    </div>
  );
}

function SucceededBody() {
  return null;
}
