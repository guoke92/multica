"use client";

import { useMemo, useRef } from "react";
import { ContentEditor, type ContentEditorRef } from "../editor";
import type { RoomMentionScope } from "../editor/extensions/mention-suggestion";
import { SubmitButton } from "@multica/ui/components/common/submit-button";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { roomMembersOptions } from "@multica/core/room/queries";
import { X } from "lucide-react";
import type { QuoteReplyTarget } from "./room-utils";

type Props = {
  roomId: string;
  wsId: string;
  managerAgentId?: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  isSending?: boolean;
  quoteReply?: QuoteReplyTarget | null;
  onCancelQuote?: () => void;
  editingMessageId?: string | null;
  onCancelEdit?: () => void;
};

export function RoomComposer({
  roomId,
  wsId,
  managerAgentId,
  value,
  onChange,
  onSend,
  disabled,
  isSending,
  quoteReply,
  onCancelQuote,
  editingMessageId,
  onCancelEdit,
}: Props) {
  const editorRef = useRef<ContentEditorRef>(null);
  const {
    data: roomMembers = [],
    isFetched: membersFetched,
  } = useQuery(roomMembersOptions(wsId, roomId));
  const roomMentionScope = useMemo((): RoomMentionScope | undefined => {
    // Until members are loaded, return an empty scope (no suggestions)
    // to prevent showing non-room-members in @ suggestions
    if (!membersFetched) return { memberUserIds: [], agentIds: [], squadIds: [] };
    if (roomMembers.length === 0) return undefined;
    const memberUserIds: string[] = [];
    const agentIds: string[] = [];
    const squadIds: string[] = [];
    for (const m of roomMembers) {
      if (m.principal_type === "user") memberUserIds.push(m.principal_id);
      else if (m.principal_type === "agent") {
        if (!managerAgentId || m.principal_id !== managerAgentId) {
          agentIds.push(m.principal_id);
        }
      }
      else if (m.principal_type === "squad") squadIds.push(m.principal_id);
    }
    return { memberUserIds, agentIds, squadIds };
  }, [roomMembers, managerAgentId, membersFetched]);

  const handleSend = () => {
    if (!value.trim() || disabled || isSending) return;
    onSend();
    editorRef.current?.clearContent?.();
  };

  return (
    <div className="border-border bg-background shrink-0 border-t px-4 py-3">
      {editingMessageId ? (
        <div className="text-muted-foreground mb-2 flex items-center justify-between gap-2 text-xs">
          <span>正在编辑消息，保存后将重新触发 @ 回复</span>
          {onCancelEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onCancelEdit}
              aria-label="取消编辑"
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
      {quoteReply ? (
        <div className="border-border bg-muted/40 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground font-medium">
              回复 {quoteReply.senderName}
            </p>
            <p className="text-foreground/80 mt-0.5 line-clamp-2">
              {quoteReply.preview}
            </p>
          </div>
          {onCancelQuote ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              onClick={onCancelQuote}
              aria-label="取消引用"
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          "border-border bg-muted/30 focus-within:ring-ring/30 rounded-xl border shadow-sm focus-within:ring-2",
          disabled && "opacity-60",
        )}
      >
        <div className="px-3 pt-3">
          <ContentEditor
            ref={editorRef}
            defaultValue={value}
            onUpdate={onChange}
            placeholder={
              editingMessageId
                ? "修改消息内容…"
                : "输入消息，@ 提及本群成员或 Agent…"
            }
            onSubmit={handleSend}
            submitOnEnter
            roomMentionScope={roomMentionScope}
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-3 pb-2.5 pt-1">
          <SubmitButton
            onClick={handleSend}
            disabled={disabled || isSending || !value.trim()}
            loading={isSending}
            tooltip={editingMessageId ? "保存并重新生成" : undefined}
          />
        </div>
      </div>
      <p className="text-muted-foreground mt-1.5 text-center text-[11px]">
        Enter 发送 · Shift+Enter 换行
      </p>
    </div>
  );
}
