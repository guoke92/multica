"use client";

import { useState } from "react";
import { Button } from "@multica/ui/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { useWorkspaceId } from "@multica/core/hooks";
import { api } from "@multica/core/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { roomKeys } from "@multica/core/room/queries";
import { toast } from "sonner";

type Props = {
  roomId: string;
  humanActionId?: string;
  /** @deprecated legacy approval_request id */
  approvalId?: string;
  actionType?: string;
};

type PendingDecision = "approved" | "rejected" | null;

export function ApprovalCard({
  roomId,
  humanActionId,
  approvalId,
  actionType,
}: Props) {
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const [pendingDecision, setPendingDecision] = useState<PendingDecision>(null);
  const [rejectReason, setRejectReason] = useState("");

  const decide = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      if (humanActionId) {
        return api.decideRoomHumanAction(roomId, humanActionId, {
          decision,
          reject_reason: decision === "rejected" ? rejectReason : undefined,
        });
      }
      if (approvalId) {
        return api.decideApproval(approvalId, {
          decision,
          reject_reason: decision === "rejected" ? rejectReason : undefined,
        });
      }
      throw new Error("missing action id");
    },
    onSuccess: (_data, decision) => {
      if (wsId) {
        void qc.invalidateQueries({ queryKey: roomKeys.messages(wsId, roomId) });
        void qc.invalidateQueries({ queryKey: roomKeys.invocations(wsId, roomId) });
        void qc.invalidateQueries({ queryKey: roomKeys.workboard(wsId, roomId) });
      }
      setPendingDecision(null);
      setRejectReason("");
      toast.success(decision === "approved" ? "已批准" : "已拒绝");
    },
    onError: (err) => {
      setPendingDecision(null);
      toast.error(
        err instanceof Error && err.message ? err.message : "审批操作失败",
      );
    },
  });

  const handleConfirm = () => {
    if (!pendingDecision) return;
    if (pendingDecision === "rejected" && !rejectReason.trim()) {
      toast.error("请填写拒绝原因");
      return;
    }
    decide.mutate(pendingDecision);
  };

  return (
    <>
      <div className="border-border bg-background flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {actionType ? `待确认：${actionType}` : "需要人工确认"}
        </span>
        <Button
          size="sm"
          disabled={decide.isPending}
          onClick={() => setPendingDecision("approved")}
        >
          批准
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={decide.isPending}
          onClick={() => setPendingDecision("rejected")}
        >
          拒绝
        </Button>
      </div>

      {pendingDecision ? (
        <AlertDialog open onOpenChange={() => setPendingDecision(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingDecision === "approved" ? "确认批准？" : "确认拒绝？"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDecision === "rejected"
                  ? "拒绝后须填写原因，结果会写入流程动态。"
                  : "批准后将继续执行后续流程。"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {pendingDecision === "rejected" ? (
              <textarea
                className="border-input bg-background min-h-[80px] w-full rounded-md border px-3 py-2 text-sm"
                placeholder="拒绝原因（必填）"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={decide.isPending}>取消</AlertDialogCancel>
              <AlertDialogAction disabled={decide.isPending} onClick={handleConfirm}>
                确认
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
