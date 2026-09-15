// scripts/agent-worker.ts
// BATCH 6 — Worker stateless de tareas durables.
// Un ciclo: leases expirados -> timers vencidos -> eventos sin procesar ->
// reintentos vencidos -> resumeTask -> AgentOrchestrator -> próximo estado.
// Todo durable en DB. El proceso puede morir; las tasks sobreviven.
//
// Uso:
//   npx tsx scripts/agent-worker.ts --once [--empresa <uuid>] [--limit 25]
//   npx tsx scripts/agent-worker.ts --loop [--interval-ms 15000]

import { createAdminClient } from "../lib/supabase/admin";
import { cleanupExpiredLeases } from "../lib/agent/leases";
import { processDueTimers } from "../lib/agent/timers";
import { processDueRetries } from "../lib/agent/retries";
import { processAgentEvent } from "../lib/agent/events";
import { resumeTask, cancelTask } from "../lib/agent/resume";
import { parkTaskForApproval, parkTaskForEvent } from "../lib/agent/waits";
import { scheduleRetry } from "../lib/agent/retries";
import { updateTaskStatus } from "../lib/agent/runtime";
import { actorForSystem } from "../lib/agent/context";
import { AgentOrchestrator } from "../lib/agent/orchestrator";
import "../lib/tools";

type Args = { once: boolean; loop: boolean; intervalMs: number; empresaId?: string; limit: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { once: false, loop: false, intervalMs: 15000, limit: 25 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--once") args.once = true;
    if (argv[i] === "--loop") args.loop = true;
    if (argv[i] === "--interval-ms") args.intervalMs = Number(argv[i + 1] ?? 15000);
    if (argv[i] === "--empresa") args.empresaId = argv[i + 1];
    if (argv[i] === "--limit") args.limit = Number(argv[i + 1] ?? 25);
  }
  if (!args.once && !args.loop) args.once = true;
  return args;
}

const MAX_RUNS_PER_TASK = 25;

async function runCycle(db: ReturnType<typeof createAdminClient>, args: Args, workerId: string) {
  const summary: Record<string, unknown> = { leasesCleaned: 0, timersWoken: [] as string[], eventsProcessed: 0, eventsWoken: [] as string[], retriesReadied: [] as string[], resumed: [] as string[], errors: [] as string[] };

  summary.leasesCleaned = await cleanupExpiredLeases(db as never);

  const timers = await processDueTimers({ db: db as never, empresaId: args.empresaId, limit: args.limit });
  (summary.timersWoken as string[]).push(...timers.taskIds);

  const { data: pendingEvents } = await (db as never)
    .from("agent_events")
    .select("id, empresa_id")
    .is("processed_at", null)
    .order("occurred_at", { ascending: true })
    .limit(args.limit);
  for (const ev of ((pendingEvents ?? []) as Array<{ id: string; empresa_id: string }>)) {
    if (args.empresaId && ev.empresa_id !== args.empresaId) continue;
    try {
      const r = await processAgentEvent({ db: db as never, eventId: ev.id, empresaId: ev.empresa_id, processorId: workerId });
      summary.eventsProcessed = (summary.eventsProcessed as number) + 1;
      (summary.eventsWoken as string[]).push(...r.taskIds);
    } catch (e) {
      (summary.errors as string[]).push(`event ${ev.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const retries = await (await import("../lib/agent/retries")).processDueRetries({ db: db as never, empresaId: args.empresaId, limit: args.limit });
  (summary.retriesReadied as string[]).push(...retries.taskIds);

  const toResume = Array.from(
    new Set([...(summary.timersWoken as string[]), ...(summary.eventsWoken as string[]), ...(summary.retriesReadied as string[])])
  ).slice(0, args.limit);

  for (const taskId of toResume) {
    try {
      await resumeAndRun(db, taskId, workerId);
      (summary.resumed as string[]).push(taskId);
    } catch (e) {
      (summary.errors as string[]).push(`resume ${taskId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}

async function resumeAndRun(db: ReturnType<typeof createAdminClient>, taskId: string, workerId: string) {
  const { data: task } = await (db as never).from("agent_tasks").select("*").eq("id", taskId).single();
  if (!task) return;
  const t = task as { id: string; empresa_id: string; user_id: string | null; project_id: string | null; type: string; status: string; context_json: Record<string, unknown> };

  const { count: runCount } = await (db as never)
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId);
  if ((runCount ?? 0) >= MAX_RUNS_PER_TASK) {
    await updateTaskStatus({
      db: db as never,
      taskId,
      empresaId: t.empresa_id,
      status: "FAILED",
      errorMessage: `Budget guard: max runs per task (${MAX_RUNS_PER_TASK})`,
      actorType: "worker",
    });
    return;
  }

  const resumed = await (await import("../lib/agent/resume")).resumeTask({
    db: db as never,
    taskId,
    empresaId: t.empresa_id,
    actorId: workerId,
    actorType: "worker",
  });

  const ctx = (t.context_json ?? {}) as Record<string, unknown>;
  const actor = actorForSystem({
    empresaId: t.empresa_id,
    userId: typeof t.user_id === "string" ? t.user_id : null,
    role: typeof ctx.role === "string" ? (ctx.role as "comercial" | "administracion" | "admin") : null,
    source: "worker",
  });

  const orchestrator = new AgentOrchestrator({ maxIterations: 8, timeoutMs: 30000, maxRuntimeMs: 90000 });
  const userIntent =
    typeof ctx.user_intent === "string" && ctx.user_intent
      ? ctx.user_intent
      : typeof ctx.objective === "string"
        ? ctx.objective
        : "Continúa la tarea pendiente con el contexto durable.";
  const contextHint = [
    t.project_id ? `project_id=${t.project_id}` : null,
    typeof ctx.rfq_id === "string" ? `rfq_id=${ctx.rfq_id}` : null,
    `task_id=${taskId} run_id=${resumed.runId}`,
  ]
    .filter(Boolean)
    .join(" ");

  let result: Awaited<ReturnType<AgentOrchestrator["run"]>>;
  try {
    result = await orchestrator.run({
      db: db as never,
      actor: { ...actor, taskId, runId: resumed.runId, projectId: t.project_id },
      taskId,
      runId: resumed.runId,
      userIntent,
      contextHint: contextHint || null,
    });
  } catch (e) {
    await scheduleRetry({
      db: db as never,
      taskId,
      empresaId: t.empresa_id,
      runId: resumed.runId,
      errorCode: "ORCHESTRATOR_ERROR",
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  if (result.stoppedReason === "approval_required" && result.approvalId) {
    await parkTaskForApproval({
      db: db as never,
      taskId,
      empresaId: t.empresa_id,
      runId: resumed.runId,
      approvalId: result.approvalId,
    });
    return;
  }

  if (t.type === "RFQ_FLOW" && typeof ctx.rfq_id === "string") {
    await continueRfqFlow(db as never, t as never, ctx, resumed.runId);
    return;
  }

  await updateTaskStatus({
    db: db as never,
    taskId,
    empresaId: t.empresa_id,
    status: "COMPLETED",
    actorType: "worker",
  });
}

async function continueRfqFlow(
  db: never,
  task: { id: string; empresa_id: string; project_id: string | null },
  ctx: Record<string, unknown>,
  runId: string
) {
  const rfqId = ctx.rfq_id as string;
  const expected = Array.isArray(ctx.expected_suppliers) ? (ctx.expected_suppliers as string[]) : [];
  const { data: responses } = await (db as never).from("rfq_providers").select("provider_id, status").eq("rfq_id", rfqId);
  const responded = ((responses ?? []) as Array<{ provider_id: string; status: string }>)
    .filter((r) => r.status === "RESPONDIDO")
    .map((r) => r.provider_id);
  const respondedExpected = expected.length ? expected.filter((id) => responded.includes(id)) : responded;

  if (expected.length > 0 && respondedExpected.length < expected.length) {
    await parkTaskForEvent({
      db: db as never,
      taskId: task.id,
      empresaId: task.empresa_id,
      runId,
      eventType: "SUPPLIER_QUOTE_RECEIVED",
      correlationKey: `RFQ:${rfqId}`,
      payloadJson: { rfq_id: rfqId, received: respondedExpected.length, expected: expected.length },
    });
    return;
  }

  await parkTaskForEvent({
    db: db as never,
    taskId: task.id,
    empresaId: task.empresa_id,
    runId,
    eventType: "USER_DECISION_RECEIVED",
    correlationKey: `TASK:${task.id}`,
    payloadJson: { rfq_id: rfqId, received: respondedExpected.length, decision: "choose_supplier" },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = createAdminClient();
  const workerId = `worker_${Date.now().toString(36)}`;
  if (args.loop) {
    for (;;) {
      const summary = await runCycle(db, args, workerId);
      console.log(JSON.stringify({ at: new Date().toISOString(), ...summary }));
      await new Promise((r) => setTimeout(r, args.intervalMs));
    }
  } else {
    const summary = await runCycle(db, args, workerId);
    console.log(JSON.stringify({ at: new Date().toISOString(), ...summary }, null, 2));
  }
}

main().catch((e) => {
  console.error("[agent-worker] fatal:", e);
  process.exit(1);
});
