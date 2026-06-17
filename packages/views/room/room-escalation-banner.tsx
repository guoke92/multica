"use client";

import { AlertTriangle } from "lucide-react";

type Props = {
  title: string;
  detail?: string;
};

/** v2.3: escalation banner at quote-chain root — not a centered system wall. */
export function RoomEscalationBanner({ title, detail }: Props) {
  return (
    <div className="pl-10">
      <div className="border-destructive/20 bg-destructive/5 flex max-w-[85%] items-start gap-2 rounded-xl border px-3 py-2">
        <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 text-sm">
          <p className="text-destructive font-medium">{title}</p>
          {detail ? (
            <p className="text-muted-foreground mt-0.5 text-xs">{detail}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
