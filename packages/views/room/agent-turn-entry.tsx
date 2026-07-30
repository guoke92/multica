"use client";

import { useQuery } from "@tanstack/react-query";
import { isTaskMessageTaskId, taskMessagesOptions } from "@multica/core/chat/queries";
import { Copy, RefreshCw, Reply, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { UnicodeSpinner } from "@multica/ui/components/common/unicode-spinner";
import type {
  RoomManagerDecision,
  RoomMessage,
  RoomMessageMention,
} from "@multica/core/types/room";
import { copyMarkdown } from "../editor";
import { AgentMessageBody } from "./agent-message-body";
import { ManagerStatusLeading } from "./manager-invocation-skin";
import { ManagerHistoryBelowBar } from "./room-invocation-thread";
import {
  ActionIconButton,
  MessageActionBar,
  MessageBubbleAnchor,
} from "./room-message-chrome";
import { RoomAttributionPill } from "./room-attribution-pill";
import { RoomLiveStream } from "./room-live-stream";
import { RoomParticipantAvatar } from "./room-participant-avatar";
import { RoomQuoteBlock } from "./room-quote-block";
import { useElapsedSeconds } from "./room-elapsed-timer";
import {
  pickLeadingManagerItem,
  type InvocationChatItem,
} from "./room-flow-utils";
import {
  extractRoomAgentCopyText,
  resolveAssignmentAttribution,
  truncatePreview,
} from "./room-utils";

const SOFT_WARN_SECONDS = 90;

function resolveMessageSenderName(
  message: RoomMessage,
  agentNameById: Map<string, string>,
  memberNameById: Map<string, string>,
): string {
  if (message.sender_type === "system") return "系统";
  if (!message.sender_id) return message.sender_type;
  if (message.sender_type === "agent") return agentNameById.get(message.sender_id) ?? "Agent";
  if (message.sender_type === "user") return memberNameById.get(message.sender_id) ?? "成员";
  return message.sender_type;
}

function resolveTurnQuoteContext(
  item: InvocationChatItem,
  messagesById: Map<string, RoomMessage>,
  agentNameById: Map<string, string>,
  memberNameById: Map<string, string>,
): {
  quotedSenderName?: string;
  quotedPreview?: string;
  quotedMessageId?: string;
} {
  const sourceMessage = messagesById.get(item.sourceMessageId);
  if (!sourceMessage) return {};
  return {
    quotedMessageId: sourceMessage.id,
    quotedSenderName: resolveMessageSenderName(
      sourceMessage,
      agentNameById,
      memberNameById,
    ),
    quotedPreview: truncatePreview(
      sourceMessage.sender_type === "agent"
        ? extractRoomAgentCopyText(sourceMessage)
        : sourceMessage.content,
    ),
  };
}

/**
 * Single renderer for a role-agent turn: queued/running stream → final message body.
 * Invocation owns the slot; room_message is only the succeeded payload.
 */
export function AgentTurnEntry({
  item,
  escalations = [],
  followUpManagerItems = [],
  agentNameById,
  memberNameById,
  mentions = [],
  messagesById,
  decisions = [],
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
  onReplyToMessage,
  onRegenerateAgentMessage,
  regeneratingMessageId,
  onNavigateToQuote,
}: {
  item: InvocationChatItem;
  escalations?: InvocationChatItem[];
  /** Manager runs after this turn's output (review, etc.). */
  followUpManagerItems?: InvocationChatItem[];
  agentNameById: Map<string, string>;
  memberNameById: Map<string, string>;
  mentions?: RoomMessageMention[];
  messagesById: Map<string, RoomMessage>;
  decisions?: RoomManagerDecision[];
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
  onReplyToMessage?: (message: RoomMessage, displayName: string) => void;
  onRegenerateAgentMessage?: (message: RoomMessage) => void;
  regeneratingMessageId?: string | null;
  onNavigateToQuote?: (messageId: string) => void;
}) {
  const { invocation, assignment, agentId, phase, outputMessage } = item;
  const agentName = agentNameById.get(agentId) ?? "Agent";
  const attribution = resolveAssignmentAttribution(assignment, mentions, agentId);
  const quote = resolveTurnQuoteContext(item, messagesById, agentNameById, memberNameById);
  const leadingEscalation = pickLeadingManagerItem(escalations, decisions);
  const leadingFollowUp = pickLeadingManagerItem(followUpManagerItems, decisions);
  const isComplete = phase === "succeeded" && !!outputMessage;

  const followUpLeading = leadingFollowUp ? (
    <ManagerStatusLeading
      item={leadingFollowUp}
      items={[leadingFollowUp]}
      agentNameById={agentNameById}
      decisions={decisions}
      onRetryAssignment={onRetryAssignment}
      onCancelAssignment={onCancelAssignment}
      retryingAssignmentId={retryingAssignmentId}
      cancellingAssignmentId={cancellingAssignmentId}
    />
  ) : undefined;

  return (
    <div
      className="group flex w-full flex-col gap-1"
      data-room-invocation-id={invocation.id}
      data-room-assignment-id={assignment.id}
      data-room-message-id={outputMessage?.id}
      data-room-message-block={outputMessage?.id}
    >
      <AgentTurnHeader
        item={item}
        agentName={agentName}
        attribution={attribution}
        isComplete={isComplete}
        onRetryAssignment={onRetryAssignment}
        onCancelAssignment={onCancelAssignment}
        retryingAssignmentId={retryingAssignmentId}
        cancellingAssignmentId={cancellingAssignmentId}
      />

      {quote.quotedSenderName && quote.quotedPreview ? (
        <RoomQuoteBlock
          senderName={quote.quotedSenderName}
          preview={quote.quotedPreview}
          quotedMessageId={quote.quotedMessageId}
          onNavigateToQuote={onNavigateToQuote}
        />
      ) : null}

      <MessageBubbleAnchor align="start">
        <div
          className={cn(
            "w-fit max-w-full rounded-2xl border px-3.5 py-2",
            phase === "failed"
              ? "border-destructive/30 bg-destructive/5"
              : phase === "cancelled"
                ? "bg-muted/50 border-border/40"
                : "bg-card border-border/60",
            !isComplete && phase !== "failed" && phase !== "cancelled" && "border-dashed",
          )}
        >
          {isComplete && outputMessage ? (
            <AgentMessageBody message={outputMessage} />
          ) : phase === "succeeded" ? (
            <WaitingBody label={`${agentName} 已完成`} elapsed={null} />
          ) : (
            <AgentTurnProgressBody item={item} agentName={agentName} />
          )}
        </div>

        {isComplete && outputMessage ? (
          <MessageActionBar leading={followUpLeading}>
            {onReplyToMessage ? (
              <ActionIconButton
                label="引用回复"
                onClick={() => onReplyToMessage(outputMessage, agentName)}
                icon={Reply}
              />
            ) : null}
            <AgentCopyButton message={outputMessage} />
            {onRegenerateAgentMessage ? (
              <ActionIconButton
                label="重新生成"
                onClick={() => onRegenerateAgentMessage(outputMessage)}
                disabled={regeneratingMessageId === outputMessage.id}
                icon={RefreshCw}
              />
            ) : null}
          </MessageActionBar>
        ) : null}
      </MessageBubbleAnchor>

      {isComplete && followUpManagerItems.length > 0 ? (
        <ManagerHistoryBelowBar
          items={followUpManagerItems}
          leadingInvocationId={leadingFollowUp?.invocation.id}
          agentNameById={agentNameById}
          onRetryAssignment={onRetryAssignment}
          onCancelAssignment={onCancelAssignment}
          retryingAssignmentId={retryingAssignmentId}
          cancellingAssignmentId={cancellingAssignmentId}
          align="start"
        />
      ) : null}

      {leadingEscalation ? (
        <div className="flex justify-start pl-7">
          <ManagerStatusLeading
            item={leadingEscalation}
            items={[leadingEscalation]}
            agentNameById={agentNameById}
            decisions={decisions}
            onRetryAssignment={onRetryAssignment}
            onCancelAssignment={onCancelAssignment}
            retryingAssignmentId={retryingAssignmentId}
            cancellingAssignmentId={cancellingAssignmentId}
          />
        </div>
      ) : null}
      {escalations.length > 0 ? (
        <ManagerHistoryBelowBar
          items={escalations}
          leadingInvocationId={leadingEscalation?.invocation.id}
          agentNameById={agentNameById}
          onRetryAssignment={onRetryAssignment}
          onCancelAssignment={onCancelAssignment}
          retryingAssignmentId={retryingAssignmentId}
          cancellingAssignmentId={cancellingAssignmentId}
          align="start"
        />
      ) : null}
    </div>
  );
}

function AgentTurnHeader({
  item,
  agentName,
  attribution,
  isComplete,
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
}: {
  item: InvocationChatItem;
  agentName: string;
  attribution?: string;
  isComplete: boolean;
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
}) {
  const { invocation, assignment, agentId, phase } = item;
  const elapsed = useElapsedSeconds(invocation.id, invocation.created_at);
  const isSoftWarn =
    (phase === "running" || phase === "queued") &&
    elapsed !== null &&
    elapsed >= SOFT_WARN_SECONDS;
  const skinTone =
    phase === "failed"
      ? "destructive"
      : phase === "cancelled"
        ? "muted"
        : isSoftWarn
          ? "warning"
          : "normal";
  const statusLabel =
    phase === "failed"
      ? "失败"
      : phase === "cancelled"
        ? "已取消"
        : phase === "queued"
          ? "排队中"
          : "思考中";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <RoomParticipantAvatar actorType="agent" actorId={agentId} size={28} showStatusDot />
      <span className="text-muted-foreground text-xs font-medium">{agentName}</span>
      {attribution ? <RoomAttributionPill text={attribution} /> : null}
      {!isComplete ? (
        <>
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[10px]",
              skinTone === "destructive" && "text-destructive",
              skinTone === "warning" && "text-amber-600 dark:text-amber-400",
              skinTone === "normal" && "text-muted-foreground/80",
            )}
          >
            {phase === "running" || phase === "queued" ? (
              <UnicodeSpinner name="breathe" className="size-3 opacity-70" />
            ) : null}
            <span className={cn(phase === "running" && "animate-chat-text-shimmer")}>
              {statusLabel}
            </span>
            {elapsed !== null && (phase === "running" || phase === "queued") ? (
              <span className="opacity-70 tabular-nums">· {elapsed}s</span>
            ) : null}
          </span>
          <TurnActionButtons
            assignmentId={assignment.id}
            phase={phase}
            onRetryAssignment={onRetryAssignment}
            onCancelAssignment={onCancelAssignment}
            retryingAssignmentId={retryingAssignmentId}
            cancellingAssignmentId={cancellingAssignmentId}
          />
        </>
      ) : null}
    </div>
  );
}

function AgentTurnProgressBody({
  item,
  agentName,
}: {
  item: InvocationChatItem;
  agentName: string;
}) {
  const { invocation, phase, failureReason } = item;
  const elapsed = useElapsedSeconds(invocation.id, invocation.created_at);
  const taskId = invocation.task_id;
  const canStream = phase !== "failed" && !!taskId && isTaskMessageTaskId(taskId);

  useQuery({
    ...taskMessagesOptions(taskId ?? ""),
    enabled: canStream,
  });

  if (phase === "failed") {
    const reason = failureReason?.trim();
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

  if (phase === "cancelled") {
    return <div className="text-muted-foreground text-sm">{agentName} 已取消</div>;
  }

  if (canStream) {
    return <RoomLiveStream taskId={taskId} />;
  }

  return <WaitingBody label={`${agentName} ${phase === "queued" ? "排队中" : "思考中"}`} elapsed={elapsed} />;
}

function TurnActionButtons({
  assignmentId,
  phase,
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
}: {
  assignmentId: string;
  phase: InvocationChatItem["phase"];
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
}) {
  const isRetrying = retryingAssignmentId === assignmentId;
  const isCancelling = cancellingAssignmentId === assignmentId;

  if ((phase === "failed" || phase === "cancelled") && onRetryAssignment) {
    return (
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="text-muted-foreground hover:text-foreground h-6 px-1.5 text-[11px]"
        disabled={isRetrying}
        onClick={() => onRetryAssignment(assignmentId)}
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
        onClick={() => onCancelAssignment(assignmentId)}
      >
        <Square className="mr-1 size-3" />
        {isCancelling ? "停止中…" : "停止"}
      </Button>
    );
  }

  return null;
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

function AgentCopyButton({ message }: { message: RoomMessage }) {
  const handleCopy = async () => {
    try {
      await copyMarkdown(extractRoomAgentCopyText(message));
      toast.success("已复制");
    } catch {
      toast.error("复制失败");
    }
  };
  return <ActionIconButton label="复制" onClick={handleCopy} icon={Copy} />;
}
