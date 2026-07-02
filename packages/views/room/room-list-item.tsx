"use client";

import { cn } from "@multica/ui/lib/utils";
import { RoomGroupAvatar } from "./room-group-avatar";
import {
  buildRoomListSubtitle,
  formatRoomListTime,
  type RoomListMemberPreview,
} from "./room-list-utils";
import type { RoomSnapshot } from "@multica/core/types/room";

type Props = {
  name: string;
  description?: string;
  snapshot: RoomSnapshot;
  updatedAt?: string;
  members: RoomListMemberPreview[];
  active?: boolean;
  onClick: () => void;
};

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function RoomListItem({
  name,
  description,
  snapshot,
  updatedAt,
  members,
  active,
  onClick,
}: Props) {
  const subtitle = buildRoomListSubtitle(snapshot, description);
  const timeLabel = formatRoomListTime(
    snapshot.last_message_at ?? updatedAt,
  );
  const hasAttention =
    subtitle.tone === "danger" ||
    subtitle.tone === "mention" ||
    subtitle.badgeCount !== null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-border/50 hover:bg-muted/50 flex h-[68px] w-full items-center gap-3 border-b px-3 text-left transition-colors",
        active && "bg-accent hover:bg-accent",
      )}
    >
      <div className="relative shrink-0">
        <RoomGroupAvatar members={members} size={44} />
        {subtitle.badgeCount !== null && subtitle.badgeCount > 0 ? (
          <span
            className={cn(
              "absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white",
              subtitle.tone === "mention" ? "bg-brand" : "bg-destructive",
            )}
          >
            {formatBadgeCount(subtitle.badgeCount)}
          </span>
        ) : subtitle.tone === "active" ? (
          <span
            aria-hidden
            className="bg-amber-500 absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-background"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-[15px] leading-tight",
              hasAttention ? "font-semibold" : "font-medium",
            )}
          >
            {name}
          </p>
          {timeLabel ? (
            <time
              dateTime={updatedAt}
              className="text-muted-foreground shrink-0 text-[11px] tabular-nums"
            >
              {timeLabel}
            </time>
          ) : null}
        </div>
        <p
          className={cn(
            "mt-1 truncate text-xs leading-snug",
            subtitle.tone === "danger" && "text-destructive",
            subtitle.tone === "mention" && "text-brand",
            subtitle.tone === "active" && "text-foreground/80",
            subtitle.tone === "default" && "text-muted-foreground",
          )}
        >
          {subtitle.text}
        </p>
      </div>
    </button>
  );
}
