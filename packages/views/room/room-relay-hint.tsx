"use client";

import { ArrowRightLeft } from "lucide-react";

type Props = {
  fromAgentName: string;
  toAgentName: string;
  reason?: string;
};

/**
 * Dashed-border pill showing a relay handoff from one agent to another.
 * Sits between two invocation slots in the chat timeline.
 */
export function RoomRelayHint({ fromAgentName, toAgentName, reason }: Props) {
  return (
    <div className="mb-1.5">
      <span className="border-muted-foreground/30 bg-muted/50 text-muted-foreground inline-flex items-center gap-1.5 rounded-xl border border-dashed px-3 py-1 text-[11px]">
        <ArrowRightLeft className="size-3 shrink-0" />
        <span className="font-medium">{fromAgentName}</span>
        <span>→</span>
        <span className="font-medium">{toAgentName}</span>
        {reason ? (
          <span className="text-muted-foreground/70 italic">"{reason}"</span>
        ) : null}
      </span>
    </div>
  );
}
