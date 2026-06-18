"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  roomDetailOptions,
  roomGraphOptions,
  roomMessagesInfiniteOptions,
  roomMembersOptions,
  roomKeys,
} from "@multica/core/room/queries";
import {
  useSendRoomMessage,
  useUpdateRoomMessage,
  useRegenerateRoomAgentMessage,
  useRetryRoomAssignment,
  useCancelRoomAssignment,
} from "@multica/core/room/mutations";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  memberListOptions,
  agentListOptions,
} from "@multica/core/workspace/queries";
import { useAuthStore } from "@multica/core/auth";
import type { RoomMessage } from "@multica/core/types/room";
import { Button } from "@multica/ui/components/ui/button";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { RoomMessageList } from "./room-message-list";
import { RoomMembersPanel } from "./room-members-panel";
import { RoomComposer } from "./room-composer";
import { RoomSettingsSheet } from "./room-settings-sheet";
import {
  buildQuoteMentionPrefix,
  extractRoomAgentCopyText,
  truncatePreview,
  type QuoteReplyTarget,
} from "./room-utils";

type Props = {
  roomId: string;
  onArchived?: () => void;
};

export function RoomView({ roomId, onArchived }: Props) {
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const [draft, setDraft] = useState("");
  const [editingMessage, setEditingMessage] = useState<RoomMessage | null>(null);
  const [quoteReply, setQuoteReply] = useState<QuoteReplyTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: room } = useQuery(roomDetailOptions(wsId, roomId));
  const { data: graph } = useQuery(roomGraphOptions(wsId, roomId));
  const {
    data: messagePages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(roomMessagesInfiniteOptions(wsId, roomId));
  const messages = useMemo(
    () =>
      messagePages?.pages
        .slice()
        .reverse()
        .flat() ?? [],
    [messagePages?.pages],
  );
  const { data: members = [] } = useQuery(roomMembersOptions(wsId, roomId));
  const { data: workspaceMembers = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  const assignments = graph?.assignments ?? [];
  const assignmentDependencies = graph?.assignment_dependencies ?? [];
  const invocations = graph?.invocations ?? [];
  const invocationEvents = graph?.invocation_events ?? [];

  const sendMessage = useSendRoomMessage(wsId, roomId);
  const updateMessage = useUpdateRoomMessage(wsId, roomId);
  const regenerateAgent = useRegenerateRoomAgentMessage(wsId, roomId);
  const retryAssignment = useRetryRoomAssignment(wsId, roomId);
  const cancelAssignment = useCancelRoomAssignment(wsId, roomId);
  const selfMember = useMemo(
    () =>
      members.find(
        (m) => m.principal_type === "user" && m.principal_id === userId,
      ),
    [members, userId],
  );
  const canManage = selfMember?.role === "owner" || selfMember?.role === "admin";
  const isOwner = selfMember?.role === "owner";

  const agentNameById = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );
  const memberNameById = useMemo(
    () => new Map(workspaceMembers.map((m) => [m.user_id, m.name || m.email])),
    [workspaceMembers],
  );

  const clearComposerContext = () => {
    setEditingMessage(null);
    setQuoteReply(null);
  };

  const invalidateRoomGraph = () => {
    void qc.invalidateQueries({ queryKey: roomKeys.graph(wsId, roomId) });
    void qc.invalidateQueries({ queryKey: roomKeys.detail(wsId, roomId) });
  };

  const handleSend = () => {
    const content = draft.trim();
    if (!content) return;

    if (editingMessage) {
      if (editingMessage.id.startsWith("optimistic-")) {
        toast.error("消息仍在发送中，请稍后再编辑");
        return;
      }
      updateMessage.mutate(
        { messageId: editingMessage.id, content },
        {
          onSuccess: () => {
            setDraft("");
            clearComposerContext();
            void qc.invalidateQueries({ queryKey: roomKeys.messages(wsId, roomId) });
            invalidateRoomGraph();
          },
          onError: (err) => {
            toast.error(
              err instanceof Error && err.message ? err.message : "保存失败",
            );
          },
        },
      );
      return;
    }

    const optimistic: RoomMessage = {
      id: `optimistic-${Date.now()}`,
      sender_type: "user",
      sender_id: userId,
      content,
      quote_message_id: quoteReply?.messageId,
      created_at: new Date().toISOString(),
    };
    qc.setQueryData<RoomMessage[]>(roomKeys.messages(wsId, roomId), (old) =>
      old ? [...old, optimistic] : [optimistic],
    );

    sendMessage.mutate(
      {
        content,
        quote_message_id: quoteReply?.messageId,
      },
      {
        onSuccess: (resp) => {
          setDraft("");
          clearComposerContext();
          if (
            !room?.manager_agent_id &&
            (!resp?.invocations || resp.invocations.length === 0) &&
            !content.includes("@")
          ) {
            toast.message("消息已发送，但没有 Agent 响应", {
              description:
                "此群未配置群管理，未 @Agent 的消息不会被自动处理。请 @具体的 Agent 或在群设置中启用群管理。",
            });
          }
          void qc.invalidateQueries({ queryKey: roomKeys.messages(wsId, roomId) });
          invalidateRoomGraph();
        },
        onError: (err) => {
          toast.error(
            err instanceof Error && err.message ? err.message : "消息发送失败",
          );
          void qc.invalidateQueries({ queryKey: roomKeys.messages(wsId, roomId) });
        },
      },
    );
  };

  const handleEditMessage = (message: RoomMessage) => {
    if (message.id.startsWith("optimistic-")) {
      toast.error("消息仍在发送中，请稍后再编辑");
      return;
    }
    setEditingMessage(message);
    setQuoteReply(null);
    setDraft(message.content);
  };

  const handleReplyToMessage = (message: RoomMessage, displayName: string) => {
    setEditingMessage(null);
    const mention = buildQuoteMentionPrefix(message, displayName, userId);
    const previewSource =
      message.sender_type === "agent"
        ? extractRoomAgentCopyText(message)
        : message.content;
    setQuoteReply({
      messageId: message.id,
      senderType: message.sender_type,
      senderId: message.sender_id,
      senderName: displayName,
      preview: truncatePreview(previewSource),
    });
    setDraft(mention);
  };

  const handleRegenerateAgentMessage = (message: RoomMessage) => {
    regenerateAgent.mutate(message.id, {
      onError: (err) => {
        toast.error(
          err instanceof Error && err.message ? err.message : "重新生成失败",
        );
      },
    });
  };

  const handleRetryAssignment = (assignmentId: string) => {
    retryAssignment.mutate(assignmentId, {
      onError: (err) => {
        toast.error(
          err instanceof Error && err.message ? err.message : "重试失败",
        );
      },
    });
  };

  const handleCancelAssignment = (assignmentId: string) => {
    cancelAssignment.mutate(assignmentId, {
      onError: (err) => {
        toast.error(
          err instanceof Error && err.message ? err.message : "取消失败",
        );
      },
    });
  };

  const isSending = sendMessage.isPending || updateMessage.isPending;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-background shrink-0 border-b px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold">{room?.name ?? "…"}</h1>
              {room?.description ? (
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                  {room.description}
                </p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => setSettingsOpen(true)}
              title="群管理"
            >
              <Settings className="size-4" />
            </Button>
          </div>
        </header>
        <RoomMessageList
          messages={messages}
          roomId={roomId}
          managerAgentId={room?.manager_agent_id}
          assignments={assignments}
          invocations={invocations}
          onRetryAssignment={handleRetryAssignment}
          onCancelAssignment={handleCancelAssignment}
          retryingAssignmentId={
            retryAssignment.isPending ? (retryAssignment.variables ?? null) : null
          }
          cancellingAssignmentId={
            cancelAssignment.isPending ? (cancelAssignment.variables ?? null) : null
          }
          onEditMessage={handleEditMessage}
          onReplyToMessage={handleReplyToMessage}
          onRegenerateAgentMessage={handleRegenerateAgentMessage}
          regeneratingMessageId={
            regenerateAgent.isPending
              ? (regenerateAgent.variables ?? null)
              : null
          }
          agentNameById={agentNameById}
          memberNameById={memberNameById}
          hasOlderMessages={hasNextPage === true}
          isLoadingOlderMessages={isFetchingNextPage}
          onLoadOlderMessages={() => {
            void fetchNextPage();
          }}
        />
        <RoomComposer
          roomId={roomId}
          wsId={wsId}
          managerAgentId={room?.manager_agent_id}
          value={draft}
          onChange={setDraft}
          onSend={handleSend}
          isSending={isSending}
          quoteReply={quoteReply}
          onCancelQuote={() => setQuoteReply(null)}
          editingMessageId={editingMessage?.id ?? null}
          onCancelEdit={() => {
            setEditingMessage(null);
            setDraft("");
          }}
        />
      </div>
      <RoomMembersPanel
        roomId={roomId}
        wsId={wsId}
        managerAgentId={room?.manager_agent_id}
        currentUserId={userId}
        canManage={canManage}
        isOwner={isOwner}
        assignments={assignments}
        assignmentDependencies={assignmentDependencies}
        invocations={invocations}
        invocationEvents={invocationEvents}
        onRetryAssignment={handleRetryAssignment}
        onCancelAssignment={handleCancelAssignment}
        retryingAssignmentId={
          retryAssignment.isPending ? (retryAssignment.variables ?? null) : null
        }
        cancellingAssignmentId={
          cancelAssignment.isPending ? (cancelAssignment.variables ?? null) : null
        }
        onLeft={onArchived}
      />

      {room ? (
        <RoomSettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          room={room}
          wsId={wsId}
          canManage={canManage}
          isOwner={isOwner}
          onArchived={onArchived}
          onLeft={onArchived}
        />
      ) : null}
    </div>
  );
}
