"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Brain, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { Markdown } from "../markdown";
import { splitTimeline } from "../../chat/lib/copy-text";
import type { TimelineItem } from "./build-timeline";

type Props = {
  items: TimelineItem[];
  /** Stream in progress — process fold defaults open, show typing cursor. */
  isStreaming?: boolean;
  /**
   * When true, only render the process fold (for completed bubbles that already
   * show a server summary as the final answer).
   */
  processOnly?: boolean;
  processLabel?: (count: number) => string;
};

export function ProcessTimelineView({
  items,
  isStreaming,
  processOnly,
  processLabel = (count) => `执行过程 (${count})`,
}: Props) {
  const { preface, middle, final } = splitTimeline(items);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isStreaming) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [isStreaming, items.length, items[items.length - 1]?.content, items[items.length - 1]?.seq]);

  if (processOnly) {
    if (middle.length === 0) return null;
    return (
      <div className="space-y-1">
        <ProcessFold items={middle} defaultOpen={false} processLabel={processLabel} />
        <div ref={endRef} aria-hidden className="h-px" />
      </div>
    );
  }

  const showCursor =
    isStreaming &&
    (preface.length > 0 || final.length > 0 || (middle.length === 0 && items.length > 0));

  return (
    <div className="space-y-1">
      {preface.length > 0 && (
        <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
          <Markdown>{preface.map((t) => t.content ?? "").join("")}</Markdown>
          {isStreaming && final.length === 0 && middle.length === 0 ? (
            <StreamingCursor />
          ) : null}
        </div>
      )}
      {middle.length > 0 && (
        <ProcessFold
          items={middle}
          defaultOpen={!!isStreaming}
          processLabel={processLabel}
        />
      )}
      {final.length > 0 && (
        <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
          <Markdown>{final.map((t) => t.content ?? "").join("")}</Markdown>
          {isStreaming ? <StreamingCursor /> : null}
        </div>
      )}
      {showCursor && preface.length === 0 && final.length === 0 && middle.length > 0 ? (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <StreamingCursor />
        </div>
      ) : null}
      <div ref={endRef} aria-hidden className="h-px" />
    </div>
  );
}

function StreamingCursor() {
  return (
    <span className="bg-foreground/70 ml-0.5 inline-block h-4 w-0.5 animate-pulse align-text-bottom" />
  );
}

function ProcessFold({
  items,
  defaultOpen,
  processLabel,
}: {
  items: TimelineItem[];
  defaultOpen?: boolean;
  processLabel: (count: number) => string;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-1">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors">
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span>{processLabel(items.length)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="bg-muted/20 mt-1 space-y-0.5 rounded-lg border p-2">
          {items.map((item) =>
            item.type === "text" ? (
              <MiddleTextRow key={item.seq} item={item} />
            ) : (
              <TimelineItemRow key={item.seq} item={item} />
            ),
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MiddleTextRow({ item }: { item: TimelineItem }) {
  return (
    <div className="text-muted-foreground py-0.5 text-xs prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <Markdown>{item.content ?? ""}</Markdown>
    </div>
  );
}

function TimelineItemRow({ item }: { item: TimelineItem }) {
  switch (item.type) {
    case "tool_use":
      return <ToolCallRow item={item} />;
    case "tool_result":
      return <ToolResultRow item={item} />;
    case "thinking":
      return <ThinkingRow item={item} />;
    case "error":
      return <ErrorRow item={item} />;
    default:
      return null;
  }
}

function shortenPath(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return ".../" + parts.slice(-2).join("/");
}

function getToolSummary(item: TimelineItem): string {
  if (!item.input) return "";
  const inp = item.input as Record<string, string>;
  if (inp.query) return inp.query;
  if (inp.file_path) return shortenPath(inp.file_path);
  if (inp.path) return shortenPath(inp.path);
  if (inp.pattern) return inp.pattern;
  if (inp.description) return String(inp.description);
  if (inp.command) {
    const cmd = String(inp.command);
    return cmd.length > 100 ? `${cmd.slice(0, 100)}...` : cmd;
  }
  if (inp.prompt) {
    const p = String(inp.prompt);
    return p.length > 100 ? `${p.slice(0, 100)}...` : p;
  }
  if (inp.skill) return String(inp.skill);
  for (const v of Object.values(inp)) {
    if (typeof v === "string" && v.length > 0 && v.length < 120) return v;
  }
  return "";
}

function ToolCallRow({ item }: { item: TimelineItem }) {
  const [open, setOpen] = useState(false);
  const summary = getToolSummary(item);
  const hasInput = item.input && Object.keys(item.input).length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="hover:bg-accent/30 -mx-1 flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors">
        <ChevronRight
          className={cn(
            "text-muted-foreground h-3 w-3 shrink-0 transition-transform",
            open && "rotate-90",
            !hasInput && "invisible",
          )}
        />
        <span className="text-foreground shrink-0 font-medium">{item.tool}</span>
        {summary ? <span className="text-muted-foreground truncate">{summary}</span> : null}
      </CollapsibleTrigger>
      {hasInput ? (
        <CollapsibleContent>
          <pre className="bg-muted/50 text-muted-foreground mt-0.5 ml-[18px] max-h-32 overflow-auto rounded p-2 text-xs break-all whitespace-pre-wrap">
            {JSON.stringify(item.input, null, 2)}
          </pre>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function ToolResultRow({ item }: { item: TimelineItem }) {
  const [open, setOpen] = useState(false);
  const output = item.output ?? "";
  if (!output) return null;

  const preview = output.length > 120 ? `${output.slice(0, 120)}...` : output;
  const labelPrefix = item.tool ? `${item.tool} 结果：` : "工具结果：";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="hover:bg-accent/30 -mx-1 flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-xs transition-colors">
        <ChevronRight
          className={cn(
            "text-muted-foreground mt-0.5 h-3 w-3 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="text-muted-foreground/70 truncate">
          {labelPrefix}
          {preview}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="bg-muted/50 text-muted-foreground mt-0.5 ml-[18px] max-h-40 overflow-auto rounded p-2 text-xs break-all whitespace-pre-wrap">
          {output.length > 4000 ? `${output.slice(0, 4000)}\n... (truncated)` : output}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ThinkingRow({ item }: { item: TimelineItem }) {
  const [open, setOpen] = useState(false);
  const text = item.content ?? "";
  if (!text) return null;

  const preview = text.length > 150 ? `${text.slice(0, 150)}...` : text;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="hover:bg-accent/30 -mx-1 flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-xs transition-colors">
        <Brain className="text-muted-foreground/60 mt-0.5 h-3 w-3 shrink-0" />
        <span className="text-muted-foreground truncate italic">{preview}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="bg-muted/30 text-muted-foreground mt-0.5 ml-[18px] max-h-40 overflow-auto rounded p-2 text-xs break-words whitespace-pre-wrap">
          {text}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ErrorRow({ item }: { item: TimelineItem }) {
  return (
    <div className="-mx-1 flex items-start gap-1.5 px-1 py-0.5 text-xs">
      <AlertCircle className="text-destructive mt-0.5 h-3 w-3 shrink-0" />
      <span className="text-destructive">{item.content}</span>
    </div>
  );
}
