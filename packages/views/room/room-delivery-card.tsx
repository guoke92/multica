"use client";

import type { RoomMessage } from "@multica/core/types/room";
import { Badge } from "@multica/ui/components/ui/badge";

type ChecklistItem = {
  phase_key?: string;
  title?: string;
  status?: string;
};

type ChainItem = {
  agent_name?: string;
  status?: string;
};

type CardMeta = {
  status?: string;
  current_phase?: string;
  checklist?: ChecklistItem[];
  chain?: ChainItem[];
};

function parseMeta(metadata?: Record<string, unknown>): CardMeta {
  if (!metadata || typeof metadata !== "object") return {};
  return metadata as CardMeta;
}

type Props = {
  message: RoomMessage;
};

export function RoomDeliveryCard({ message }: Props) {
  const meta = parseMeta(message.metadata);
  const checklist = meta.checklist ?? [];
  const chain = meta.chain ?? [];

  return (
    <div className="border-border bg-card w-full max-w-lg rounded-lg border p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{message.content || "阶段摘要"}</span>
        {meta.status ? (
          <Badge variant="secondary">{meta.status}</Badge>
        ) : null}
      </div>
      {chain.length > 0 ? (
        <ul className="space-y-1.5">
          {chain.map((item, i) => (
            <li
              key={`${item.agent_name}-${i}`}
              className="flex items-center gap-2 text-sm"
              style={{ paddingLeft: i * 8 }}
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{
                  background:
                    item.status === "succeeded" || item.status === "完成"
                      ? "var(--color-green-500, #22c55e)"
                      : item.status === "running" || item.status === "执行中"
                        ? "var(--color-amber-500, #f59e0b)"
                        : "var(--color-muted-foreground, #6b7280)",
                }}
              />
              <span>{item.agent_name ?? "Agent"}</span>
              <span className="text-muted-foreground ml-auto text-xs">
                {item.status ?? "pending"}
              </span>
            </li>
          ))}
        </ul>
      ) : checklist.length > 0 ? (
        <ul className="space-y-1.5">
          {checklist.map((item) => (
            <li
              key={item.phase_key ?? item.title}
              className="flex items-center justify-between text-sm"
            >
              <span>{item.title ?? item.phase_key}</span>
              <span className="text-muted-foreground text-xs">
                {item.status ?? "pending"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">暂无任务信息</p>
      )}
    </div>
  );
}
