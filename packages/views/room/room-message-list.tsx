"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { RoomInvocationReplySlot } from "./room-invocation-reply-slot";
import { RoomRouteHint } from "./room-route-hint";
import { RoomEscalationBanner } from "./room-escalation-banner";
import {
  isManagerInvocation,
  shouldHideRoomMessage,
} from "./room-message-visibility";
import type { MentionInvocation, RoomMessage } from "@multica/core/types/room";
import { useAuthStore } from "@multica/core/auth";
import { Copy, Pencil, RefreshCw, Reply } from "lucide-react";
import {
  buildThreadForest,
  extractRoomAgentCopyText,
  getRoomViewMode,
  setRoomViewMode,
  stripWorkflowActionFooter,
  resolveInvocationAttribution,
  truncatePreview,
  type RoomViewMode,
  type ThreadBlock,
} from "./room-utils";

const SLOT_INVOCATION_STATUSES = new Set([
  "pending",
  "queued",
  "running",
  "delivered",
  "cancelled",
  "failed",
  "timed_out",
  "paused",
  "succeeded",
]);

function isOptimisticMessageId(id: string): boolean {
  return id.startsWith("optimistic-");
}

/** Hide invocation-backed agent replies; they render in the user-message reply column. */
function collectAnchoredResponseIds(
  messages: RoomMessage[],
  invocations: MentionInvocation[],
): Set<string> {
  const ids = new Set<string>();
  for (const inv of invocations) {
    if (inv.response_message_id) ids.add(inv.response_message_id);
  }
  for (const m of messages) {
    if (m.sender_type !== "agent") continue;
    const meta = parseMessageMetadata(m.metadata);
    if (meta.invocation_id || meta.trigger_message_id) ids.add(m.id);
  }
  return ids;
}

function findManagerInvocation(
  messageId: string,
  invocations: MentionInvocation[],
  managerAgentId?: string,
  editedAtMs?: number,
): MentionInvocation | undefined {
  if (!managerAgentId) return undefined;
  return invocations.find((inv) => {
    if (inv.message_id !== messageId) return false;
    if (!isManagerInvocation(inv, managerAgentId)) return false;
    if (
      editedAtMs &&
      editedAtMs > 0 &&
      inv.created_at &&
      new Date(inv.created_at).getTime() < editedAtMs
    ) {
      return false;
    }
    return true;
  });
}

/** Walk the @ chain from a user message; flat sibling slots, chronological. */
function flattenInvocationChain(
  rootMessageId: string,
  invocationsByMessage: Map<string, MentionInvocation[]>,
  messages: RoomMessage[],
  messagesById: Map<string, RoomMessage>,
  editedAtMs: number,
  managerAgentId?: string,
): MentionInvocation[] {
  const out: MentionInvocation[] = [];
  const queue = [rootMessageId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const mid = queue.shift()!;
    if (visited.has(mid)) continue;
    visited.add(mid);

    for (const inv of invocationsByMessage.get(mid) ?? []) {
      if (isManagerInvocation(inv, managerAgentId)) continue;
      if (!SLOT_INVOCATION_STATUSES.has(inv.status)) continue;
      if (
        editedAtMs > 0 &&
        inv.created_at &&
        new Date(inv.created_at).getTime() < editedAtMs
      ) {
        continue;
      }

      out.push(inv);

      const responseMessage = findResponseMessage(inv, messages, messagesById);
      if (responseMessage) {
        queue.push(responseMessage.id);
      }
    }
  }

  return out.sort(
    (a, b) =>
      new Date(a.created_at ?? 0).getTime() -
      new Date(b.created_at ?? 0).getTime(),
  );
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
  if (typeof o.trigger_message_id === "string") {
    out.trigger_message_id = o.trigger_message_id;
  }
  return out;
}

function findResponseMessage(
  inv: MentionInvocation,
  messages: RoomMessage[],
  messagesById: Map<string, RoomMessage>,
): RoomMessage | undefined {
  if (inv.response_message_id) {
    return messagesById.get(inv.response_message_id);
  }
  return messages.find((m) => {
    if (m.sender_type !== "agent") return false;
    const meta = parseMessageMetadata(m.metadata);
    return meta.invocation_id === inv.id;
  });
}

/** Find the route_hint message that follows a manager invocation. */
function findRouteHintForManager(
  managerInv: MentionInvocation,
  messages: RoomMessage[],
): RoomMessage | undefined {
  const respId = managerInv.response_message_id;
  if (!respId) return undefined;
  const idx = messages.findIndex((m) => m.id === respId);
  if (idx < 0) return undefined;
  for (let i = idx + 1; i < messages.length && i <= idx + 5; i++) {
    const msg = messages[i];
    if (!msg) break;
    if (msg.message_kind === "route_hint") return msg;
    if (msg.sender_type === "user") break;
  }
  return undefined;
}

/** Get the manager agent's full response text for a given invocation. */
function getManagerResponseContent(
  managerInv: MentionInvocation,
  messages: RoomMessage[],
  messagesById: Map<string, RoomMessage>,
): string | undefined {
  const resp = findResponseMessage(managerInv, messages, messagesById);
  return resp?.content;
}

/** Escalation banner anchored to the user message at the quote-chain root (v2.3). */
function findEscalationForRoot(
  rootMessageId: string,
  messages: RoomMessage[],
): RoomMessage | undefined {
  return messages.find(
    (m) =>
      m.message_kind === "escalate_hint" &&
      m.quote_message_id === rootMessageId,
  );
}

function escalationBannerCopy(msg: RoomMessage): { title: string; detail?: string } {
  const rm = (msg.relay_metadata ?? {}) as Record<string, string>;
  const targetName = rm.target_agent_name ?? "高级角色";
  const reason = rm.reason?.trim();
  const title = reason ? reason : `已引入 ${targetName} 协助裁决`;
  const detail = reason ? `已引入 ${targetName} 协助裁决` : undefined;
  return { title, detail: detail !== title ? detail : undefined };
}

type Props = {
  messages: RoomMessage[];
  invocations: MentionInvocation[];
  roomId: string;
  managerAgentId?: string;
  onRetryInvocation: (invocationId: string) => void;
  onCancelInvocation?: (invocationId: string) => void;
  onResumeInvocation?: (invocationId: string) => void;
  onEditMessage?: (message: RoomMessage) => void;
  onReplyToMessage?: (message: RoomMessage, displayName: string) => void;
  onRegenerateAgentMessage?: (message: RoomMessage) => void;
  regeneratingMessageId?: string | null;
  hasOlderMessages?: boolean;
  isLoadingOlderMessages?: boolean;
  onLoadOlderMessages?: () => void;
  cancellingInvocationId?: string | null;
  retryingInvocationId?: string | null;
  resumingInvocationId?: string | null;
  agentNameById: Map<string, string>;
  memberNameById: Map<string, string>;
  squadNameById?: Map<string, string>;
};

function flattenThreadBlocks(blocks: ThreadBlock[]): ThreadBlock[] {
  const out: ThreadBlock[] = [];
  const walk = (nodes: ThreadBlock[]) => {
    for (const node of nodes) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(blocks);
  return out;
}

export function RoomMessageList({
  messages,
  invocations,
  roomId,
  managerAgentId,
  onRetryInvocation,
  onCancelInvocation,
  onResumeInvocation,
  onEditMessage,
  onReplyToMessage,
  onRegenerateAgentMessage,
  regeneratingMessageId,
  hasOlderMessages,
  isLoadingOlderMessages,
  onLoadOlderMessages,
  cancellingInvocationId,
  retryingInvocationId,
  resumingInvocationId,
  agentNameById,
  memberNameById,
  squadNameById,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fadeStyle = useScrollFade(scrollRef);
  useAutoScroll(scrollRef);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [viewMode, setViewMode] = useState<RoomViewMode>("timeline");

  useEffect(() => {
    setViewMode(getRoomViewMode(roomId));
  }, [roomId]);

  const messagesById = new Map(messages.map((m) => [m.id, m]));
  const anchoredResponseIds = collectAnchoredResponseIds(messages, invocations);

  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (shouldHideRoomMessage(m, managerAgentId)) return false;
        if (m.sender_type === "agent" && anchoredResponseIds.has(m.id)) return false;
        return true;
      }),
    [messages, managerAgentId, anchoredResponseIds],
  );

  const threadDepthById = useMemo(() => {
    const map = new Map<string, number>();
    for (const block of flattenThreadBlocks(buildThreadForest(visibleMessages))) {
      map.set(block.root.id, block.depth);
    }
    return map;
  }, [visibleMessages]);

  const orderedMessages = useMemo(() => {
    if (viewMode === "timeline") return visibleMessages;
    return flattenThreadBlocks(buildThreadForest(visibleMessages)).map((b) => b.root);
  }, [visibleMessages, viewMode]);

  const invocationsByMessage = new Map<string, MentionInvocation[]>();
  for (const inv of invocations) {
    const mid = inv.message_id;
    if (!mid) continue;
    const list = invocationsByMessage.get(mid) ?? [];
    list.push(inv);
    invocationsByMessage.set(mid, list);
  }

  return (
    <div
      ref={scrollRef}
      data-tab-scroll-root
      style={fadeStyle}
      className="flex-1 overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-3xl space-y-4 px-5 py-4">
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            size="xs"
            variant={viewMode === "timeline" ? "secondary" : "ghost"}
            onClick={() => {
              setViewMode("timeline");
              setRoomViewMode(roomId, "timeline");
            }}
          >
            时间线
          </Button>
          <Button
            type="button"
            size="xs"
            variant={viewMode === "thread" ? "secondary" : "ghost"}
            onClick={() => {
              setViewMode("thread");
              setRoomViewMode(roomId, "thread");
            }}
          >
            引用链
          </Button>
        </div>
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
        {orderedMessages.map((m) => {
          const threadDepth = viewMode === "thread" ? (threadDepthById.get(m.id) ?? 0) : 0;

          const editedAtMs = m.edited_at ? new Date(m.edited_at).getTime() : 0;
          const isSelf =
            m.sender_type === "user" && m.sender_id === currentUserId;
          const isUserMessage = m.sender_type === "user";
          const managerInvocation = isUserMessage
            ? findManagerInvocation(m.id, invocations, managerAgentId, editedAtMs)
            : undefined;

          // Compute agent slots + Manager response for orchestration card
          const slotInvocations = isUserMessage
            ? flattenInvocationChain(
                m.id,
                invocationsByMessage,
                messages,
                messagesById,
                editedAtMs,
                managerAgentId,
              )
            : [];

          // Compute manager routing info for the routing card
          const routeHintMsg = managerInvocation
            ? findRouteHintForManager(managerInvocation, messages)
            : undefined;
          const routeTargetName = routeHintMsg
            ? ((routeHintMsg.relay_metadata as Record<string, string> | null)?.target_agent_name ?? "")
            : (slotInvocations[0]
                ? (agentNameById.get(slotInvocations[0].target_id) ?? "")
                : "");
          const managerResponseContent = managerInvocation
            ? getManagerResponseContent(managerInvocation, messages, messagesById)
            : undefined;
          const escalationMsg = isUserMessage
            ? findEscalationForRoot(m.id, messages)
            : undefined;
          const escalationCopy = escalationMsg
            ? escalationBannerCopy(escalationMsg)
            : undefined;
          const displayName = resolveSenderName(m, agentNameById, memberNameById);
          const quoted = m.quote_message_id
            ? messagesById.get(m.quote_message_id)
            : undefined;
          const canEdit =
            isSelf &&
            onEditMessage &&
            !isOptimisticMessageId(m.id);

          return (
            <div
              key={m.id}
              style={
                threadDepth > 0
                  ? { marginLeft: `${Math.min(threadDepth, 6) * 12}px` }
                  : undefined
              }
            >
            <Fragment>
              <RoomMessageRow
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
              {isUserMessage && managerInvocation ? (
                <RoomRouteHint
                  status={managerInvocation.status}
                  targetAgentName={routeTargetName}
                  managerResponse={managerResponseContent}
                  onRetry={
                    managerInvocation.status === "failed" ||
                    managerInvocation.status === "timed_out"
                      ? () => onRetryInvocation(managerInvocation.id)
                      : undefined
                  }
                  isRetrying={retryingInvocationId === managerInvocation.id}
                />
              ) : null}
              {isUserMessage && escalationCopy ? (
                <RoomEscalationBanner
                  title={escalationCopy.title}
                  detail={escalationCopy.detail}
                />
              ) : null}
              {isUserMessage
                ? slotInvocations.map((inv) => {
                    const responseMessage = findResponseMessage(
                      inv,
                      messages,
                      messagesById,
                    );
                    const attribution = resolveInvocationAttribution(
                      inv,
                      m,
                      invocations,
                      messagesById,
                      agentNameById,
                      managerAgentId,
                    );
                    return (
                      <RoomInvocationReplySlot
                        key={inv.id}
                        invocation={inv}
                        responseMessage={responseMessage}
                        attribution={attribution}
                        agentNameById={agentNameById}
                        squadNameById={squadNameById}
                        onCancel={onCancelInvocation}
                        onRetry={onRetryInvocation}
                        onResume={onResumeInvocation}
                        onRegenerate={onRegenerateAgentMessage}
                        onReplyToMessage={onReplyToMessage}
                        isCancelling={cancellingInvocationId === inv.id}
                        isRetrying={retryingInvocationId === inv.id}
                        isResuming={resumingInvocationId === inv.id}
                        isRegenerating={
                          !!responseMessage &&
                          regeneratingMessageId === responseMessage.id
                        }
                      />
                    );
                  })
                : null}
            </Fragment>
            </div>
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
}: {
  children: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <div
      className={`flex gap-0.5 opacity-0 transition group-hover:opacity-100 ${
        align === "end" ? "justify-end" : ""
      }`}
    >
      {children}
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
                preview={truncatePreview(quotedMessage.content)}
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
        <MessageActionBar align="end">
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
      {quotedMessage && quotedSenderName ? (
        <QuoteBlock
          senderName={quotedSenderName}
          preview={truncatePreview(quotedMessage.content)}
        />
      ) : null}
      {isAgent ? (
        <AgentMessageBody message={m} />
      ) : (
        <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
          <Markdown>{m.content}</Markdown>
        </div>
      )}
      <MessageActionBar>
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
