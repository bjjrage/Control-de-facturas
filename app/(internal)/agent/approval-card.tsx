"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { decideApprovalAction, executeApprovalAction } from "./approval-actions";

export interface ApprovalCardProps {
  approval: {
    id: string;
    tool_name: string;
    risk_level: number;
    status: string;
    payload_json: any;
    payload_hash: string;
    created_at: string;
  };
  onCompleted?: () => void;
}

export function ApprovalCard({ approval, onCompleted }: ApprovalCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(approval.status);

  const riskLabel =
    approval.risk_level === 3
      ? "Risk 3: Compromiso Financiero"
      : approval.risk_level === 2
      ? "Risk 2: Acción Externa"
      : `Risk ${approval.risk_level}`;

  const riskTone = approval.risk_level >= 3 ? "error" : "warn";

  async function handleApproveAndExecute() {
    if (loading) return; // double-click prevention
    setLoading(true);
    setError(null);

    try {
      // 1. Decidir APPROVED si aún está en REQUESTED
      if (status === "REQUESTED") {
        const dec = await decideApprovalAction({
          approvalId: approval.id,
          decision: "APPROVED",
        });
        if (dec.error) throw new Error(dec.error);
        setStatus("APPROVED");
      }

      // 2. Ejecutar tool aprobado
      const exec = await executeApprovalAction({
        approvalId: approval.id,
        payloadToExecute: approval.payload_json,
      });

      if (exec.error) {
        throw new Error(exec.error);
      }

      setStatus("EXECUTED");
      onCompleted?.();
    } catch (err: any) {
      setError(err.message || "Error al procesar la aprobación");
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const dec = await decideApprovalAction({
        approvalId: approval.id,
        decision: "REJECTED",
      });
      if (dec.error) throw new Error(dec.error);
      setStatus("REJECTED");
      onCompleted?.();
    } catch (err: any) {
      setError(err.message || "Error al rechazar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{approval.tool_name}</span>
          <Badge tone={riskTone}>{riskLabel}</Badge>
        </div>
        <Badge tone={status === "EXECUTED" ? "ok" : status === "REJECTED" ? "error" : "neutral"}>
          {status}
        </Badge>
      </div>

      <div className="bg-[var(--panel-2)] p-3 rounded text-xs font-mono max-h-48 overflow-y-auto border border-[var(--border)]">
        <div className="text-[var(--muted)] mb-1 text-[11px] font-sans">
          Snapshot Inmutable (Hash: {approval.payload_hash.slice(0, 12)}...):
        </div>
        <pre className="whitespace-pre-wrap break-all">
          {JSON.stringify(approval.payload_json, null, 2)}
        </pre>
      </div>

      {error && (
        <div className="text-xs text-[var(--error)] bg-[var(--error-bg)] p-2 rounded">
          {error}
        </div>
      )}

      {(status === "REQUESTED" || status === "APPROVED") && (
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
          <Button
            variant="secondary"
            disabled={loading}
            onClick={handleReject}
          >
            Rechazar
          </Button>
          <Button
            variant="primary"
            disabled={loading}
            onClick={handleApproveAndExecute}
          >
            {loading ? "Procesando..." : "Aprobar y Ejecutar"}
          </Button>
        </div>
      )}
    </div>
  );
}
