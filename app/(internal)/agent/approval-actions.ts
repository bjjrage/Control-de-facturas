// app/(internal)/agent/approval-actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { actorFromProfile } from "@/lib/agent/context";
import { decideApproval, getApproval } from "@/lib/agent/approvals";
import { executeApprovedTool } from "@/lib/agent/gateway";
import "@/lib/tools"; // auto-registro de todos los tools

export async function decideApprovalAction(params: {
  approvalId: string;
  decision: "APPROVED" | "REJECTED" | "CANCELLED";
}) {
  const profile = await requireProfile(["comercial", "admin"]);
  const supabase = await createClient();

  const approval = await decideApproval({
    db: supabase,
    approvalId: params.approvalId,
    empresaId: profile.empresa_id,
    decidedBy: profile.id,
    decision: params.decision,
  });

  return { error: null, approval };
}

export async function executeApprovalAction(params: {
  approvalId: string;
  payloadToExecute: unknown;
}) {
  const profile = await requireProfile(["comercial", "admin"]);
  const supabase = await createClient();

  const actor = actorFromProfile(profile);

  try {
    const result = await executeApprovedTool({
      db: supabase,
      actor,
      approvalId: params.approvalId,
      payloadToExecute: params.payloadToExecute,
    });

    return { error: null, result };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { error: errMsg, result: null };
  }
}
