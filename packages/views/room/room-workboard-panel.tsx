"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { roomWorkboardOptions } from "@multica/core/room/queries";
import { RoomFlowTimeline } from "./room-flow-timeline";
import { cn } from "@multica/ui/lib/utils";

type Props = {
  wsId: string;
  roomId: string;
  selectedTopicId?: string;
  onSelectTopic?: (topicId: string) => void;
};

export function RoomWorkboardPanel({
  wsId,
  roomId,
  selectedTopicId,
  onSelectTopic,
}: Props) {
  const { data } = useQuery(roomWorkboardOptions(wsId, roomId));
  const summaries = data?.topic_summaries ?? [];
  const activeTopicId = selectedTopicId ?? data?.active_topic_id;

  const counts = useMemo(
    () => ({
      pending: data?.pending_count ?? 0,
      queued: data?.queued_count ?? 0,
      running: data?.running_count ?? 0,
      failed: data?.failed_count ?? 0,
    }),
    [data],
  );

  return (
    <div className="border-border shrink-0 space-y-3 border-t px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          工作看板
        </h3>
        <div className="text-muted-foreground flex flex-wrap justify-end gap-x-2 gap-y-0.5 text-[10px]">
          <span>待处理 {counts.pending}</span>
          {counts.queued > 0 ? <span>排队 {counts.queued}</span> : null}
          <span>运行中 {counts.running}</span>
          {counts.failed > 0 ? <span>失败 {counts.failed}</span> : null}
        </div>
      </div>

      {summaries.length > 0 ? (
        <ul className="max-h-28 space-y-1 overflow-y-auto">
          {summaries.map((topic) => (
            <li key={topic.id}>
              <button
                type="button"
                className={cn(
                  "hover:bg-muted/60 w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                  activeTopicId === topic.id && "border-primary bg-muted/40",
                )}
                onClick={() => onSelectTopic?.(topic.id)}
              >
                <p className="truncate font-medium">{topic.title || "未命名话题"}</p>
                <p className="text-muted-foreground mt-0.5 truncate text-[10px]">
                  {topic.status} · {topic.event_count} 事件
                </p>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">暂无进行中的话题</p>
      )}

      <div>
        <h4 className="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wide">
          流程动态
        </h4>
        <RoomFlowTimeline wsId={wsId} roomId={roomId} topicId={activeTopicId} />
      </div>
    </div>
  );
}
