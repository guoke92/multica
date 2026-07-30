"use client";

import { cn } from "@multica/ui/lib/utils";

export function RoomQuoteBlock({
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
