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
  onNavigateToQuote?: (messageId: string) => void;
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
  onNavigateToQuote,
  editingMessageId,
  onCancelEdit,
}: Props) {
  const editorRef = useRef<ContentEditorRef>(null);
  const {
    data: roomMembers = [],
    isFetched: membersFetched,
  } = useQuery(roomMembersOptions(wsId, roomId));
  const roomMentionScope = useMemo((): RoomMentionScope | undefined => {
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
      } else if (m.principal_type === "squad") squadIds.push(m.principal_id);
    }
    return { memberUserIds, agentIds, squadIds };
  }, [roomMembers, managerAgentId, membersFetched]);

  const handleSend = () => {
    if (!value.trim() || disabled || isSending) return;
    onSend();
    editorRef.current?.clearContent?.();
  };

  return (
    <div className="bg-background shrink-0 border-border border-t px-5 pb-3 pt-3">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        {editingMessageId ? (
          <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
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
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => onNavigateToQuote?.(quoteReply.messageId)}
              disabled={!onNavigateToQuote}
              className={cn(
                "border-border/80 text-muted-foreground min-w-0 flex-1 border-l-2 pl-2 text-left text-[11px] leading-snug",
                onNavigateToQuote &&
                  "hover:bg-muted/40 cursor-pointer rounded-sm transition-colors",
              )}
            >
              <p className="line-clamp-2">
                回复 {quoteReply.senderName}：{quoteReply.preview}
              </p>
            </button>
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
            "relative w-full rounded-lg bg-muted/20 px-3 py-2 pb-9 transition-colors focus-within:bg-muted/30",
            "[&_.rich-text-editor_p]:my-0.5 [&_.rich-text-editor_p]:leading-normal",
            "[&_.rich-text-editor_li]:my-0 [&_.rich-text-editor_li]:leading-normal",
            "[&_.rich-text-editor_ul]:my-1 [&_.rich-text-editor_ol]:my-1",
            "[&_.ProseMirror]:min-h-[1.75rem] [&_.ProseMirror]:max-h-[10rem] [&_.ProseMirror]:overflow-y-auto",
            disabled && "opacity-60",
          )}
        >
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
            showBubbleMenu={false}
            roomMentionScope={roomMentionScope}
            className="leading-normal"
          />
          <div className="absolute bottom-1 right-1.5">
            <SubmitButton
              onClick={handleSend}
              disabled={disabled || isSending || !value.trim()}
              loading={isSending}
              tooltip={editingMessageId ? "保存并重新生成" : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
