"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@multica/ui/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@multica/ui/components/ui/tooltip";
import { isTaskMessageTaskId, taskMessagesOptions } from "@multica/core/chat/queries";
import { buildTimeline } from "../common/task-transcript";
import { splitTimeline } from "../chat/lib/copy-text";
import { copyMarkdown } from "../editor";
import { Markdown } from "../common/markdown";
import type { RoomMessage } from "@multica/core/types/room";
import { Copy, RefreshCw, Reply } from "lucide-react";
import { extractRoomAgentCopyText } from "./room-utils";

export function RoomAgentReplyBody({ message }: { message: RoomMessage }) {
  const meta =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)
      : {};
  const taskId =
    typeof meta.task_id === "string" ? meta.task_id : null;

  const { data: taskMessages = [] } = useQuery({
    ...taskMessagesOptions(taskId ?? ""),
    enabled: !!taskId && isTaskMessageTaskId(taskId),
  });
  const timeline = buildTimeline(taskMessages);
  const { preface, final } = splitTimeline(timeline);
  const text = [...preface, ...final]
    .map((i) => i.content ?? "")
    .join("");

  const display =
    text ||
    (typeof meta.detailed_explanation === "string" && meta.detailed_explanation
      ? meta.detailed_explanation
      : message.content);

  return (
    <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
      <Markdown>{display}</Markdown>
    </div>
  );
}

export function RoomAgentReplyActions({
  message,
  onReply,
  onRegenerate,
  isRegenerating,
}: {
  message: RoomMessage;
  onReply?: () => void;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}) {
  const handleCopy = async () => {
    try {
      await copyMarkdown(extractRoomAgentCopyText(message));
      toast.success("已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <div className="flex gap-0.5 opacity-0 transition group-hover/slot:opacity-100">
      {onReply ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground/70 hover:text-foreground h-6 w-6"
                onClick={onReply}
                aria-label="引用回复"
              />
            }
          >
            <Reply className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="top">引用回复</TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground/70 hover:text-foreground h-6 w-6"
              onClick={handleCopy}
              aria-label="复制"
            />
          }
        >
          <Copy className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent side="top">复制</TooltipContent>
      </Tooltip>
      {onRegenerate ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground/70 hover:text-foreground h-6 w-6"
                onClick={onRegenerate}
                disabled={isRegenerating}
                aria-label="重新生成"
              />
            }
          >
            <RefreshCw className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="top">重新生成</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
