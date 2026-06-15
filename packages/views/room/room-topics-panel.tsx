"use client";

import { useQuery } from "@tanstack/react-query";
import { roomTopicsOptions } from "@multica/core/room/queries";

type Props = {
  wsId: string;
  roomId: string;
};

export function RoomTopicsPanel({ wsId, roomId }: Props) {
  const { data: topics = [] } = useQuery(roomTopicsOptions(wsId, roomId));

  return (
    <div className="border-border space-y-1 border-t px-3 py-3">
      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        话题
      </h3>
      {topics.length === 0 ? (
        <p className="text-muted-foreground text-xs">暂无话题</p>
      ) : (
        <ul className="space-y-1">
          {topics.map((t) => (
            <li key={t.id} className="text-sm">
              <span>{t.title}</span>
              <span className="text-muted-foreground ml-2 text-xs">{t.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
