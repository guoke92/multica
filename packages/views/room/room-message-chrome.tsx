"use client";

import type { ReactNode } from "react";
import { Button } from "@multica/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { cn } from "@multica/ui/lib/utils";
import type { LucideIcon } from "lucide-react";

/** Bubble + action bar share one column; track width = max(bubble, bar content). */
export function MessageBubbleAnchor({
  align,
  children,
}: {
  align: "start" | "end";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid max-w-[80%] grid-cols-1 gap-0.5",
        align === "end" ? "ml-auto justify-items-end" : "justify-items-start",
      )}
      data-message-anchor
    >
      {children}
    </div>
  );
}

export function MessageActionBar({
  children,
  leading,
}: {
  children: ReactNode;
  leading?: ReactNode;
}) {
  if (!leading && !children) return null;

  return (
    <div className="flex w-full min-w-0 min-h-5 items-center justify-between gap-1.5">
      {leading ? (
        <div className="min-w-0 shrink">{leading}</div>
      ) : (
        <span className="sr-only" aria-hidden />
      )}
      {children ? (
        <div
          className={cn(
            "flex shrink-0 gap-0.5",
            !leading && "opacity-0 transition group-hover:opacity-100",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function ActionIconButton({
  label,
  onClick,
  disabled,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon: LucideIcon;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground/70 hover:text-foreground h-6 w-6"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
