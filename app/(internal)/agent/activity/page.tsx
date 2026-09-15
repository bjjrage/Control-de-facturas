// app/(internal)/agent/activity/page.tsx
// BATCH 6 — Activity Center. Lee solo tablas del agente. Sin DB paralela.

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { cancelAgentTaskAction } from "./actions";

type TaskRow = {
  id: string;
  type: string;
  status: string;
  project_id: string | null;
  context_json: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

async function getTasks(empresaId: string): Promise<TaskRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_tasks")
    .select("id, type, status, project_id, context_json, error_message, created_at, updated_at")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(100);
  return ((data ?? []) as TaskRow[]);
}

function objectiveOf(task: TaskRow): string {
  const ctx = task.context_json ?? {};
  if (typeof ctx.objective === "string" && ctx.objective) return ctx.objective;
  if (typeof ctx.user_intent === "string" && ctx.user_intent) return ctx.user_intent;
  return task.type;
}

export default async function AgentActivityPage() {
  const profile = await requireProfile();
  const tasks = await getTasks(profile.empresa_id);

  const needsAttention = tasks.filter((t) => t.status === "WAITING_APPROVAL" || t.status === "FAILED");
  const working = tasks.filter((t) =>
    ["PENDING", "RUNNING", "WAITING_EXTERNAL", "SCHEDULED"].includes(t.status)
  );
  const done = tasks.filter((t) => ["COMPLETED", "CANCELLED"].includes(t.status));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-lg font-semibold">Agente</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Necesita tu atención</h2>
        {needsAttention.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nada pendiente.</p>
        ) : (
          needsAttention.map((t) => (
            <div key={t.id} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
              <div className="text-sm font-semibold">
                {t.status === "WAITING_APPROVAL" ? "[!] Aprobación pendiente" : "[!] Falló, revisar"}
              </div>
              <div className="text-sm">{objectiveOf(t)}</div>
              {t.error_message ? <div className="text-xs text-[var(--error)]">{t.error_message}</div> : null}
              <form action={cancelAgentTaskAction.bind(null, { taskId: t.id })}>
                <button type="submit" className="mt-2 text-xs underline">
                  Cancelar tarea
                </button>
              </form>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Trabajando</h2>
        {working.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Sin tareas activas.</p>
        ) : (
          working.map((t) => (
            <div key={t.id} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
              <div className="text-sm font-semibold">[•] {t.status}</div>
              <div className="text-sm">{objectiveOf(t)}</div>
              <form action={cancelAgentTaskAction.bind(null, { taskId: t.id })}>
                <button type="submit" className="mt-2 text-xs underline">
                  Cancelar tarea
                </button>
              </form>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Completado</h2>
        {done.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Sin historial reciente.</p>
        ) : (
          done.map((t) => (
            <div key={t.id} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
              <div className="text-sm font-semibold">{t.status === "COMPLETED" ? "[✓]" : "[×]"} {t.status}</div>
              <div className="text-sm">{objectiveOf(t)}</div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
