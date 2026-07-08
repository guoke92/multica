import type { RoomInvocationOutcome, RoomManagerDecision } from "@multica/core/types/room";
import type { UserVisiblePhase } from "./room-flow-utils";

export type ManagerLabelContext = {
  intent?: string;
  assignmentKind?: string;
  outcome?: RoomInvocationOutcome;
  decision?: RoomManagerDecision;
};

/** Unified manager scene label for chat action bar and flow timeline. */
export function deriveManagerScene(ctx: ManagerLabelContext): string {
  const { intent, assignmentKind, outcome, decision } = ctx;

  if (decision?.action === "assign") {
    const relayTo = decision.payload?.relay_to;
    if (typeof relayTo === "string" && relayTo.trim()) return "转派";
    return "指派";
  }
  if (decision?.action === "complete" || decision?.action === "ask_user") return "审核";
  if (decision?.action === "retry") return "指派";
  if (decision?.action === "reassign") return "指派";

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

  if (assignmentKind === "auto_review" && intent?.trim() === "review") {
    return "审核";
  }

  return "指派";
}

/** True when assign decision actually created downstream work. */
export function managerAssignDispatched(
  decision?: RoomManagerDecision,
  outcome?: RoomInvocationOutcome,
): boolean {
  if ((decision?.created_assignment_ids?.length ?? 0) > 0) return true;
  const type = outcome?.type;
  if (type === "dispatch" || type === "relay" || type === "reassign") {
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
  outcome: RoomInvocationOutcome | undefined,
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

/** Compact bar label: `{scene}·{status}`. */
export function buildManagerStatusText(
  scene: string,
  phase: UserVisiblePhase,
  outcome: RoomInvocationOutcome | undefined,
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
