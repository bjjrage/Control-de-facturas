// Compara baseline (report.baseline.json) vs tuned (report.tuned.json) caso
// por caso. Ambos reportes vienen de los MISMOS 153 casos (dataset
// congelado) — este script no llama a DeepSeek, solo diffea resultados ya
// guardados.
import { readFileSync } from "fs";
import { join } from "path";

interface ResultRow {
  id: string;
  category: string;
  name: string;
  expectedDecision: "MATCH" | "REVIEW" | "NO_MATCH";
  expectedCode: string | null;
  obtainedDecision: "MATCH" | "REVIEW" | "NO_MATCH";
  obtainedCode: string | null;
  confidence: number;
  decisionCorrect: boolean;
  candidateCorrect: boolean | null;
  safetyClass: string;
}

interface Report {
  totalCases: number;
  elapsedMs: number;
  totalTokens: number;
  avgLatencyMs: number | null;
  decisionAccuracy: number;
  candidateAccuracyGivenMatch: number | null;
  safetyCounts: Record<string, number>;
  confusion: Record<string, Record<string, number>>;
  consistentGroups: number;
  consistencyGroups: Array<{ group: string; size: number; consistent: boolean }>;
  allResults: ResultRow[];
}

function load(name: string): Report {
  return JSON.parse(readFileSync(join(__dirname, name), "utf-8"));
}

const baseline = load("report.baseline.json");
const tuned = load("report.tuned.json");

const baseById = new Map(baseline.allResults.map((r) => [r.id, r]));
const tunedById = new Map(tuned.allResults.map((r) => [r.id, r]));

if (baseById.size !== tunedById.size) {
  console.warn(`AVISO: tamaños distintos — baseline ${baseById.size}, tuned ${tunedById.size}`);
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "n/a";
}

console.log("========================================================");
console.log("BASELINE vs TUNED — 153 casos (dataset congelado)");
console.log("========================================================\n");

const rows: Array<[string, string, string]> = [
  ["Exact accuracy (decisión)", pct(baseline.safetyCounts.EXACT_CORRECT, baseline.totalCases), pct(tuned.safetyCounts.EXACT_CORRECT, tuned.totalCases)],
  [
    "Candidate accuracy (dado MATCH esperado)",
    baseline.candidateAccuracyGivenMatch != null ? `${(baseline.candidateAccuracyGivenMatch * 100).toFixed(1)}%` : "n/a",
    tuned.candidateAccuracyGivenMatch != null ? `${(tuned.candidateAccuracyGivenMatch * 100).toFixed(1)}%` : "n/a",
  ],
  ["UNSAFE_MATCH (crítico)", `${baseline.safetyCounts.UNSAFE_MATCH}`, `${tuned.safetyCounts.UNSAFE_MATCH}`],
  ["SAFE_ABSTENTION", `${baseline.safetyCounts.SAFE_ABSTENTION}`, `${tuned.safetyCounts.SAFE_ABSTENTION}`],
  ["WRONG_MATCH (falso positivo con candidato)", `${baseline.safetyCounts.WRONG_MATCH}`, `${tuned.safetyCounts.WRONG_MATCH}`],
  ["ERROR (excepción de la llamada)", `${baseline.safetyCounts.ERROR ?? 0}`, `${tuned.safetyCounts.ERROR ?? 0}`],
  ["Total obtenido = REVIEW", `${baseline.confusion.MATCH.REVIEW + baseline.confusion.REVIEW.REVIEW + baseline.confusion.NO_MATCH.REVIEW}`, `${tuned.confusion.MATCH.REVIEW + tuned.confusion.REVIEW.REVIEW + tuned.confusion.NO_MATCH.REVIEW}`],
  ["Total obtenido = NO_MATCH", `${baseline.confusion.MATCH.NO_MATCH + baseline.confusion.REVIEW.NO_MATCH + baseline.confusion.NO_MATCH.NO_MATCH}`, `${tuned.confusion.MATCH.NO_MATCH + tuned.confusion.REVIEW.NO_MATCH + tuned.confusion.NO_MATCH.NO_MATCH}`],
  ["Consistency groups OK", `${baseline.consistentGroups}/${baseline.consistencyGroups.length}`, `${tuned.consistentGroups}/${tuned.consistencyGroups.length}`],
  ["Tokens totales", `${baseline.totalTokens}`, `${tuned.totalTokens}`],
  ["Latencia promedio/llamada", baseline.avgLatencyMs != null ? `${baseline.avgLatencyMs.toFixed(0)}ms` : "no registrada", tuned.avgLatencyMs != null ? `${tuned.avgLatencyMs.toFixed(0)}ms` : "no registrada"],
];

const w1 = 42;
console.log("Métrica".padEnd(w1), "BASELINE".padEnd(14), "TUNED");
for (const [label, b, t] of rows) {
  console.log(label.padEnd(w1), b.padEnd(14), t);
}

// --- Diff caso por caso: TODO cambio de comportamiento, no solo mejoras -----
type Change = {
  id: string;
  category: string;
  name: string;
  expected: string;
  baseSafety: string;
  tunedSafety: string;
  baseObtained: string;
  tunedObtained: string;
  verdict: "IMPROVED" | "REGRESSED" | "CHANGED_NEUTRAL";
};

const SEVERITY: Record<string, number> = { EXACT_CORRECT: 3, SAFE_ABSTENTION: 2, WRONG_MATCH: 1, UNSAFE_MATCH: 0, ERROR: 0 };

const changes: Change[] = [];
for (const [id, b] of baseById) {
  const t = tunedById.get(id);
  if (!t) continue;
  if (b.safetyClass === t.safetyClass && b.obtainedDecision === t.obtainedDecision && b.obtainedCode === t.obtainedCode) continue;

  const bSev = SEVERITY[b.safetyClass] ?? -1;
  const tSev = SEVERITY[t.safetyClass] ?? -1;
  const verdict: Change["verdict"] = tSev > bSev ? "IMPROVED" : tSev < bSev ? "REGRESSED" : "CHANGED_NEUTRAL";

  changes.push({
    id,
    category: b.category,
    name: b.name,
    expected: b.expectedCode ? `${b.expectedDecision}:${b.expectedCode}` : b.expectedDecision,
    baseSafety: b.safetyClass,
    tunedSafety: t.safetyClass,
    baseObtained: b.obtainedCode ? `${b.obtainedDecision}:${b.obtainedCode}` : b.obtainedDecision,
    tunedObtained: t.obtainedCode ? `${t.obtainedDecision}:${t.obtainedCode}` : t.obtainedDecision,
    verdict,
  });
}

console.log(`\n\n--- CAMBIOS DE COMPORTAMIENTO (${changes.length} de ${baseById.size} casos) ---\n`);

const improved = changes.filter((c) => c.verdict === "IMPROVED");
const regressed = changes.filter((c) => c.verdict === "REGRESSED");
const neutral = changes.filter((c) => c.verdict === "CHANGED_NEUTRAL");

console.log(`MEJORARON: ${improved.length}`);
for (const c of improved) {
  console.log(`  [${c.category}] ${c.id} — "${c.name}"`);
  console.log(`      esperado=${c.expected}  baseline=${c.baseObtained}(${c.baseSafety})  ->  tuned=${c.tunedObtained}(${c.tunedSafety})`);
}

console.log(`\nREGRESIONARON: ${regressed.length}`);
for (const c of regressed) {
  console.log(`  [${c.category}] ${c.id} — "${c.name}"`);
  console.log(`      esperado=${c.expected}  baseline=${c.baseObtained}(${c.baseSafety})  ->  tuned=${c.tunedObtained}(${c.tunedSafety})`);
}

console.log(`\nCAMBIARON SIN CAMBIAR DE SEVERIDAD: ${neutral.length}`);
for (const c of neutral) {
  console.log(`  [${c.category}] ${c.id} — "${c.name}"`);
  console.log(`      esperado=${c.expected}  baseline=${c.baseObtained}(${c.baseSafety})  ->  tuned=${c.tunedObtained}(${c.tunedSafety})`);
}

const targetIds = ["089-thick-range-ambiguous", "119-contra-ca50-vs-ca60-prop", "122-contra-10cm-nota-20cm"];
console.log("\n--- Los 3 UNSAFE_MATCH originales, verificados uno por uno ---");
for (const id of targetIds) {
  const b = baseById.get(id);
  const t = tunedById.get(id);
  console.log(`  ${id}: baseline=${b?.safetyClass} (${b?.obtainedDecision}:${b?.obtainedCode ?? "-"})  ->  tuned=${t?.safetyClass} (${t?.obtainedDecision}:${t?.obtainedCode ?? "-"})`);
}
