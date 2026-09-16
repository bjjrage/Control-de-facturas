// scripts/agent-worker.ts
// BATCH 6 - Stateless worker for durable tasks.
// All wake effects, leases, retries and run/task transitions are durable.

import { randomUUID } from "node:crypto";
import { createAdminClient } from "../lib/supabase/admin";
import { cleanupExpiredLeases, releaseTaskLease } from "../lib/agent/leases";
import { processDueTimers } from "../lib/agent/timers";
import { processDueRetries, scheduleRetry } from "../lib/agent/retries";
import { processAgentEvent, type AgentEventWake } from "../lib/agent/events";
import { resumeTask } from "../lib/agent/resume";
import { parkTaskForApproval, parkTaskForEvent } from "../lib/agent/waits";
import { finishRun, updateTaskStatus } from "../lib/agent/runtime";
import { actorForSystem } from "../lib/agent/context";
import { AgentOrchestrator } from "../lib/agent/orchestrator";
import "../lib/tools";

type AgentDb = ReturnType<typeof createAdminClient>;
type Args = { once: boolean; loop: boolean; intervalMs: number; empresaId?: string; limit: number };
type ResumeCandidate = {
  taskId: string;
  triggerEventId?: string | null;
  triggerWaitId?: string | null;
  recoverRunning?: boolean;
};

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

async function collectSatisfiedWaitCandidates(
  db: AgentDb,
  args: Args,
  existing: Map<string, ResumeCandidate>
): Promise<void> {
  let waitsQuery = db
    .from("agent_task_waits")
    .select("id, task_id, empresa_id, run_id, satisfied_by_event_id")
    .eq("status", "SATISFIED")
    .order("updated_at", { ascending: true })
    .limit(args.limit);
  if (args.empresaId) waitsQuery = waitsQuery.eq("empresa_id", args.empresaId);
  const { data: waits, error: waitsError } = await waitsQuery;
  if (waitsError) throw new Error(`worker recovery waits: ${waitsError.message}`);
  if (!waits?.length) return;

  const taskIds = [...new Set(waits.map((wait) => wait.task_id))];
  const { data: tasks, error: tasksError } = await db
    .from("agent_tasks")
    .select("id, status")
    .in("id", taskIds)
    .in("status", ["WAITING_EXTERNAL", "WAITING_APPROVAL", "SCHEDULED", "FAILED"]);
  if (tasksError) throw new Error(`worker recovery tasks: ${tasksError.message}`);
  const resumable = new Set((tasks ?? []).map((task) => task.id));

  const { data: runs, error: runsError } = await db
    .from("agent_runs")
    .select("id, task_id, started_at")
    .in("task_id", taskIds)
    .order("started_at", { ascending: false });
  if (runsError) throw new Error(`worker recovery runs: ${runsError.message}`);
  const latestRun = new Map<string, string>();
  for (const run of (runs ?? []) as Array<{ id: string; task_id: string }>) {
    if (!latestRun.has(run.task_id)) latestRun.set(run.task_id, run.id);
  }

  for (const wait of waits as Array<{
    id: string;
    task_id: string;
    run_id: string | null;
    satisfied_by_event_id: string | null;
  }>) {
    // A satisfied wait from an older run must not wake a later wait cycle.
    if (!resumable.has(wait.task_id) || !wait.run_id || latestRun.get(wait.task_id) !== wait.run_id) continue;
    if (!existing.has(wait.task_id)) {
      existing.set(wait.task_id, {
        taskId: wait.task_id,
        triggerWaitId: wait.id,
        triggerEventId: wait.satisfied_by_event_id,
      });
    }
  }
}

async function collectRunningRecoveryCandidates(db: AgentDb, args: Args, existing: Map<string, ResumeCandidate>): Promise<void> {
  let query = db
    .from("agent_tasks")
    .select("id")
    .eq("status", "RUNNING")
    .order("updated_at", { ascending: true })
    .limit(args.limit);
  if (args.empresaId) query = query.eq("empresa_id", args.empresaId);
  const { data, error } = await query;
  if (error) throw new Error(`worker recovery running tasks: ${error.message}`);
  for (const task of data ?? []) {
    const candidate = existing.get(task.id);
    if (candidate) {
      // A stale retry and a RUNNING task can be discovered in the same cycle.
      // Preserve the retry/event trigger but still enable lease-expiry recovery.
      existing.set(task.id, { ...candidate, recoverRunning: true });
    } else {
      existing.set(task.id, { taskId: task.id, recoverRunning: true });
    }
  }
}

async function runCycle(db: AgentDb, args: Args, workerId: string) {
  const summary: Record<string, unknown> = {
    leasesCleaned: 0,
    timersWoken: [] as string[],
    eventsProcessed: 0,
    eventsWoken: [] as string[],
    retriesReadied: [] as string[],
    resumed: [] as string[],
    errors: [] as string[],
  };
  const candidates = new Map<string, ResumeCandidate>();

  summary.leasesCleaned = await cleanupExpiredLeases(db);

  const timers = await processDueTimers({ db, empresaId: args.empresaId, limit: args.limit });
  (summary.timersWoken as string[]).push(...timers.taskIds);
  for (const wake of timers.wakes) candidates.set(wake.taskId, { taskId: wake.taskId, triggerWaitId: wake.waitId });

  let pendingEventsQuery = db
    .from("agent_events")
    .select("id, empresa_id")
    .is("processed_at", null)
    .order("occurred_at", { ascending: true })
    .limit(args.limit);
  if (args.empresaId) pendingEventsQuery = pendingEventsQuery.eq("empresa_id", args.empresaId);
  const { data: pendingEvents, error: pendingEventsError } = await pendingEventsQuery;
  if (pendingEventsError) throw new Error(`worker pending events: ${pendingEventsError.message}`);
  for (const ev of (pendingEvents ?? []) as Array<{ id: string; empresa_id: string }>) {
    try {
      const result = await processAgentEvent({ db, eventId: ev.id, empresaId: ev.empresa_id, processorId: workerId });
      summary.eventsProcessed = (summary.eventsProcessed as number) + 1;
      (summary.eventsWoken as string[]).push(...result.taskIds);
      for (const wake of result.woken as AgentEventWake[]) {
        if (!candidates.has(wake.taskId)) {
          candidates.set(wake.taskId, { taskId: wake.taskId, triggerEventId: ev.id, triggerWaitId: wake.waitId });
        }
      }
    } catch (e) {
      (summary.errors as string[]).push(`event ${ev.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const retries = await processDueRetries({ db, empresaId: args.empresaId, limit: args.limit });
  (summary.retriesReadied as string[]).push(...retries.taskIds);
  for (const taskId of retries.taskIds) {
    if (!candidates.has(taskId)) candidates.set(taskId, { taskId });
  }

  // This is the restart bridge: effects committed by a previous cycle remain
  // SATISFIED even if the process died before it resumed the task.
  await collectSatisfiedWaitCandidates(db, args, candidates);
  // A RUNNING task with no lease is a worker crash/restart candidate.
  await collectRunningRecoveryCandidates(db, args, candidates);

  for (const candidate of [...candidates.values()].slice(0, args.limit)) {
    try {
      await resumeAndRun(db, candidate, workerId);
      (summary.resumed as string[]).push(candidate.taskId);
    } catch (e) {
      (summary.errors as string[]).push(`resume ${candidate.taskId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}

async function resumeAndRun(db: AgentDb, candidate: ResumeCandidate, workerId: string): Promise<void> {
  const taskId = candidate.taskId;
  const { data: task, error: taskError } = await db.from("agent_tasks").select("*").eq("id", taskId).single();
  if (taskError || !task) return;
  const t = task as {
    id: string;
    empresa_id: string;
    user_id: string | null;
    project_id: string | null;
    type: string;
    status: string;
    context_json: Record<string, unknown>;
  };

  const { count: runCount, error: runCountError } = await db
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId);
  if (runCountError) throw new Error(`run budget query: ${runCountError.message}`);
  if ((runCount ?? 0) >= MAX_RUNS_PER_TASK) {
    await updateTaskStatus({
      db,
      taskId,
      empresaId: t.empresa_id,
      status: "FAILED",
      errorMessage: `Budget guard: max runs per task (${MAX_RUNS_PER_TASK})`,
      actorType: "worker",
    });
    return;
  }

  const resumed = await resumeTask({
    db,
    taskId,
    empresaId: t.empresa_id,
    actorId: workerId,
    actorType: "worker",
    triggerEventId: candidate.triggerEventId,
    triggerWaitId: candidate.triggerWaitId,
    allowRunningRecovery: candidate.recoverRunning === true,
  });

  try {
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
          : "Continua la tarea pendiente con el contexto durable.";
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
        db,
        actor: { ...actor, taskId, runId: resumed.runId, projectId: t.project_id },
        taskId,
        runId: resumed.runId,
        userIntent,
        contextHint: contextHint || null,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      await finishRun({ db, runId: resumed.runId, status: "FAILED", errorMessage });
      await scheduleRetry({
        db,
        taskId,
        empresaId: t.empresa_id,
        runId: resumed.runId,
        errorCode: "ORCHESTRATOR_ERROR",
        errorMessage,
      });
      return;
    }

    if (result.stoppedReason === "approval_required" && result.approvalId) {
      await finishRun({ db, runId: resumed.runId, status: "COMPLETED" });
      await parkTaskForApproval({
        db,
        taskId,
        empresaId: t.empresa_id,
        runId: resumed.runId,
        approvalId: result.approvalId,
      });
      return;
    }

    if (t.type === "RFQ_FLOW" && typeof ctx.rfq_id === "string") {
      await continueRfqFlow(db, t, ctx, resumed.runId);
      await finishRun({ db, runId: resumed.runId, status: "COMPLETED" });
      return;
    }

    await updateTaskStatus({ db, taskId, empresaId: t.empresa_id, status: "COMPLETED", actorType: "worker" });
    await finishRun({ db, runId: resumed.runId, status: "COMPLETED" });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    await finishRun({ db, runId: resumed.runId, status: "FAILED", errorMessage }).catch(() => undefined);
    await scheduleRetry({
      db,
      taskId,
      empresaId: t.empresa_id,
      runId: resumed.runId,
      errorCode: "WORKER_LIFECYCLE_ERROR",
      errorMessage,
    }).catch(() => undefined);
    throw e;
  } finally {
    await releaseTaskLease({ db, taskId, empresaId: t.empresa_id, holderId: resumed.holderId });
  }
}

async function continueRfqFlow(
  db: AgentDb,
  task: { id: string; empresa_id: string; project_id: string | null },
  ctx: Record<string, unknown>,
  runId: string
) {
  const rfqId = ctx.rfq_id as string;
  const expected = Array.isArray(ctx.expected_suppliers) ? (ctx.expected_suppliers as string[]) : [];
  const { data: responses, error } = await db.from("rfq_providers").select("provider_id, status").eq("rfq_id", rfqId);
  if (error) throw new Error(`RFQ responses: ${error.message}`);
  const responded = ((responses ?? []) as Array<{ provider_id: string; status: string }>)
    .filter((r) => r.status === "RESPONDIDO")
    .map((r) => r.provider_id);
  const respondedExpected = expected.length ? expected.filter((id) => responded.includes(id)) : responded;

  if (expected.length > 0 && respondedExpected.length < expected.length) {
    await parkTaskForEvent({
      db,
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
    db,
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
  const workerId = randomUUID();
  if (args.loop) {
    for (;;) {
      const summary = await runCycle(db, args, workerId);
      console.log(JSON.stringify({ at: new Date().toISOString(), ...summary }));
      await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
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
