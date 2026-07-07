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
import type { InvocationChatItem, UserVisiblePhase } from "./room-flow-utils";
import {
  latestManagerDecisionForMessage,
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
  collapsible?: boolean;
};

export function ManagerInvocationSkin(props: Props) {
  const { items, collapsible = true } = props;
  const latest = items[0];
  const older = items.slice(1);
  if (!latest) return null;

  return (
    <div className="flex flex-col gap-1" data-manager-thread>
      <ManagerInvocationItem {...props} item={latest} size="inline" />
      {collapsible && older.length > 0 ? <ManagerHistoryFold {...props} items={older} /> : null}
    </div>
  );
}

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

  const decision = latestManagerDecisionForMessage(
    decisions,
    item.sourceMessageId,
    invocation.id,
  );
  const outcome = invocation.outcome;
  const decisionTargetId = decision ? managerDecisionTargetAgentId(decision) : undefined;
  const targetName =
    (outcome && "target_agent_id" in outcome && outcome.target_agent_id
      ? agentNameById.get(outcome.target_agent_id) ?? "Agent"
      : undefined) ??
    (decisionTargetId ? agentNameById.get(decisionTargetId) ?? "Agent" : undefined);

  const displayPhase =
    decision?.action === "assign" &&
    targetName &&
    managerAssignDispatched(decision, outcome)
      ? ("succeeded" as UserVisiblePhase)
      : (phase === "failed" || phase === "cancelled") &&
          decision?.action === "assign" &&
          targetName
        ? ("succeeded" as UserVisiblePhase)
        : phase;

  const showSpinner = displayPhase === "running" || displayPhase === "queued";
  const scene = resolveManagerScene(
    invocation.intent,
    assignment.kind,
    outcome,
    decision,
  );
  const label = buildManagerStatusText(scene, displayPhase, outcome, targetName, decision);

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

/** Scene label for manager invocations — intent/outcome/decision first. */
export function resolveManagerScene(
  intent?: string,
  assignmentKind?: string,
  outcome?: InvocationChatItem["invocation"]["outcome"],
  decision?: RoomManagerDecision,
): string {
  if (decision?.action === "assign") return "指派";
  if (decision?.action === "complete" || decision?.action === "ask_user") return "审核";

  switch (intent?.trim()) {
    case "route":
    case "orchestrate":
      return "指派";
    case "review":
      return "审核";
    case "confirm":
      return "确认";
    case "escalate":
      return "升级";
    default:
      break;
  }
  const outcomeType = outcome?.type;
  if (
    outcomeType === "dispatch" ||
    outcomeType === "relay" ||
    outcomeType === "reassign"
  ) {
    return "指派";
  }
  if (
    outcomeType === "review_complete" ||
    outcomeType === "ask_user" ||
    outcomeType === "wait"
  ) {
    return "审核";
  }
  // User-side routing also uses kind=auto_review; default to 指派 unless intent=review.
  if (assignmentKind === "auto_review" && intent?.trim() === "review") {
    return "审核";
  }
  return "指派";
}

/** True when assign decision actually created downstream work (sidebar agrees). */
export function managerAssignDispatched(
  decision?: RoomManagerDecision,
  outcome?: InvocationChatItem["invocation"]["outcome"],
): boolean {
  if ((decision?.created_assignment_ids?.length ?? 0) > 0) return true;
  const type = outcome?.type;
  if (
    type === "dispatch" ||
    type === "relay" ||
    type === "reassign"
  ) {
    return true;
  }
  if (
    decision?.action === "assign" &&
    outcome &&
    typeof outcome === "object" &&
    "target_agent_id" in outcome &&
    outcome.target_agent_id
  ) {
    return true;
  }
  return false;
}

function buildManagerStatusPart(
  phase: UserVisiblePhase,
  outcome: InvocationChatItem["invocation"]["outcome"],
  targetName?: string,
  decision?: RoomManagerDecision,
): string {
  if (
    decision?.action === "assign" &&
    targetName &&
    managerAssignDispatched(decision, outcome)
  ) {
    return targetName;
  }

  if (phase === "running") return "思考中";
  if (phase === "queued") return "排队中";
  if (phase === "cancelled") return "已取消";
  if (phase === "failed") return "失败";
  if (phase === "waiting_user") return "处理完成,待人工确认";

  if (!outcome || typeof outcome !== "object") {
    if (decision?.action === "assign" && targetName) return targetName;
    return "处理完成";
  }

  if ("target_agent_id" in outcome && outcome.target_agent_id) {
    return targetName ?? "Agent";
  }

  switch (outcome.type) {
    case "review_complete":
      return "处理完成";
    case "ask_user":
      return "处理完成,待人工确认";
    case "wait":
      return "等待中";
    case "skip":
      return "已跳过";
    case "retry":
      return "已重试";
    case "failed":
      return "失败";
    default:
      return "处理完成";
  }
}

/** Compact bar label: `{scene}·{status}` without the legacy 群管 prefix. */
export function buildManagerStatusText(
  scene: string,
  phase: UserVisiblePhase,
  outcome: InvocationChatItem["invocation"]["outcome"],
  targetName?: string,
  decision?: RoomManagerDecision,
): string {
  if (
    decision?.action === "assign" &&
    targetName &&
    managerAssignDispatched(decision, outcome)
  ) {
    return `${scene}·${targetName}`;
  }
  if (
    (phase === "failed" || phase === "cancelled") &&
    decision?.action === "assign" &&
    targetName
  ) {
    return `${scene}·${targetName}`;
  }
  return `${scene}·${buildManagerStatusPart(phase, outcome, targetName, decision)}`;
}
