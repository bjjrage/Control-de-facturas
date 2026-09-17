import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  deriveRodrigoState,
  getRodrigoStatePresentation,
  isWorkingTaskStatus,
  type RodrigoTaskSnapshot,
} from "@/lib/agent/rodrigo-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AgentTaskStatusRow = {
  status: string;
  updated_at: string | null;
  completed_at: string | null;
};

type AgentApprovalPendingRow = {
  id: string;
  tool_name: string;
  created_at: string;
};

export type RodrigoPendingApproval = {
  id: string;
  toolName: string;
  createdAt: string;
};

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function disabledBody() {
  const presentation = getRodrigoStatePresentation("disabled");
  return noStoreJson({
    state: "disabled",
    activeTaskCount: 0,
    pendingApprovals: [],
    updatedAt: null,
    label: presentation.label,
    description: presentation.description,
  });
}

/**
 * Read-only status projection for the global Rodrigo widget.
 *
 * It intentionally uses the session-bound client (never service_role) and
 * scopes by the authenticated tenant in addition to RLS. Minimizing the
 * panel never cancels tasks: this endpoint only reads durable state.
 */
export async function GET() {
  let empresaId: string;
  try {
    const profile = await requireProfile();
    if (!profile?.empresa_id) return noStoreJson({ error: "Unauthorized" }, 401);
    empresaId = profile.empresa_id;
  } catch {
    return noStoreJson({ error: "Unauthorized" }, 401);
  }

  const db = await createClient();
  const { data, error } = await db
    .from("agent_tasks")
    .select("status, updated_at, completed_at")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    // A deployment that has not received the Agent Life migration must render
    // a disabled mascot rather than fail the entire authenticated shell.
    return disabledBody();
  }

  const approvalsQuery = await db
    .from("agent_approvals")
    .select("id, tool_name, created_at")
    .eq("empresa_id", empresaId)
    .eq("status", "REQUESTED")
    .order("created_at", { ascending: true })
    .limit(10);

  const tasks: RodrigoTaskSnapshot[] = ((data ?? []) as AgentTaskStatusRow[]).map((task) => ({
    status: task.status,
    updatedAt: task.updated_at,
    completedAt: task.completed_at,
  }));
  const state = deriveRodrigoState(tasks);
  const presentation = getRodrigoStatePresentation(state);
  const pendingApprovals: RodrigoPendingApproval[] = approvalsQuery.error
    ? []
    : (((approvalsQuery.data ?? []) as AgentApprovalPendingRow[]).map((row) => ({
        id: row.id,
        toolName: row.tool_name,
        createdAt: row.created_at,
      })));

  return noStoreJson({
    state,
    activeTaskCount: tasks.filter((task) => isWorkingTaskStatus(task.status)).length,
    pendingApprovals,
    updatedAt: tasks[0]?.updatedAt ?? null,
    label: presentation.label,
    description: presentation.description,
  });
}
