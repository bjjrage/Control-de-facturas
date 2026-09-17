import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
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

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

/**
 * Read-only status projection for the global Rodrigo widget.
 *
 * It intentionally uses the session-bound client (never service_role) and
 * scopes by the authenticated tenant in addition to RLS.
 */
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile?.empresa_id) {
    return noStoreJson({ error: "Unauthorized" }, 401);
  }

  const db = await createClient();
  const { data, error } = await db
    .from("agent_tasks")
    .select("status, updated_at, completed_at")
    .eq("empresa_id", profile.empresa_id)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    // A deployment that has not received the Agent Life migration must render
    // a disabled mascot rather than fail the entire authenticated shell.
    const presentation = getRodrigoStatePresentation("disabled");
    return noStoreJson({
      state: "disabled",
      activeTaskCount: 0,
      updatedAt: null,
      label: presentation.label,
      description: presentation.description,
    });
  }

  const tasks: RodrigoTaskSnapshot[] = ((data ?? []) as AgentTaskStatusRow[]).map((task) => ({
    status: task.status,
    updatedAt: task.updated_at,
    completedAt: task.completed_at,
  }));
  const state = deriveRodrigoState(tasks);
  const presentation = getRodrigoStatePresentation(state);

  return noStoreJson({
    state,
    activeTaskCount: tasks.filter((task) => isWorkingTaskStatus(task.status)).length,
    updatedAt: tasks[0]?.updatedAt ?? null,
    label: presentation.label,
    description: presentation.description,
  });
}
