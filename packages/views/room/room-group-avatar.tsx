"use client";

import type { CSSProperties } from "react";
import { cn } from "@multica/ui/lib/utils";
import { MessageSquare } from "lucide-react";
import type { RoomListMemberPreview } from "./room-list-utils";

type Props = {
  members: RoomListMemberPreview[];
  size?: number;
  className?: string;
};

function MemberTile({
  name,
  isAgent,
  className,
  style,
}: {
  name: string;
  isAgent: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-[3px] font-medium leading-none",
        isAgent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        className,
      )}
      style={style}
      title={name}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** WeCom-style composite group avatar from member initials. */
export function RoomGroupAvatar({ members, size = 44, className }: Props) {
  if (members.length === 0) {
    return (
      <div
        className={cn(
          "bg-muted text-muted-foreground flex items-center justify-center rounded-md",
          className,
        )}
        style={{ width: size, height: size }}
      >
        <MessageSquare className="size-5 opacity-60" />
      </div>
    );
  }

  if (members.length === 1) {
    const member = members[0]!;
    return (
      <MemberTile
        name={member.name}
        isAgent={member.isAgent}
        className={cn("rounded-md", className)}
        style={{ width: size, height: size, fontSize: size * 0.38 }}
      />
    );
  }

  const gap = 2;
  const cell = Math.floor((size - gap) / 2);

  return (
    <div
      className={cn("bg-muted/40 grid grid-cols-2 gap-0.5 rounded-md p-0.5", className)}
      style={{ width: size, height: size }}
    >
      {members.slice(0, 4).map((member) => (
        <MemberTile
          key={member.id}
          name={member.name}
          isAgent={member.isAgent}
          className="min-h-0 min-w-0"
          style={{ width: cell, height: cell, fontSize: cell * 0.42 }}
        />
      ))}
    </div>
  );
}
