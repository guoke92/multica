"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { UnicodeSpinner } from "@multica/ui/components/common/unicode-spinner";
import { Markdown } from "../common/markdown";
import { stripWorkflowActionFooter } from "./room-utils";

const ACTIVE = new Set(["pending", "queued", "running", "delivered"]);
const FAILED = new Set(["failed", "timed_out", "cancelled"]);

type Props = {
  status: string;
  targetAgentName?: string;
  managerResponse?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
};

/**
 * Manager routing card: shows thinking state while the manager is processing,
 * then displays the routing result (→ 路由给 XXX) with an expandable details
 * section for the manager's full response.
 */
export function RoomRouteHint({
  status,
  targetAgentName,
  managerResponse,
  onRetry,
  isRetrying,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const isActive = ACTIVE.has(status);
  const isFailed = FAILED.has(status);
  const isSucceeded = status === "succeeded";

  // Clean the manager response (remove workflow_action JSON footer)
  const cleanResponse = managerResponse
    ? stripWorkflowActionFooter(managerResponse)
    : "";

  return (
    <div className="pl-10">
      <div className="max-w-[85%] space-y-0.5">
        {/* Main routing pill */}
        <div
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-[11px] font-medium ${
            isActive
              ? "bg-primary/10 text-primary"
              : isFailed
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary"
          }`}
        >
          {isActive ? (
            <>
              <UnicodeSpinner
                name="breathe"
                className="size-3 opacity-70"
              />
              <span className="animate-chat-text-shimmer">分配中</span>
            </>
          ) : isFailed ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-4"
                disabled={isRetrying || !onRetry}
                onClick={onRetry}
              >
                <RefreshCw
                  className={`size-3 ${isRetrying ? "animate-spin" : ""}`}
                />
              </Button>
              <span>路由失败</span>
            </>
          ) : (
            <>
              <ArrowUpRight className="size-3" />
              <span>
                路由给{" "}
                <span className="font-semibold">
                  {targetAgentName}
                </span>
              </span>
            </>
          )}
        </div>

        {/* Expandable manager response details */}
        {isSucceeded && cleanResponse ? (
          <div>
            <button
              type="button"
              className="text-muted-foreground/60 hover:text-muted-foreground inline-flex items-center gap-0.5 text-[10px] transition-colors"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
              <span>{expanded ? "收起详情" : "查看路由详情"}</span>
            </button>
            {expanded ? (
              <div className="border-muted-foreground/10 bg-muted/40 mt-1 max-h-60 overflow-y-auto rounded-lg border px-3 py-2">
                <div className="prose prose-xs dark:prose-invert max-w-none text-xs leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  <Markdown>{cleanResponse}</Markdown>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
