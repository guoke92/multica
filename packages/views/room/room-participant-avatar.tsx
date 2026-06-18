"use client";

import { cn } from "@multica/ui/lib/utils";
import { useActorName } from "@multica/core/workspace/hooks";
import { useAgentPresenceDetail } from "@multica/core/agents";
import { useCurrentWorkspace } from "@multica/core/paths";
import { availabilityConfig } from "../agents/presence";

type TileProps = {
  name: string;
  isAgent?: boolean;
  size?: number;
  className?: string;
};

/** Square initials tile — matches the room member list avatar style. */
export function RoomParticipantAvatarTile({
  name,
  isAgent = false,
  size = 24,
  className,
}: TileProps) {
  return (
    <div
      data-slot="avatar"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-md font-medium",
        isAgent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      title={name}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

type Props = {
  actorType: "agent" | "member";
  actorId: string;
  size?: number;
  showStatusDot?: boolean;
  className?: string;
};

export function RoomParticipantAvatar({
  actorType,
  actorId,
  size = 24,
  showStatusDot,
  className,
}: Props) {
  const { getActorName } = useActorName();
  const name = getActorName(actorType, actorId);
  const isAgent = actorType === "agent";

  return (
    <span className="relative inline-flex">
      <RoomParticipantAvatarTile
        name={name}
        isAgent={isAgent}
        size={size}
        className={className}
      />
      {showStatusDot && isAgent ? (
        <RoomAgentPresenceDot agentId={actorId} size={size} />
      ) : null}
    </span>
  );
}

function RoomAgentPresenceDot({ agentId, size }: { agentId: string; size: number }) {
  const ws = useCurrentWorkspace();
  const detail = useAgentPresenceDetail(ws?.id, agentId);
  if (detail === "loading") return null;

  const { dotClass, label } = availabilityConfig[detail.availability];
  const dotSize = size >= 24 ? "size-2" : "size-1.5";

  return (
    <span
      aria-label={`Status: ${label}`}
      title={label}
      className={cn(
        "absolute -bottom-0.5 -right-0.5 rounded-full ring-1 ring-background",
        dotClass,
        dotSize,
      )}
    />
  );
}
