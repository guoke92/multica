"use client";

import type { MentionInvocation } from "@multica/core/types/room";
import { RoomFlowTimeline } from "./room-flow-timeline";

type Props = {
  wsId: string;
  roomId: string;
  managerAgentId?: string;
  agentNameById: Map<string, string>;
  memberNameById?: Map<string, string>;
  invocations?: MentionInvocation[];
};

export function RoomWorkboardPanel({
  wsId,
  roomId,
  managerAgentId,
  agentNameById,
  memberNameById,
  invocations,
}: Props) {
  return (
    <div className="border-border shrink-0 border-t px-3 py-3">
      <h3 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
        流程动态
      </h3>
      <RoomFlowTimeline
        wsId={wsId}
        roomId={roomId}
        managerAgentId={managerAgentId}
        agentNameById={agentNameById}
        memberNameById={memberNameById}
        invocations={invocations}
      />
    </div>
  );
}
