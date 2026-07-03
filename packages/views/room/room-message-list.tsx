"use client";

import { useMemo, useRef, type ReactNode, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade";
import { useAutoScroll } from "@multica/ui/hooks/use-auto-scroll";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@multica/ui/components/ui/tooltip";
import { isTaskMessageTaskId, taskMessagesOptions } from "@multica/core/chat/queries";
import { RoomParticipantAvatar } from "./room-participant-avatar";
import { buildTimeline, ProcessTimelineView } from "../common/task-transcript";
import { splitTimeline } from "../chat/lib/copy-text";
import { copyMarkdown } from "../editor";
import { Markdown } from "../common/markdown";
import { shouldHideRoomMessage } from "./room-message-visibility";
import type { RoomMessage, RoomInvocation, RoomAssignment, RoomMessageMention } from "@multica/core/types/room";
import { useAuthStore } from "@multica/core/auth";
import { Copy, Pencil, RefreshCw, Reply } from "lucide-react";
import {
  extractRoomAgentCopyText,
  resolveAgentMessageAttribution,
  resolveRoomAgentChatSummary,
  roomAgentHasExpandableProcess,
  truncatePreview,
} from "./room-utils";
import { RoomAttributionPill } from "./room-attribution-pill";
import { RoomActivityFooter } from "./room-activity-footer";
import { ManagerStatusLeading } from "./manager-invocation-skin";
import {
  invocationItemsForMessage,
  ManagerHistoryBelowBar,
  RoleAgentInvocationSlots,
} from "./room-invocation-thread";

function isOptimisticMessageId(id: string): boolean {
  return id.startsWith("optimistic-");
}

function parseMessageMetadata(meta: unknown): Record<string, string> {
  if (!meta || typeof meta !== "object") return {};
  const o = meta as Record<string, unknown>;
  const out: Record<string, string> = {};
  if (typeof o.approval_id === "string") out.approval_id = o.approval_id;
  if (typeof o.human_action_id === "string") out.human_action_id = o.human_action_id;
  if (typeof o.action_type === "string") out.action_type = o.action_type;
  if (typeof o.task_id === "string") out.task_id = o.task_id;
  if (typeof o.invocation_id === "string") out.invocation_id = o.invocation_id;
  if (typeof o.assignment_id === "string") out.assignment_id = o.assignment_id;
  return out;
}

type Props = {
  messages: RoomMessage[];
  roomId: string;
  managerAgentId?: string;
  assignments?: RoomAssignment[];
  invocations?: RoomInvocation[];
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
  onEditMessage?: (message: RoomMessage) => void;
  onReplyToMessage?: (message: RoomMessage, displayName: string) => void;
  onRegenerateAgentMessage?: (message: RoomMessage) => void;
  regeneratingMessageId?: string | null;
  hasOlderMessages?: boolean;
  isLoadingOlderMessages?: boolean;
  onLoadOlderMessages?: () => void;
  agentNameById: Map<string, string>;
  memberNameById: Map<string, string>;
  mentions?: RoomMessageMention[];
  scrollToMessageId?: string | null;
  onScrollToMessageDone?: () => void;
  onNavigateToQuote?: (messageId: string) => void;
};

export function RoomMessageList({
  messages,
  roomId,
  managerAgentId,
  assignments = [],
  invocations = [],
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
  onEditMessage,
  onReplyToMessage,
  onRegenerateAgentMessage,
  regeneratingMessageId,
  hasOlderMessages,
  isLoadingOlderMessages,
  onLoadOlderMessages,
  agentNameById,
  memberNameById,
  mentions = [],
  scrollToMessageId,
  onScrollToMessageDone,
  onNavigateToQuote,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fadeStyle = useScrollFade(scrollRef);
  const { scrollToBottom } = useAutoScroll(scrollRef);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const messagesById = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages],
  );

  const visibleMessages = useMemo(
    () => messages.filter((m) => !shouldHideRoomMessage(m, managerAgentId)),
    [messages, managerAgentId],
  );

  const lastSelfOptimisticId = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      const m = visibleMessages[i]!;
      if (
        m.id.startsWith("optimistic-") &&
        m.sender_type === "user" &&
        m.sender_id === currentUserId
      ) {
        return m.id;
      }
    }
    return null;
  }, [visibleMessages, currentUserId]);

  useEffect(() => {
    if (!lastSelfOptimisticId) return;
    scrollToBottom(true);
    const frame = requestAnimationFrame(() => scrollToBottom(true));
    return () => cancelAnimationFrame(frame);
  }, [lastSelfOptimisticId, scrollToBottom]);

  const activeStreamTaskId = useMemo(() => {
    const running = invocations
      .filter(
        (inv) =>
          inv.status === "running" || inv.status === "queued" || inv.status === "pending",
      )
      .filter((inv) => inv.task_id && isTaskMessageTaskId(inv.task_id))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const latest = running[running.length - 1];
    return latest?.task_id ?? null;
  }, [invocations]);

  const { data: activeStreamMessages = [] } = useQuery({
    ...taskMessagesOptions(activeStreamTaskId ?? ""),
    enabled: !!activeStreamTaskId,
  });

  const chatTailKey = useMemo(() => {
    const lastMessage = visibleMessages[visibleMessages.length - 1];
    const lastTaskId = activeStreamTaskId;
    const streamLen = lastTaskId ? activeStreamMessages.length : 0;
    const lastSeq = lastTaskId
      ? (activeStreamMessages[activeStreamMessages.length - 1]?.seq ?? 0)
      : 0;
    if (!lastMessage) return "";
    return `msg:${lastMessage.id}:${lastMessage.content.length}:stream:${streamLen}:${lastSeq}`;
  }, [visibleMessages, activeStreamTaskId, activeStreamMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [chatTailKey, scrollToBottom]);

  useEffect(() => {
    if (!scrollToMessageId) return;
    const frame = requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root) return;
      const target = root.querySelector(
        `[data-room-message-id="${scrollToMessageId}"]`,
      );
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      onScrollToMessageDone?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollToMessageId, onScrollToMessageDone]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        data-tab-scroll-root
        style={fadeStyle}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl space-y-2.5 px-5 py-3">
          {hasOlderMessages ? (
            <div className="flex justify-center pb-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground text-xs"
                disabled={isLoadingOlderMessages}
                onClick={onLoadOlderMessages}
              >
                {isLoadingOlderMessages ? "加载中…" : "加载更早消息"}
              </Button>
            </div>
          ) : null}
          {visibleMessages.map((m) => {
            const isSelf =
              m.sender_type === "user" && m.sender_id === currentUserId;
            const displayName = resolveSenderName(m, agentNameById, memberNameById);
            const quoted = m.quote_message_id
              ? messagesById.get(m.quote_message_id)
              : undefined;
            const canEdit =
              isSelf &&
              onEditMessage &&
              !isOptimisticMessageId(m.id);

            return (
              <RoomMessageRow
                key={m.id}
                message={m}
                isSelf={isSelf}
                displayName={displayName}
                roomId={roomId}
                quotedMessage={quoted}
                quotedSenderName={
                  quoted
                    ? resolveSenderName(quoted, agentNameById, memberNameById)
                    : undefined
                }
                assignments={assignments}
                mentions={mentions}
                timelineMessages={visibleMessages}
                invocations={invocations}
                managerAgentId={managerAgentId}
                agentNameById={agentNameById}
                onRetryAssignment={onRetryAssignment}
                onCancelAssignment={onCancelAssignment}
                retryingAssignmentId={retryingAssignmentId}
                cancellingAssignmentId={cancellingAssignmentId}
                onEdit={canEdit ? () => onEditMessage(m) : undefined}
                onReply={
                  m.sender_type !== "system" && onReplyToMessage
                    ? () => onReplyToMessage(m, displayName)
                    : undefined
                }
                onRegenerate={
                  m.sender_type === "agent" && onRegenerateAgentMessage
                    ? () => onRegenerateAgentMessage(m)
                    : undefined
                }
                isRegenerating={regeneratingMessageId === m.id}
                onNavigateToQuote={onNavigateToQuote}
              />
            );
          })}
        </div>
      </div>
      <RoomActivityFooter
        invocations={invocations}
        agentNameById={agentNameById}
        onRetryAssignment={onRetryAssignment}
        retryingAssignmentId={retryingAssignmentId}
      />
    </div>
  );
}

function resolveSenderName(
  m: RoomMessage,
  agents: Map<string, string>,
  members: Map<string, string>,
): string {
  if (m.sender_type === "system") return "系统";
  if (!m.sender_id) return m.sender_type;
  if (m.sender_type === "agent") return agents.get(m.sender_id) ?? "Agent";
  if (m.sender_type === "user") return members.get(m.sender_id) ?? "成员";
  return m.sender_type;
}

function QuoteBlock({
  senderName,
  preview,
  align = "start",
  quotedMessageId,
  onNavigateToQuote,
}: {
  senderName: string;
  preview: string;
  align?: "start" | "end";
  quotedMessageId?: string;
  onNavigateToQuote?: (messageId: string) => void;
}) {
  const isClickable = Boolean(quotedMessageId && onNavigateToQuote);
  const className = cn(
    "border-border/80 text-muted-foreground max-w-[80%] border-l-2 pl-2 text-[11px] leading-snug",
    align === "end" ? "ml-auto text-right" : "",
    isClickable && "hover:bg-muted/40 cursor-pointer rounded-sm transition-colors",
  );
  const content = (
    <p className="line-clamp-2">
      回复 {senderName}：{preview}
    </p>
  );

  if (isClickable) {
    return (
      <button
        type="button"
        className={cn(className, align === "end" ? "text-right" : "text-left")}
        onClick={() => onNavigateToQuote!(quotedMessageId!)}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

/** Bubble + action bar share one column; track width = max(bubble, bar content). */
function MessageBubbleAnchor({
  align,
  children,
}: {
  align: "start" | "end";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid max-w-[80%] grid-cols-1 gap-0.5",
        align === "end" ? "ml-auto justify-items-end" : "justify-items-start",
      )}
      data-message-anchor
    >
      {children}
    </div>
  );
}

function MessageActionBar({
  children,
  leading,
}: {
  children: ReactNode;
  leading?: ReactNode;
}) {
  if (!leading && !children) return null;

  return (
    <div className="flex w-full min-w-0 min-h-5 items-center justify-between gap-1.5">
      {leading ? (
        <div className="min-w-0 shrink">{leading}</div>
      ) : (
        <span className="sr-only" aria-hidden />
      )}
      {children ? (
        <div
          className={cn(
            "flex shrink-0 gap-0.5",
            !leading && "opacity-0 transition group-hover:opacity-100",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ActionIconButton({
  label,
  onClick,
  disabled,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon: typeof Copy;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground/70 hover:text-foreground h-6 w-6"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function RoomMessageRow({
  message: m,
  isSelf,
  displayName,
  roomId,
  quotedMessage,
  quotedSenderName,
  assignments,
  mentions,
  timelineMessages,
  invocations,
  managerAgentId,
  agentNameById,
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
  onEdit,
  onReply,
  onRegenerate,
  isRegenerating,
  onNavigateToQuote,
}: {
  message: RoomMessage;
  isSelf: boolean;
  displayName: string;
  roomId: string;
  quotedMessage?: RoomMessage;
  quotedSenderName?: string;
  assignments?: RoomAssignment[];
  mentions?: RoomMessageMention[];
  timelineMessages: RoomMessage[];
  invocations?: RoomInvocation[];
  managerAgentId?: string;
  agentNameById: Map<string, string>;
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
  onEdit?: () => void;
  onReply?: () => void;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
  onNavigateToQuote?: (messageId: string) => void;
}) {
  const meta = parseMessageMetadata(m.metadata);
  void roomId;
  void meta;
  const isSystem = m.sender_type === "system";
  const isAgent = m.sender_type === "agent";
  const attribution = isAgent
    ? resolveAgentMessageAttribution(m, assignments ?? [], mentions ?? [])
    : undefined;

  const invocationItems = useMemo(
    () =>
      invocationItemsForMessage(m.id, {
        timelineMessages,
        invocations,
        assignments,
        agentNameById,
        managerAgentId,
      }),
    [m.id, timelineMessages, invocations, assignments, agentNameById, managerAgentId],
  );

  const latestManager = invocationItems.find((item) => item.presentation === "manager_status");
  const actionAlign = isSelf ? "end" : "start";

  const managerLeading = latestManager ? (
    <ManagerStatusLeading
      item={latestManager}
      items={[latestManager]}
      agentNameById={agentNameById}
      onRetryAssignment={onRetryAssignment}
      onCancelAssignment={onCancelAssignment}
      retryingAssignmentId={retryingAssignmentId}
      cancellingAssignmentId={cancellingAssignmentId}
    />
  ) : undefined;

  const roleSlots = (
    <RoleAgentInvocationSlots
      items={invocationItems}
      agentNameById={agentNameById}
      onRetryAssignment={onRetryAssignment}
      onCancelAssignment={onCancelAssignment}
      retryingAssignmentId={retryingAssignmentId}
      cancellingAssignmentId={cancellingAssignmentId}
    />
  );

  const managerHistory = (
    <ManagerHistoryBelowBar
      items={invocationItems}
      agentNameById={agentNameById}
      onRetryAssignment={onRetryAssignment}
      onCancelAssignment={onCancelAssignment}
      retryingAssignmentId={retryingAssignmentId}
      cancellingAssignmentId={cancellingAssignmentId}
      align={actionAlign}
    />
  );

  if (isSystem) {
    return (
      <div className="space-y-1" data-room-message-id={m.id}>
        <p className="text-muted-foreground text-xs">{displayName}</p>
        {m.content.trim() ? (
          <div className="bg-muted/50 max-w-[80%] rounded-2xl px-3.5 py-2 text-sm">
            <Markdown>{m.content}</Markdown>
          </div>
        ) : null}
      </div>
    );
  }

  if (isSelf) {
    return (
      <div
        className="group flex w-full flex-col items-end gap-0.5"
        data-room-message-block={m.id}
        data-room-message-id={m.id}
      >
        {quotedMessage && quotedSenderName ? (
          <QuoteBlock
            align="end"
            senderName={quotedSenderName}
            quotedMessageId={quotedMessage.id}
            onNavigateToQuote={onNavigateToQuote}
            preview={truncatePreview(
              quotedMessage.sender_type === "agent"
                ? extractRoomAgentCopyText(quotedMessage)
                : quotedMessage.content,
            )}
          />
        ) : null}
        <MessageBubbleAnchor align="end">
          <div className="w-fit max-w-full rounded-2xl bg-muted px-3.5 py-2 text-sm break-words">
            <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <Markdown>{m.content}</Markdown>
            </div>
            {m.edited_at ? (
              <p className="text-muted-foreground mt-0.5 text-[10px]">已编辑</p>
            ) : null}
          </div>
          <MessageActionBar leading={managerLeading}>
            {onReply ? (
              <ActionIconButton label="引用回复" onClick={onReply} icon={Reply} />
            ) : null}
            {onEdit ? (
              <ActionIconButton label="编辑" onClick={onEdit} icon={Pencil} />
            ) : null}
          </MessageActionBar>
        </MessageBubbleAnchor>
        {roleSlots ? (
          <div className="flex w-full justify-end">
            <div className="w-full max-w-[80%]">{roleSlots}</div>
          </div>
        ) : null}
        {managerHistory}
      </div>
    );
  }

  return (
    <div
      className="group flex w-full flex-col gap-1"
      data-room-message-block={m.id}
      data-room-message-id={m.id}
    >
      <div className="flex items-center gap-1.5">
        <RoomParticipantAvatar
          actorType={isAgent ? "agent" : "member"}
          actorId={m.sender_id ?? ""}
          size={28}
        />
        <span className="text-muted-foreground text-xs font-medium">{displayName}</span>
        {attribution ? <RoomAttributionPill text={attribution} /> : null}
      </div>
      {quotedMessage && quotedSenderName ? (
        <QuoteBlock
          senderName={quotedSenderName}
          quotedMessageId={quotedMessage.id}
          onNavigateToQuote={onNavigateToQuote}
          preview={truncatePreview(
            quotedMessage.sender_type === "agent"
              ? extractRoomAgentCopyText(quotedMessage)
              : quotedMessage.content,
          )}
        />
      ) : null}
      <MessageBubbleAnchor align="start">
        <div
          className={cn(
            "w-fit max-w-full",
            isAgent && "bg-card border-border/60 rounded-2xl border px-3.5 py-2",
          )}
        >
          {isAgent ? (
            <AgentMessageBody message={m} />
          ) : (
            <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
              <Markdown>{m.content}</Markdown>
            </div>
          )}
        </div>
        <MessageActionBar leading={managerLeading}>
          {onReply ? (
            <ActionIconButton label="引用回复" onClick={onReply} icon={Reply} />
          ) : null}
          {isAgent ? (
            <>
              <AgentCopyButton message={m} />
              {onRegenerate ? (
                <ActionIconButton
                  label="重新生成"
                  onClick={onRegenerate}
                  disabled={isRegenerating}
                  icon={RefreshCw}
                />
              ) : null}
            </>
          ) : null}
        </MessageActionBar>
      </MessageBubbleAnchor>
      {roleSlots}
      {managerHistory}
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
  return (
    <ActionIconButton label="复制" onClick={handleCopy} icon={Copy} />
  );
}

function AgentMessageBody({ message }: { message: RoomMessage }) {
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
