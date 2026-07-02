"use client";

import { Markdown } from "../common/markdown";
import type { RoomMessage } from "@multica/core/types/room";

type Props = {
  message: RoomMessage;
  hiddenCount?: number;
};

/** Manager dispatch slot attached below the source message.
 *
 * This is not a chat bubble — it is metadata that the room manager routed/relayed/escalated
 * work to a role agent. Multiple dispatches for the same source message are folded; only the
 * latest is rendered, with a hint showing how many earlier dispatches exist.
 */
export function RoomManagerSlot({ message, hiddenCount = 0 }: Props) {
  return (
    <div className="group flex items-start gap-2 pl-10" data-room-manager-slot={message.id}>
      <div className="border-primary/20 bg-primary/5 max-w-[85%] rounded-xl border-l-[3px] px-3 py-2 text-sm">
        <p className="text-primary mb-1 text-[11px] font-medium">群管分配</p>
        <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <Markdown>{message.content}</Markdown>
        </div>
        {hiddenCount > 0 ? (
          <p className="text-muted-foreground mt-1 text-[11px]">
            还有 {hiddenCount} 次群管操作
          </p>
        ) : null}
      </div>
    </div>
  );
}
