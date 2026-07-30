"use client";

import { useMemo, useState } from "react";
import type { RoomHumanInteraction } from "@multica/core/types/room";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { cn } from "@multica/ui/lib/utils";
import { Bot, Check, X } from "lucide-react";

type Props = {
  interactions: RoomHumanInteraction[];
  managerAgentName?: string;
  onDismiss: (interactionId: string) => void;
  onRespond: (data: {
    interactionId: string;
    option_id?: string;
    response_text?: string;
    approved?: boolean;
    reject_reason?: string;
  }) => void;
  isResponding?: boolean;
  dismissingId?: string | null;
};

function interactionTitle(
  item: RoomHumanInteraction,
  managerAgentName?: string,
): string {
  if (item.title) return item.title;
  if (item.created_by_type === "agent") {
    return managerAgentName ?? "群管理";
  }
  return "协作群";
}

export function RoomInteractionDock({
  interactions,
  managerAgentName,
  onDismiss,
  onRespond,
  isResponding,
  dismissingId,
}: Props) {
  const pending = useMemo(
    () => interactions.filter((i) => i.status === "pending"),
    [interactions],
  );
  if (pending.length === 0) return null;

  return (
    <div className="shrink-0 px-5 pb-2 pt-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5">
        {pending.map((item) => (
          <InteractionCard
            key={item.id}
            item={item}
            title={interactionTitle(item, managerAgentName)}
            onDismiss={onDismiss}
            onRespond={onRespond}
            isResponding={isResponding}
            isDismissing={dismissingId === item.id}
          />
        ))}
      </div>
    </div>
  );
}

function InteractionCard({
  item,
  title,
  onDismiss,
  onRespond,
  isResponding,
  isDismissing,
}: {
  item: RoomHumanInteraction;
  title: string;
  onDismiss: Props["onDismiss"];
  onRespond: Props["onRespond"];
  isResponding?: boolean;
  isDismissing?: boolean;
}) {
  const [customText, setCustomText] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const options = item.options ?? [];
  const busy = isResponding === true || isDismissing === true;

  if (item.kind === "notify") {
    return (
      <div
        className={cn(
          "border-border/80 bg-muted/25 flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
        )}
      >
        <div className="bg-primary/10 text-primary flex size-4 shrink-0 items-center justify-center rounded-full">
          <Bot className="size-2.5" />
        </div>
        <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs leading-none">
          <span className="text-foreground font-medium">{title}</span>
          <span aria-hidden="true"> · </span>
          {item.body}
        </p>
        <Button
          size="sm"
          className="h-6 shrink-0 px-2 text-[11px]"
          onClick={() => onDismiss(item.id)}
          disabled={busy}
        >
          知道了
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border-border/80 bg-muted/25 rounded-lg border px-3 py-2",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="bg-primary/10 text-primary mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
          <Bot className="size-3" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium leading-none">{title}</div>
          <p className="text-muted-foreground mt-1 text-xs leading-snug whitespace-pre-wrap">
            {item.body}
          </p>
        </div>
      </div>

      {item.kind === "approve" ? (
        <div className="mt-2 flex flex-col gap-1.5 pl-7">
          {showReject ? (
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="拒绝原因（可选）"
              disabled={busy}
              className="h-8 text-xs"
            />
          ) : null}
          <div className="flex flex-wrap justify-end gap-1.5">
            {!showReject ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                onClick={() => setShowReject(true)}
                disabled={busy}
              >
                <X className="size-3" />
                拒绝
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  onRespond({
                    interactionId: item.id,
                    approved: false,
                    reject_reason: rejectReason.trim() || undefined,
                  });
                  setShowReject(false);
                  setRejectReason("");
                }}
                disabled={busy}
              >
                确认拒绝
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() =>
                onRespond({ interactionId: item.id, approved: true })
              }
              disabled={busy}
            >
              <Check className="size-3" />
              批准
            </Button>
          </div>
        </div>
      ) : null}

      {(item.kind === "ask" || item.kind === "confirm") && options.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5 pl-7">
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt) => (
              <Button
                key={opt.id}
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                disabled={busy}
                onClick={() =>
                  onRespond({ interactionId: item.id, option_id: opt.id })
                }
              >
                {opt.label}
              </Button>
            ))}
          </div>
          {item.allow_custom_response === true ? (
            <div className="flex gap-1.5">
              <Input
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="或输入自定义回复…"
                disabled={busy}
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const text = customText.trim();
                    if (!text) return;
                    onRespond({
                      interactionId: item.id,
                      response_text: text,
                    });
                    setCustomText("");
                  }
                }}
              />
              <Button
                size="sm"
                className="h-8 px-2.5 text-xs"
                disabled={busy || customText.trim() === ""}
                onClick={() => {
                  const text = customText.trim();
                  if (!text) return;
                  onRespond({
                    interactionId: item.id,
                    response_text: text,
                  });
                  setCustomText("");
                }}
              >
                发送
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
