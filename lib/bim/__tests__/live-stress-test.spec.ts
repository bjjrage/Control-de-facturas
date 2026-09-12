// Stress test del matcher semántico REAL (DeepSeek) sobre un dataset de 60
// elementos que imita un proyecto real (no casos unitarios aislados). Sin
// mocks: cada decisión viene de una llamada real a la API.
//
// Deshabilitado por defecto. Para correrlo:
//   RUN_LIVE_BIM_AI_TESTS=1 npx vitest run lib/bim/__tests__/live-stress-test.spec.ts
//
// Si RUN_LIVE_BIM_AI_TESTS=1 pero falta DEEPSEEK_API_KEY, falla en beforeAll
// con mensaje explícito — no se convierte en mock.
//
// Corre primero la corrida INDIVIDUAL (1 elemento = 1 llamada, el mismo
// pipeline y prompt de producción — lib/bim/deepseek-matcher.ts sin tocar) y
// reporta el baseline completo ANTES de tocar nada. Después, sin modificar
// el prompt individual ni el dataset, corre una segunda pasada en BATCH
// (10 elementos por llamada, prompt propio en deepseek-batch-runner.ts) para
// comparar accuracy/latencia/tokens/costo entre las dos estrategias.
import { join } from "path";
import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeepSeekSemanticMatcher, type DeepSeekUsage } from "../deepseek-matcher";
import { buildCandidatePool, toSemanticMatchInput } from "../semantic-pipeline";
import { AURORA_BUDGET_ITEMS } from "./fixtures/aurora-budget-items";
import { STRESS_DATASET, type StressCase } from "./fixtures/aurora-stress-dataset";
import { aggregate, candidateCodeOf, classify, findConsistencyIssues, type StressRunResult } from "./stress-metrics";
import { callDeepSeekBatch, type BatchItemInput } from "./deepseek-batch-runner";

loadDotenv({ path: join(process.cwd(), ".env.local") });

const RUN_LIVE = process.env.RUN_LIVE_BIM_AI_TESTS === "1";
const RUN_TIMEOUT_MS = 15 * 60 * 1000; // 60 elementos + reintentos puede tardar varios minutos
const INDIVIDUAL_CONCURRENCY = 5;
const BATCH_SIZE = 10;
const BATCH_CONCURRENCY = 2;
const MAX_RETRIES = 3;

// --- utilidades de ejecución -----------------------------------------------

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function isRateLimitError(e: unknown): boolean {
  return e instanceof Error && /HTTP 429/.test(e.message);
}

async function withRetry<T>(fn: () => Promise<T>, onRetry: () => void): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (isRateLimitError(e) && attempt < MAX_RETRIES) {
        attempt++;
        onRetry();
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw e;
    }
  }
}

// --- corrida individual ------------------------------------------------------

async function runIndividual(dataset: StressCase[]): Promise<Map<string, StressRunResult>> {
  const results = new Map<string, StressRunResult>();
  await mapWithConcurrency(dataset, INDIVIDUAL_CONCURRENCY, async (c) => {
    // Instancia propia por caso: DeepSeekSemanticMatcher guarda `lastUsage`
    // como campo mutable de instancia — con concurrencia, compartir una sola
    // instancia pisaría el usage de un caso con el de otro.
    const matcher = new DeepSeekSemanticMatcher();
    let retries = 0;
    try {
      const result = await withRetry(
        () => runSemanticMatchOnce(matcher, c),
        () => retries++
      );
      const usage: DeepSeekUsage = matcher.lastUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 };
      results.set(c.id, {
        caseId: c.id,
        decision: result.decision,
        candidateCode: candidateCodeOf(result.candidateId),
        confidence: result.confidence,
        latencyMs: usage.latencyMs,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        retries,
      });
    } catch (e) {
      results.set(c.id, {
        caseId: c.id,
        decision: "NO_MATCH",
        candidateCode: null,
        confidence: 0,
        latencyMs: -1,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        retries,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
  return results;
}

async function runSemanticMatchOnce(matcher: DeepSeekSemanticMatcher, c: StressCase) {
  const candidates = buildCandidatePool(c.element, AURORA_BUDGET_ITEMS);
  return matcher.match(toSemanticMatchInput(c.element, candidates));
}

// --- corrida en batch --------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runBatch(dataset: StressCase[], batchSize: number): Promise<Map<string, StressRunResult>> {
  const results = new Map<string, StressRunResult>();
  const batches = chunk(dataset, batchSize);
  await mapWithConcurrency(batches, BATCH_CONCURRENCY, async (batchCases) => {
    const items: BatchItemInput[] = batchCases.map((c) => ({
      elementId: c.id,
      input: toSemanticMatchInput(c.element, buildCandidatePool(c.element, AURORA_BUDGET_ITEMS)),
    }));
    let retries = 0;
    try {
      const { results: batchResults, usage } = await withRetry(
        () => callDeepSeekBatch(items),
        () => retries++
      );
      // El costo/latencia de la llamada se reparte informativamente entre
      // los elementos del batch para que los totales agregados sigan siendo
      // comparables 1:1 contra la corrida individual.
      const perElementTokens = usage.totalTokens / batchCases.length;
      const perElementPrompt = usage.promptTokens / batchCases.length;
      const perElementCompletion = usage.completionTokens / batchCases.length;
      for (const c of batchCases) {
        const r = batchResults.get(c.id);
        results.set(c.id, {
          caseId: c.id,
          decision: r?.decision ?? "NO_MATCH",
          candidateCode: candidateCodeOf(r?.candidateId ?? null),
          confidence: r?.confidence ?? 0,
          latencyMs: usage.latencyMs, // la llamada es compartida por todo el batch
          promptTokens: perElementPrompt,
          completionTokens: perElementCompletion,
          totalTokens: perElementTokens,
          retries,
          error: r ? undefined : "El modelo no devolvió resultado para este elemento en el batch.",
        });
      }
    } catch (e) {
      for (const c of batchCases) {
        results.set(c.id, {
          caseId: c.id,
          decision: "NO_MATCH",
          candidateCode: null,
          confidence: 0,
          latencyMs: -1,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          retries,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });
  return results;
}

// --- reporting ---------------------------------------------------------------

function printCaseTable(dataset: StressCase[], results: Map<string, StressRunResult>, label: string) {
  const rows = dataset.map((c) => {
    const r = results.get(c.id);
    const verdict = r ? classify(c, r) : "ERROR";
    return {
      case: c.id,
      category: c.category,
      expected: c.expectedDecision + (c.expectedCandidateCode ? ` ${c.expectedCandidateCode}` : ""),
      actual: r?.decision ?? "—",
      candidate: r?.candidateCode ?? "—",
      conf: r ? r.confidence.toFixed(2) : "—",
      ok: verdict === "CORRECT_MATCH" || verdict === "CORRECT_REVIEW" || verdict === "CORRECT_NO_MATCH" ? "✅" : "❌",
      verdict,
      latencyMs: r?.latencyMs ?? -1,
      error: r?.error ?? "",
    };
  });
  console.log(`\n=== ${label}: detalle por caso ===`);
  console.table(rows);
}

function printSummary(dataset: StressCase[], results: Map<string, StressRunResult>, label: string) {
  const metrics = aggregate(dataset, results);
  console.log(`\n=== ${label}: resumen agregado ===`);
  console.log(JSON.stringify(metrics, null, 2));

  console.log(`\n=== ${label}: por categoría ===`);
  const categories = ["cooperative", "semantic", "ambiguous", "adversarial"] as const;
  for (const cat of categories) {
    const subset = dataset.filter((c) => c.category === cat);
    const subMetrics = aggregate(subset, results);
    console.log(
      `${cat.padEnd(12)} total=${subMetrics.total} accuracy=${(subMetrics.accuracy * 100).toFixed(1)}% FP=${subMetrics.falsePositives} FN=${subMetrics.falseNegatives} wrongMatch=${subMetrics.wrongMatches}`
    );
  }

  const issues = findConsistencyIssues(dataset, results);
  console.log(`\n=== ${label}: consistencia entre elementos equivalentes ===`);
  if (issues.length === 0) {
    console.log("Sin inconsistencias detectadas en los grupos definidos.");
  } else {
    for (const issue of issues) {
      console.log(`Grupo "${issue.group}" — INCONSISTENTE:`);
      console.table(issue.outcomes);
    }
  }
  return metrics;
}

describe.runIf(RUN_LIVE)("live-stress-test — 60 elementos, DeepSeek real (sin mocks)", () => {
  beforeAll(() => {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error(
        "RUN_LIVE_BIM_AI_TESTS=1 pero falta DEEPSEEK_API_KEY. Este stress test llama a la API real de " +
          "DeepSeek 60+ veces y no tiene modo mock — configurá la variable o no actives RUN_LIVE_BIM_AI_TESTS."
      );
    }
  });

  let individualResults: Map<string, StressRunResult>;
  let batchResults: Map<string, StressRunResult>;

  it(
    "BASELINE — corrida individual (1 llamada por elemento), prompt de producción sin modificar",
    async () => {
      individualResults = await runIndividual(STRESS_DATASET);
      printCaseTable(STRESS_DATASET, individualResults, "INDIVIDUAL");
      const metrics = printSummary(STRESS_DATASET, individualResults, "INDIVIDUAL");

      // No fallamos el test por accuracy < 100% — este batch es de MEDICIÓN,
      // no de aprobación ciega. Sí fallamos si el pipeline se rompió de
      // verdad (errores de transporte/parseo en TODOS o casi todos los casos).
      expect(metrics.errors).toBeLessThan(STRESS_DATASET.length / 2);
    },
    RUN_TIMEOUT_MS
  );

  it(
    "BATCH — misma corrida en lotes de 10, prompt propio de batch (comparación, no reemplaza el baseline)",
    async () => {
      batchResults = await runBatch(STRESS_DATASET, BATCH_SIZE);
      printCaseTable(STRESS_DATASET, batchResults, "BATCH-10");
      const metrics = printSummary(STRESS_DATASET, batchResults, "BATCH-10");
      expect(metrics.errors).toBeLessThan(STRESS_DATASET.length / 2);
    },
    RUN_TIMEOUT_MS
  );

  afterAll(() => {
    if (!individualResults || !batchResults) return;
    const indMetrics = aggregate(STRESS_DATASET, individualResults);
    const batchMetrics = aggregate(STRESS_DATASET, batchResults);
    console.log("\n=== COMPARACIÓN INDIVIDUAL vs BATCH-10 ===");
    console.table([
      { estrategia: "INDIVIDUAL", accuracy: indMetrics.accuracy, fp: indMetrics.falsePositives, tokens: indMetrics.totalTokens, p50: indMetrics.p50LatencyMs, p95: indMetrics.p95LatencyMs, retries: indMetrics.totalRetries },
      { estrategia: "BATCH-10", accuracy: batchMetrics.accuracy, fp: batchMetrics.falsePositives, tokens: batchMetrics.totalTokens, p50: batchMetrics.p50LatencyMs, p95: batchMetrics.p95LatencyMs, retries: batchMetrics.totalRetries },
    ]);
  });
});

describe.skipIf(RUN_LIVE)("live-stress-test — deshabilitado", () => {
  it("no corre en CI/local normal — activar con RUN_LIVE_BIM_AI_TESTS=1 (60+ llamadas reales a DeepSeek, tiene costo)", () => {
    expect(RUN_LIVE).toBe(false);
  });
});
