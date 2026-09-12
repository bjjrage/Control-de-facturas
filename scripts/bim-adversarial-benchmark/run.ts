// Runner del benchmark adversarial — llama al pipeline REAL de matching
// semántico (lib/bim/semantic-pipeline.ts + lib/bim/deepseek-matcher.ts)
// contra DeepSeek en vivo, sin mocks y SIN tocar el prompt/modelo/adapter.
//
// Uso:
//   DEEPSEEK_API_KEY=sk-... npx tsx scripts/bim-adversarial-benchmark/run.ts
// (o dejar que tome DEEPSEEK_API_KEY de .env.local, igual que
// lib/bim/__tests__/live-semantic-matching.spec.ts)
//
// No escribe en Supabase, no modifica ningún archivo de producto. Solo
// imprime métricas y guarda un reporte JSON con todos los casos.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: join(process.cwd(), ".env.local") });

import { DeepSeekSemanticMatcher } from "../../lib/bim/deepseek-matcher";
import { runSemanticMatch } from "../../lib/bim/semantic-pipeline";
import type { BimElement } from "../../lib/types";
import { BENCH_CATALOG } from "./catalog";
import { BENCH_CASES, type BenchCase, type ExpectedDecision } from "./dataset";
import { classify, type SafetyClass } from "./classify";

const CONCURRENCY = 4;
const OUT_PATH = join(__dirname, process.argv[2] ?? "report.json");

function toBimElement(c: BenchCase): BimElement {
  const unit = c.quantityUnit;
  const quantityType =
    unit === "m2" ? "area" : unit === "m3" ? "volume" : unit === "kg" ? "weight" : unit === "m" ? "length" : unit === "u" ? "count" : null;
  return {
    id: c.id,
    bim_model_id: "bench-model",
    project_id: "bench-adversarial-project",
    ifc_guid: c.id,
    ifc_type: c.ifcType,
    express_id: null,
    name: c.name,
    building_storey: "Nivel 1",
    material: c.material ?? null,
    properties: c.properties ?? {},
    quantity_type: quantityType,
    quantity_value: c.quantityValue,
    quantity_unit: unit,
    quantity_source: "IFC_QTO",
    quantity_property: null,
    created_at: new Date().toISOString(),
    group_id: null,
  };
}

interface CaseResult {
  case: BenchCase;
  decision: ExpectedDecision;
  candidateCode: string | null;
  confidence: number;
  reason: string;
  latencyMs: number;
  tokens: number;
  error: string | null;
  decisionCorrect: boolean;
  candidateCorrect: boolean | null; // null cuando no aplica (expected no era MATCH)
  safetyClass: SafetyClass | "ERROR";
}

async function runOne(matcher: DeepSeekSemanticMatcher, c: BenchCase): Promise<CaseResult> {
  const element = toBimElement(c);
  try {
    const result = await runSemanticMatch(matcher, element, BENCH_CATALOG);
    const candidateCode = result.candidateId ? BENCH_CATALOG.find((b) => b.id === result.candidateId)?.code ?? result.candidateId : null;
    const decisionCorrect = result.decision === c.expectedDecision;
    const candidateCorrect = c.expectedDecision === "MATCH" ? decisionCorrect && candidateCode === c.expectedCode : null;
    return {
      case: c,
      decision: result.decision,
      candidateCode,
      confidence: result.confidence,
      reason: result.reason,
      latencyMs: matcher.lastUsage?.latencyMs ?? -1,
      tokens: matcher.lastUsage?.totalTokens ?? -1,
      error: null,
      decisionCorrect,
      candidateCorrect,
      safetyClass: classify(c.expectedDecision, c.expectedCode ?? null, result.decision, candidateCode),
    };
  } catch (e) {
    return {
      case: c,
      decision: "NO_MATCH",
      candidateCode: null,
      confidence: 0,
      reason: "",
      latencyMs: -1,
      tokens: -1,
      error: e instanceof Error ? e.message : String(e),
      decisionCorrect: false,
      candidateCorrect: c.expectedDecision === "MATCH" ? false : null,
      safetyClass: "ERROR",
    };
  }
}

async function runPool<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
      const done = idx + 1;
      if (done % 10 === 0 || done === items.length) {
        process.stdout.write(`  ... ${done}/${items.length} casos procesados\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("Falta DEEPSEEK_API_KEY (env o .env.local). Este benchmark llama a la API real de DeepSeek, no hay modo mock.");
    process.exit(1);
  }

  console.log(`Benchmark adversarial BIM <-> DeepSeek — ${BENCH_CASES.length} casos, catálogo de ${BENCH_CATALOG.length} rubros.`);
  console.log("Corriendo LIVE contra DeepSeek, sin tocar el prompt/modelo/adapter...\n");

  const matcher = new DeepSeekSemanticMatcher();
  const startedAt = Date.now();
  const results = await runPool(BENCH_CASES, CONCURRENCY, (c) => runOne(matcher, c));
  const elapsedMs = Date.now() - startedAt;

  // --- Métricas globales -----------------------------------------------------
  const total = results.length;
  const decisionCorrectCount = results.filter((r) => r.decisionCorrect).length;
  const errors = results.filter((r) => r.error);

  const matchExpected = results.filter((r) => r.case.expectedDecision === "MATCH");
  const matchCandidateCorrectCount = matchExpected.filter((r) => r.candidateCorrect).length;

  // --- Matriz de confusión de decisión ----------------------------------------
  const decisions: ExpectedDecision[] = ["MATCH", "REVIEW", "NO_MATCH"];
  const confusion: Record<string, Record<string, number>> = {};
  for (const d of decisions) confusion[d] = { MATCH: 0, REVIEW: 0, NO_MATCH: 0 };
  for (const r of results) confusion[r.case.expectedDecision][r.decision] += 1;

  // --- Por categoría -----------------------------------------------------------
  const byCategory: Record<string, { total: number; decisionCorrect: number; candidateCorrect: number; candidateApplicable: number }> = {};
  for (const r of results) {
    const cat = r.case.category;
    byCategory[cat] ??= { total: 0, decisionCorrect: 0, candidateCorrect: 0, candidateApplicable: 0 };
    byCategory[cat].total += 1;
    if (r.decisionCorrect) byCategory[cat].decisionCorrect += 1;
    if (r.candidateCorrect !== null) {
      byCategory[cat].candidateApplicable += 1;
      if (r.candidateCorrect) byCategory[cat].candidateCorrect += 1;
    }
  }

  // --- Consistency groups: todas las variantes del mismo grupo deben resolver
  //     al MISMO candidato (independientemente de si ese candidato es el
  //     "correcto" — mide estabilidad semántica ante paráfrasis/idioma/typo).
  const groups = new Map<string, CaseResult[]>();
  for (const r of results) {
    if (!r.case.group) continue;
    const arr = groups.get(r.case.group) ?? [];
    arr.push(r);
    groups.set(r.case.group, arr);
  }
  const groupReport: Array<{ group: string; size: number; consistent: boolean; candidates: (string | null)[] }> = [];
  for (const [group, arr] of groups) {
    const candidates = arr.map((r) => r.candidateCode);
    const consistent = candidates.every((c) => c === candidates[0]);
    groupReport.push({ group, size: arr.length, consistent, candidates });
  }
  const consistentGroups = groupReport.filter((g) => g.consistent).length;

  // --- Clasificación de seguridad operativa -----------------------------------
  const safetyCounts: Record<string, number> = { EXACT_CORRECT: 0, SAFE_ABSTENTION: 0, UNSAFE_MATCH: 0, WRONG_MATCH: 0, ERROR: 0 };
  for (const r of results) safetyCounts[r.safetyClass] += 1;
  const avgLatencyMs = results.reduce((s, r) => s + Math.max(r.latencyMs, 0), 0) / total;

  // --- Fallos (todo lo que no matcheó la decisión esperada, o matcheó la
  //     decisión pero con el candidato incorrecto) --------------------------
  const failures = results.filter((r) => !r.decisionCorrect || r.candidateCorrect === false);

  // --- Reporte a consola -------------------------------------------------------
  console.log("\n========================================================");
  console.log("MÉTRICAS GLOBALES");
  console.log("========================================================");
  console.log(`Total de casos:                 ${total}`);
  console.log(`Tiempo total:                    ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Errores de llamada (excepción):  ${errors.length}`);
  console.log(`Accuracy de decisión:            ${decisionCorrectCount}/${total} (${((decisionCorrectCount / total) * 100).toFixed(1)}%)`);
  console.log(
    `Accuracy de candidato (solo MATCH esperado): ${matchCandidateCorrectCount}/${matchExpected.length} (${((matchCandidateCorrectCount / matchExpected.length) * 100).toFixed(1)}%)`
  );
  const totalTokens = results.reduce((s, r) => s + Math.max(r.tokens, 0), 0);
  console.log(`Tokens totales (prompt+completion): ${totalTokens}`);
  console.log(`Latencia promedio por llamada:   ${avgLatencyMs.toFixed(0)}ms`);

  console.log("\n--- Clasificación de seguridad operativa ---");
  console.log(`EXACT_CORRECT:    ${safetyCounts.EXACT_CORRECT}/${total} (${((safetyCounts.EXACT_CORRECT / total) * 100).toFixed(1)}%)`);
  console.log(`SAFE_ABSTENTION:  ${safetyCounts.SAFE_ABSTENTION}/${total} (${((safetyCounts.SAFE_ABSTENTION / total) * 100).toFixed(1)}%)`);
  console.log(`UNSAFE_MATCH:     ${safetyCounts.UNSAFE_MATCH}/${total} (${((safetyCounts.UNSAFE_MATCH / total) * 100).toFixed(1)}%)  <- métrica crítica de producción`);
  console.log(`WRONG_MATCH:      ${safetyCounts.WRONG_MATCH}/${total} (${((safetyCounts.WRONG_MATCH / total) * 100).toFixed(1)}%)`);
  if (safetyCounts.ERROR > 0) console.log(`ERROR (excepción): ${safetyCounts.ERROR}/${total}`);

  console.log("\n--- Matriz de confusión (filas = esperado, columnas = obtenido) ---");
  console.log("esperado \\ obtenido".padEnd(16), decisions.map((d) => d.padEnd(10)).join(""));
  for (const d of decisions) {
    console.log(d.padEnd(16), decisions.map((d2) => String(confusion[d][d2]).padEnd(10)).join(""));
  }

  console.log("\n--- Por categoría ---");
  for (const [cat, s] of Object.entries(byCategory)) {
    const decPct = ((s.decisionCorrect / s.total) * 100).toFixed(0);
    const candPart = s.candidateApplicable > 0 ? `, candidato ${s.candidateCorrect}/${s.candidateApplicable} (${((s.candidateCorrect / s.candidateApplicable) * 100).toFixed(0)}%)` : "";
    console.log(`  ${cat.padEnd(24)} decisión ${s.decisionCorrect}/${s.total} (${decPct}%)${candPart}`);
  }

  console.log("\n--- Consistency groups (misma variante semántica -> mismo candidato) ---");
  console.log(`Grupos consistentes: ${consistentGroups}/${groupReport.length}`);
  for (const g of groupReport) {
    console.log(`  ${g.consistent ? "OK  " : "FAIL"} ${g.group.padEnd(16)} (${g.size} variantes) -> ${JSON.stringify(g.candidates)}`);
  }

  console.log(`\n--- FALLOS (${failures.length}/${total}) ---`);
  for (const f of failures) {
    const exp = f.case.expectedCode ? `${f.case.expectedDecision}:${f.case.expectedCode}` : f.case.expectedDecision;
    const got = f.candidateCode ? `${f.decision}:${f.candidateCode}` : f.decision;
    console.log(`  [${f.case.category}] ${f.case.id} — "${f.case.name}"`);
    console.log(`      esperado=${exp}  obtenido=${got}  confidence=${f.confidence.toFixed(2)}`);
    console.log(`      razón DeepSeek: ${f.reason || "(vacía)"}`);
    if (f.error) console.log(`      ERROR: ${f.error}`);
    if (f.case.note) console.log(`      nota del caso: ${f.case.note}`);
  }

  // --- Reporte JSON completo -------------------------------------------------
  const report = {
    generatedAt: new Date().toISOString(),
    totalCases: total,
    elapsedMs,
    totalTokens,
    decisionAccuracy: decisionCorrectCount / total,
    candidateAccuracyGivenMatch: matchExpected.length > 0 ? matchCandidateCorrectCount / matchExpected.length : null,
    avgLatencyMs,
    safetyCounts,
    confusion,
    byCategory,
    consistencyGroups: groupReport,
    consistentGroups,
    failures: failures.map((f) => ({
      id: f.case.id,
      category: f.case.category,
      name: f.case.name,
      expectedDecision: f.case.expectedDecision,
      expectedCode: f.case.expectedCode ?? null,
      obtainedDecision: f.decision,
      obtainedCode: f.candidateCode,
      confidence: f.confidence,
      reason: f.reason,
      error: f.error,
      note: f.case.note ?? null,
    })),
    allResults: results.map((r) => ({
      id: r.case.id,
      category: r.case.category,
      name: r.case.name,
      expectedDecision: r.case.expectedDecision,
      expectedCode: r.case.expectedCode ?? null,
      obtainedDecision: r.decision,
      obtainedCode: r.candidateCode,
      confidence: r.confidence,
      decisionCorrect: r.decisionCorrect,
      candidateCorrect: r.candidateCorrect,
      safetyClass: r.safetyClass,
    })),
  };
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nReporte completo escrito en ${OUT_PATH}`);
}

void main();
