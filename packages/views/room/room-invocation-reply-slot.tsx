"use client";

import { useState, useEffect } from "react";
import { UnicodeSpinner } from "@multica/ui/components/common/unicode-spinner";
import { Button } from "@multica/ui/components/ui/button";
import { Badge } from "@multica/ui/components/ui/badge";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { RoomLiveStream } from "./room-live-stream";
import {
  RoomAgentReplyActions,
  RoomAgentReplyBody,
} from "./room-agent-reply-body";
import type { MentionInvocation, RoomMessage } from "@multica/core/types/room";

const ACTIVE_STATUSES = new Set([
  "pending",
  "queued",
  "running",
  "delivered",
]);

const TERMINAL_STATUSES = new Set([
  "cancelled",
  "failed",
  "timed_out",
  "paused",
]);

const RETRYABLE_STATUSES = new Set(["cancelled", "failed", "timed_out"]);

const CANCELLABLE_STATUSES = new Set([
  "pending",
  "queued",
  "delivered",
  "running",
]);

type Props = {
  invocation: MentionInvocation;
  responseMessage?: RoomMessage;
  agentNameById: Map<string, string>;
  squadNameById?: Map<string, string>;
  onCancel?: (invocationId: string) => void;
  onRetry?: (invocationId: string) => void;
  onResume?: (invocationId: string) => void;
  onRegenerate?: (message: RoomMessage) => void;
  onReplyToMessage?: (message: RoomMessage, displayName: string) => void;
  isCancelling?: boolean;
  isRetrying?: boolean;
  isResuming?: boolean;
  isRegenerating?: boolean;
};

/** Agent reply column: in-flight stream, queue placeholder, terminal, or succeeded body. */
export function RoomInvocationReplySlot({
  invocation: inv,
  responseMessage,
  agentNameById,
  squadNameById,
  onCancel,
  onRetry,
  onResume,
  onRegenerate,
  onReplyToMessage,
  isCancelling,
  isRetrying,
  isResuming,
  isRegenerating,
}: Props) {
  const isSucceeded = inv.status === "succeeded";
  const isActive = ACTIVE_STATUSES.has(inv.status);
  const isTerminal = TERMINAL_STATUSES.has(inv.status);
  if (!isSucceeded && !isActive && !isTerminal) return null;

  const actorType =
    inv.target_type === "squad" ? "squad" : ("agent" as const);
  const actorId = inv.target_id;
  const agentLabel =
    inv.target_type === "squad"
      ? (squadNameById?.get(inv.target_id) ?? "Squad")
      : (agentNameById.get(inv.target_id) ?? "Agent");

  const canCancel = isActive && CANCELLABLE_STATUSES.has(inv.status) && !!onCancel;
  const canRetry =
    isTerminal && RETRYABLE_STATUSES.has(inv.status) && !!onRetry;
  const canResume =
    inv.status === "paused" && !!onResume;
  const cancelLabel =
    inv.status === "running" ? "停止" : "取消排队";

  const isRunning =
    inv.status === "running" &&
    !!inv.task_id;

  return (
    <div
      className="group/slot flex w-full max-w-[90%] items-start gap-2"
      data-invocation-id={inv.id}
    >
      <ActorAvatar
        actorType={actorType}
        actorId={actorId}
        size={24}
        showStatusDot={actorType === "agent" && isActive}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground text-xs font-medium">
            {agentLabel}
          </span>
          {isTerminal ? (
            <InvocationStatusBadge status={inv.status} />
          ) : null}
          {canCancel ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground h-6 px-2 text-xs"
              disabled={isCancelling}
              onClick={() => onCancel(inv.id)}
            >
              {isCancelling ? "停止中…" : cancelLabel}
            </Button>
          ) : null}
          {canRetry ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground h-6 px-2 text-xs"
              disabled={isRetrying}
              onClick={() => onRetry(inv.id)}
            >
              {isRetrying ? "重试中…" : "重试"}
            </Button>
          ) : null}
          {canResume ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground h-6 px-2 text-xs"
              disabled={isResuming}
              onClick={() => onResume(inv.id)}
            >
              {isResuming ? "恢复中…" : "▶ 恢复"}
            </Button>
          ) : null}
          {isSucceeded && responseMessage ? (
            <RoomAgentReplyActions
              message={responseMessage}
              onReply={
                onReplyToMessage
                  ? () => onReplyToMessage(responseMessage, agentLabel)
                  : undefined
              }
              onRegenerate={
                onRegenerate ? () => onRegenerate(responseMessage) : undefined
              }
              isRegenerating={isRegenerating}
            />
          ) : null}
        </div>

        {isSucceeded && responseMessage ? (
          <RoomAgentReplyBody message={responseMessage} />
        ) : isSucceeded ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <UnicodeSpinner name="breathe" className="opacity-70" />
            <span>加载回答…</span>
          </div>
        ) : isTerminal ? (
          <TerminalBody status={inv.status} />
        ) : isRunning && inv.task_id ? (
          <div className="space-y-1.5">
            <div
              className="text-muted-foreground flex items-center gap-2 text-sm"
              aria-live="polite"
            >
              <UnicodeSpinner name="breathe" className="opacity-70" />
              <span className={cn("animate-chat-text-shimmer")}>思考中</span>
            </div>
            <RunningBody taskId={inv.task_id} />
          </div>
        ) : (
          <QueuedBody
            invocationId={inv.id}
            createdAt={inv.created_at}
          />
        )}
      </div>
    </div>
  );
}

function InvocationStatusBadge({ status }: { status: string }) {
  const label = terminalLabel(status);
  const variant =
    status === "cancelled"
      ? "secondary"
      : status === "paused"
        ? "outline"
        : "destructive";

  return (
    <Badge variant={variant} className="h-4 px-1.5 text-[10px]">
      {label}
    </Badge>
  );
}

function terminalLabel(status: string): string {
  switch (status) {
    case "cancelled":
      return "已取消排队";
    case "failed":
      return "回答失败";
    case "timed_out":
      return "已超时";
    case "paused":
      return "已暂停";
    default:
      return status;
  }
}

function TerminalBody({ status }: { status: string }) {
  const hint =
    status === "cancelled"
      ? "已取消排队，Agent 不会继续回答本条 @ 请求。"
      : status === "failed"
        ? "Agent 未能完成回答。"
        : status === "timed_out"
          ? "等待时间过长，任务已超时。"
          : status === "paused"
            ? "链式调用深度已达上限，需管理员手动恢复。"
            : null;

  if (!hint) return null;

  return (
    <div className="bg-muted/30 text-muted-foreground rounded-2xl px-3.5 py-2 text-sm">
      {hint}
    </div>
  );
}

function RunningBody({ taskId }: { taskId: string }) {
  return <RoomLiveStream taskId={taskId} />;
}

const waitAnchors = new Map<string, number>();

/** Clean up completed invocation anchors to prevent memory leak. */
export function cleanupWaitAnchors(invocationIds: string[]): void {
  for (const id of invocationIds) waitAnchors.delete(id);
}

function waitAnchorMs(invocationId: string, createdAt?: string): number {
  const existing = waitAnchors.get(invocationId);
  if (existing !== undefined) return existing;
  const parsed = createdAt ? Date.parse(createdAt) : NaN;
  const anchor = Number.isFinite(parsed) ? parsed : Date.now();
  waitAnchors.set(invocationId, anchor);
  return anchor;
}

function QueuedBody({
  invocationId,
  createdAt,
}: {
  invocationId: string;
  createdAt?: string;
}) {
  const anchor = waitAnchorMs(invocationId, createdAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedSecs = Math.max(0, Math.floor((now - anchor) / 1000));
  const statusText = "思考中";

  return (
    <div
      className="text-muted-foreground flex items-center gap-2 text-sm"
      aria-live="polite"
    >
      <UnicodeSpinner name="breathe" className="opacity-70" />
      <span>
        <span className={cn("animate-chat-text-shimmer")}>{statusText}</span>
        <span className="opacity-70"> · {elapsedSecs}s</span>
      </span>
    </div>
  );
}
