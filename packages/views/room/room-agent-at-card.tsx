"use client";

import { Badge } from "@multica/ui/components/ui/badge";
import { Markdown } from "../common/markdown";

type Props = {
  fromAgentName: string;
  toAgentName: string;
  content: string;
  status?: string;
};

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  succeeded: { label: "完成", variant: "default" },
  running: { label: "处理中", variant: "secondary" },
  failed: { label: "失败", variant: "destructive" },
  queued: { label: "排队中", variant: "outline" },
};

/**
 * Card showing an agent-to-agent @mention interaction.
 * Blue left border, source agent avatar, target agent badge, and markdown content.
 */
export function RoomAgentAtCard({
  fromAgentName,
  toAgentName,
  content,
  status,
}: Props) {
  const statusInfo = status ? STATUS_MAP[status] : null;
  const initial = fromAgentName.charAt(0).toUpperCase();

  return (
    <div className="mb-3 flex gap-2 pl-2">
      {/* Lightweight agent avatar */}
      <div className="bg-violet-600 flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white">
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-muted-foreground text-[11px]">{fromAgentName}</span>
          <Badge variant="secondary" className="text-[10px]">
            → @{toAgentName}
          </Badge>
          {statusInfo ? (
            <Badge variant={statusInfo.variant} className="text-[10px]">
              {statusInfo.label}
            </Badge>
          ) : null}
        </div>
        <div className="border-primary/20 bg-muted/80 rounded-xl border-l-[3px] px-3 py-2 text-sm">
          <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <Markdown>{content}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}
