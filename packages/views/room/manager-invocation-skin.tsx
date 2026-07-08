"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Square } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { cn } from "@multica/ui/lib/utils";
import { UnicodeSpinner } from "@multica/ui/components/common/unicode-spinner";
import type { RoomManagerDecision } from "@multica/core/types/room";
import type { InvocationChatItem } from "./room-flow-utils";
import {
  buildManagerStatusText,
  deriveManagerScene,
} from "./room-presenters";
import {
  resolveManagerDecision,
  managerDecisionTargetAgentId,
} from "./room-flow-utils";
import { useElapsedSeconds } from "./room-elapsed-timer";

const SOFT_WARN_SECONDS = 90;

type Props = {
  items: InvocationChatItem[];
  agentNameById: Map<string, string>;
  decisions?: RoomManagerDecision[];
  onRetryAssignment?: (assignmentId: string) => void;
  onCancelAssignment?: (assignmentId: string) => void;
  retryingAssignmentId?: string | null;
  cancellingAssignmentId?: string | null;
};

/** Compact manager chip for the message action bar leading slot. */
export function ManagerStatusLeading(
  props: Omit<Props, "collapsible"> & { item: InvocationChatItem },
) {
  return (
    <ManagerInvocationItem
      {...props}
      item={props.item}
      size="inline"
      compactActions
    />
  );
}

function ManagerInvocationItem({
  item,
  agentNameById,
  decisions = [],
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
  size = "inline",
  compactActions = false,
}: Pick<
  Props,
  | "agentNameById"
  | "decisions"
  | "onRetryAssignment"
  | "onCancelAssignment"
  | "retryingAssignmentId"
  | "cancellingAssignmentId"
> & {
  item: InvocationChatItem;
  size?: "inline" | "card";
  compactActions?: boolean;
}) {
  const { invocation, assignment, phase } = item;
  const elapsed = useElapsedSeconds(invocation.id, invocation.created_at);
  const isSoftWarn =
    (phase === "running" || phase === "queued") &&
    elapsed !== null &&
    elapsed >= SOFT_WARN_SECONDS;

  const decision = resolveManagerDecision(decisions, {
    sourceMessageId: item.sourceMessageId,
    invocationId: invocation.id,
  });
  const outcome = invocation.outcome;
  const decisionTargetId = decision ? managerDecisionTargetAgentId(decision) : undefined;
  const targetName =
    (outcome && "target_agent_id" in outcome && outcome.target_agent_id
      ? agentNameById.get(outcome.target_agent_id) ?? "Agent"
      : undefined) ??
    (decisionTargetId ? agentNameById.get(decisionTargetId) ?? "Agent" : undefined);

  const showSpinner = phase === "running" || phase === "queued";
  const scene = deriveManagerScene({
    intent: invocation.intent,
    assignmentKind: assignment.kind,
    outcome,
    decision,
  });
  const label = buildManagerStatusText(scene, phase, outcome, targetName, decision);

  const tone =
    phase === "failed"
      ? "destructive"
      : phase === "cancelled"
        ? "muted"
        : isSoftWarn
          ? "warning"
          : "muted";

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1",
        size === "inline" ? "text-[10px] leading-none" : "rounded-lg border bg-card px-3 py-2 text-xs",
      )}
      data-manager-thread
      data-invocation-id={invocation.id}
      data-assignment-id={assignment.id}
      data-phase={phase}
    >
      {showSpinner ? <UnicodeSpinner name="breathe" className="size-2.5 opacity-70" /> : null}
      <span
        className={cn(
          "inline-flex items-center gap-1",
          tone === "destructive" && "text-destructive",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        <span className={cn(showSpinner && !isSoftWarn && "animate-chat-text-shimmer")}>{label}</span>
        {elapsed !== null && showSpinner ? (
          <span className="opacity-70 tabular-nums">· {elapsed}s</span>
        ) : null}
      </span>
      {!compactActions &&
      outcome &&
      "conclusion" in outcome &&
      outcome.conclusion ? (
        <span className="text-muted-foreground line-clamp-1 max-w-[20rem]">{outcome.conclusion}</span>
      ) : null}
      <ManagerActionButtons
        item={item}
        onRetryAssignment={onRetryAssignment}
        onCancelAssignment={onCancelAssignment}
        retryingAssignmentId={retryingAssignmentId}
        cancellingAssignmentId={cancellingAssignmentId}
        compact={compactActions}
      />
    </div>
  );
}

function ManagerActionButtons({
  item,
  onRetryAssignment,
  onCancelAssignment,
  retryingAssignmentId,
  cancellingAssignmentId,
  compact = false,
}: Pick<Props, "onRetryAssignment" | "onCancelAssignment" | "retryingAssignmentId" | "cancellingAssignmentId"> & {
  item: InvocationChatItem;
  compact?: boolean;
}) {
  const { assignment, phase } = item;
  const isRetrying = retryingAssignmentId === assignment.id;
  const isCancelling = cancellingAssignmentId === assignment.id;
  const btnClass = compact
    ? "text-muted-foreground hover:text-foreground h-5 px-1 text-[10px]"
    : undefined;

  if ((phase === "failed" || phase === "cancelled") && onRetryAssignment) {
    return (
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className={cn(
          "text-destructive hover:text-destructive h-5 px-1.5 text-[11px]",
          btnClass,
        )}
        disabled={isRetrying}
        onClick={() => onRetryAssignment(assignment.id)}
      >
        <RefreshCw className={cn("mr-1 size-3", isRetrying && "animate-spin")} />
        {isRetrying ? "重试中…" : "重试"}
      </Button>
    );
  }

  if ((phase === "running" || phase === "queued") && onCancelAssignment) {
    return (
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className={cn(
          "text-muted-foreground hover:text-foreground h-5 px-1.5 text-[11px]",
          btnClass,
        )}
        disabled={isCancelling}
        onClick={() => onCancelAssignment(assignment.id)}
      >
        <Square className={cn(compact ? "size-2.5" : "mr-1 size-3")} />
        {!compact ? (isCancelling ? "停止中…" : "停止") : null}
      </Button>
    );
  }

  return null;
}

export function ManagerHistoryFold(props: Props & { items: InvocationChatItem[] }) {
  const { items } = props;
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] transition-colors">
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span>历史处理 ({items.length})</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1">
        {items.map((item) => (
          <ManagerInvocationItem key={item.invocation.id} {...props} item={item} size="card" />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
