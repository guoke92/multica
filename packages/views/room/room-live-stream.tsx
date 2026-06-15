"use client";

import { useQuery } from "@tanstack/react-query";
import { isTaskMessageTaskId, taskMessagesOptions } from "@multica/core/chat/queries";
import { buildTimeline } from "../common/task-transcript";
import { splitTimeline } from "../chat/lib/copy-text";
import { Markdown } from "../common/markdown";
import { UnicodeSpinner } from "@multica/ui/components/common/unicode-spinner";
import { cn } from "@multica/ui/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

type Props = {
  taskId: string;
  agentLabel?: string;
};

/** Live agent output while a room invocation task is running (WS-backed task messages). */
export function RoomLiveStream({ taskId, agentLabel }: Props) {
  const { data: taskMessages = [] } = useQuery({
    ...taskMessagesOptions(taskId),
    enabled: isTaskMessageTaskId(taskId),
  });

  const timeline = buildTimeline(taskMessages);
  const { preface, middle, final } = splitTimeline(timeline);
  const streamText = [...preface, ...final]
    .filter((i) => i.type === "text")
    .map((i) => i.content ?? "")
    .join("");

  return (
    <div className="w-full space-y-1.5">
      {agentLabel ? (
        <p className="text-muted-foreground text-xs font-medium">{agentLabel}</p>
      ) : null}
      {streamText ? (
        <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
          <Markdown>{streamText}</Markdown>
          <span className="bg-foreground/70 ml-0.5 inline-block h-4 w-0.5 animate-pulse align-text-bottom" />
        </div>
      ) : (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <UnicodeSpinner name="breathe" className="opacity-70" />
          <span className={cn("animate-chat-text-shimmer")}>思考中</span>
        </div>
      )}
      {middle.length > 0 && <RoomProcessFold items={middle} defaultOpen />}
    </div>
  );
}

function RoomProcessFold({
  items,
  defaultOpen,
}: {
  items: ReturnType<typeof buildTimeline>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors">
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span>执行过程 ({items.length})</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="bg-muted/20 mt-1 space-y-1 rounded-lg border p-2 text-xs">
          {items.map((item) => (
            <div key={item.seq} className="text-muted-foreground truncate">
              {item.type}
              {item.tool ? ` · ${item.tool}` : ""}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
