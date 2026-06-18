"use client";

import { useMemo, useRef, type ReactNode, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade";
import { useAutoScroll } from "@multica/ui/hooks/use-auto-scroll";
import { Button } from "@multica/ui/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@multica/ui/components/ui/tooltip";
import { ActorAvatar } from "../common/actor-avatar";
import { isTaskMessageTaskId, taskMessagesOptions } from "@multica/core/chat/queries";
import { buildTimeline } from "../common/task-transcript";
import { splitTimeline } from "../chat/lib/copy-text";
import { copyMarkdown } from "../editor";
import { Markdown } from "../common/markdown";
import { ApprovalCard } from "./approval-card";
import { RoomDeliveryCard } from "./room-delivery-card";
import { shouldHideRoomMessage } from "./room-message-visibility";
import type { RoomMessage, RoomInvocation, RoomAssignment } from "@multica/core/types/room";
import { useAuthStore } from "@multica/core/auth";
import { Copy, Pencil, RefreshCw, Reply } from "lucide-react";
import {
  extractRoomAgentCopyText,
  stripWorkflowActionFooter,
  truncatePreview,
} from "./room-utils";
import {
  buildChatTimeline,
  buildInvocationChatItems,
  managerStatusByMessageId,
  type InvocationChatItem,
} from "./room-flow-utils";
import { ManagerStatusInline, RoomInvocationChatItem } from "./room-processing-slot";

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

  const { chatTimeline, managerStatusMap } = useMemo(() => {
    const items = buildInvocationChatItems(
      invocations,
      assignments,
      messages,
      agentNameById,
      managerAgentId,
    );
    return {
      chatTimeline: buildChatTimeline(visibleMessages, items),
      managerStatusMap: managerStatusByMessageId(items),
    };
  }, [
    invocations,
    assignments,
    messages,
    visibleMessages,
    agentNameById,
    managerAgentId,
  ]);

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

  const chatTailKey = useMemo(() => {
    const last = chatTimeline[chatTimeline.length - 1];
    if (!last) return "";
    if (last.kind === "message") {
      return `msg:${last.message.id}:${last.message.content.length}`;
    }
    return `inv:${last.item.invocation.id}:${last.item.phase}:${last.item.invocation.status}`;
  }, [chatTimeline]);

  useEffect(() => {
    scrollToBottom();
  }, [chatTailKey, scrollToBottom]);

  return (
    <div
      ref={scrollRef}
      data-tab-scroll-root
      style={fadeStyle}
      className="flex-1 overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-3xl space-y-4 px-5 py-4">
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
        {chatTimeline.map((entry) => {
          if (entry.kind === "invocation") {
            return (
              <RoomInvocationChatItem
                key={`inv:${entry.item.invocation.id}`}
                item={entry.item}
                onRetryAssignment={onRetryAssignment}
                onCancelAssignment={onCancelAssignment}
                retryingAssignmentId={retryingAssignmentId}
                cancellingAssignmentId={cancellingAssignmentId}
              />
            );
          }

          const m = entry.message;
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
              managerStatus={managerStatusMap.get(m.id)}
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
            />
          );
        })}
      </div>
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
}: {
  senderName: string;
  preview: string;
}) {
  return (
    <div className="border-border/80 bg-background/60 mb-2 rounded-md border-l-2 border-l-primary/40 px-2.5 py-1.5 text-xs">
      <p className="text-muted-foreground font-medium">{senderName}</p>
      <p className="text-foreground/80 mt-0.5 line-clamp-3">{preview}</p>
    </div>
  );
}

function MessageActionBar({
  children,
  align = "start",
  leading,
}: {
  children: ReactNode;
  align?: "start" | "end";
  leading?: ReactNode;
}) {
  if (!leading && !children) return null;
  const showOnHover = !leading;
  return (
    <div
      className={`flex items-center gap-2 ${showOnHover ? "opacity-0 transition group-hover:opacity-100" : ""} ${
        align === "end" ? "justify-end" : ""
      }`}
    >
      {leading}
      {children ? <div className="flex gap-0.5">{children}</div> : null}
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
  managerStatus,
  onEdit,
  onReply,
  onRegenerate,
  isRegenerating,
}: {
  message: RoomMessage;
  isSelf: boolean;
  displayName: string;
  roomId: string;
  quotedMessage?: RoomMessage;
  quotedSenderName?: string;
  managerStatus?: InvocationChatItem;
  onEdit?: () => void;
  onReply?: () => void;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}) {
  const meta = parseMessageMetadata(m.metadata);
  const isSystem = m.sender_type === "system";
  const isAgent = m.sender_type === "agent";

  if (m.message_kind === "card") {
    return (
      <div className="mx-auto max-w-[90%]">
        <RoomDeliveryCard message={m} />
      </div>
    );
  }

  if (isSystem) {
    const dispatchStyle =
      m.message_kind === "system_dispatch" || m.message_kind === "system_milestone";
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-center text-xs">
          {dispatchStyle ? "编排" : displayName}
        </p>
        {m.content.trim() ? (
          <div
            className={
              dispatchStyle
                ? "border-primary/20 bg-primary/5 mx-auto max-w-[90%] rounded-lg border px-3 py-2 text-sm"
                : "bg-muted/50 mx-auto max-w-[90%] rounded-2xl px-3.5 py-2 text-sm"
            }
          >
            <Markdown>{m.content}</Markdown>
          </div>
        ) : null}
        {(meta.human_action_id || meta.approval_id) ? (
          <div className="mx-auto max-w-[90%]">
            <ApprovalCard
              roomId={roomId}
              humanActionId={meta.human_action_id}
              approvalId={meta.approval_id}
              actionType={meta.action_type}
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (isSelf) {
    return (
      <div className="group space-y-1">
        <div className="flex items-start justify-end gap-1">
          <div className="rounded-2xl bg-muted px-3.5 py-2 text-sm max-w-[80%] break-words">
            {quotedMessage && quotedSenderName ? (
              <QuoteBlock
                senderName={quotedSenderName}
                preview={truncatePreview(
                  quotedMessage.sender_type === "agent"
                    ? extractRoomAgentCopyText(quotedMessage)
                    : quotedMessage.content,
                )}
              />
            ) : null}
            <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <Markdown>{m.content}</Markdown>
            </div>
            {m.edited_at ? (
              <p className="text-muted-foreground mt-1 text-[10px]">已编辑</p>
            ) : null}
          </div>
        </div>
        <MessageActionBar
          align="end"
          leading={managerStatus ? <ManagerStatusInline item={managerStatus} /> : undefined}
        >
          {onReply ? (
            <ActionIconButton label="引用回复" onClick={onReply} icon={Reply} />
          ) : null}
          {onEdit ? (
            <ActionIconButton label="编辑" onClick={onEdit} icon={Pencil} />
          ) : null}
        </MessageActionBar>
      </div>
    );
  }

  return (
    <div className="group w-full space-y-1.5">
      <div className="flex items-center gap-2">
        <ActorAvatar
          actorType={isAgent ? "agent" : "member"}
          actorId={m.sender_id ?? ""}
          size={24}
          showStatusDot={isAgent}
        />
        <span className="text-muted-foreground text-xs font-medium">{displayName}</span>
      </div>
      <div
        className={
          isAgent
            ? "bg-card border-border/60 rounded-2xl border px-3.5 py-2"
            : undefined
        }
      >
        {quotedMessage && quotedSenderName ? (
          <QuoteBlock
            senderName={quotedSenderName}
            preview={truncatePreview(
              quotedMessage.sender_type === "agent"
                ? extractRoomAgentCopyText(quotedMessage)
                : quotedMessage.content,
            )}
          />
        ) : null}
        {isAgent ? (
          <AgentMessageBody message={m} />
        ) : (
          <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
            <Markdown>{m.content}</Markdown>
          </div>
        )}
      </div>
      <MessageActionBar
        leading={managerStatus ? <ManagerStatusInline item={managerStatus} /> : undefined}
      >
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
  const { preface, final } = splitTimeline(timeline);
  const text = [...preface, ...final]
    .map((i) => i.content ?? "")
    .join("");

  const raw =
    text ||
    (typeof message.metadata === "object" &&
    message.metadata &&
    "detailed_explanation" in message.metadata &&
    typeof (message.metadata as { detailed_explanation?: string })
      .detailed_explanation === "string"
      ? (message.metadata as { detailed_explanation: string }).detailed_explanation
      : message.content);
  const display = stripWorkflowActionFooter(raw);

  return (
    <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
      <Markdown>{display}</Markdown>
    </div>
  );
}
