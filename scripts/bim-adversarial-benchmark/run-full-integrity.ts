// Corrida COMPLETA del dataset congelado (153 casos) contra el pipeline
// actual de producción: buildCandidatePool -> checkTechnicalIntegrity ->
// DeepSeekBatchSemanticMatcher (batches de 8, igual que GROUP_BATCH_SIZE en
// processBimGroups). Nada del dataset, prompt, modelo, retrieval, thresholds
// ni grouping se modifica acá — este archivo solo mide.
//
// De una sola corrida se derivan DOS lecturas, para poder atribuir la
// regresión a la capa nueva y no al cambio de matcher:
//   - "SIN capa": el resultado crudo de DeepSeek (ignorando integrity).
//   - "CON capa": el resultado final real (integrity puede forzar
//     REVIEW_REQUIRED).
import { writeFileSync } from "fs";
import { join } from "path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: join(process.cwd(), ".env.local") });

import { buildCandidatePool, toSemanticMatchInput } from "../../lib/bim/semantic-pipeline";
import { DeepSeekBatchSemanticMatcher, type BatchMatchItem } from "../../lib/bim/deepseek-batch-matcher";
import { checkTechnicalIntegrity } from "../../lib/bim/technical-integrity";
import { extractSpecs } from "../../lib/bim/matching";
import type { BimElement } from "../../lib/types";
import { BENCH_CATALOG } from "./catalog";
import { BENCH_CASES, type BenchCase, type ExpectedDecision } from "./dataset";

const GROUP_BATCH_SIZE = 8; // mismo valor que producción
const OUT_PATH = join(__dirname, "report.integrity.json");

type FinalStatus = "SUGGESTED" | "REVIEW" | "REVIEW_REQUIRED" | "NO_MATCH" | "INVALID";
type Bucket = "EXACT_CORRECT" | "SAFE_ABSTENTION" | "REVIEW_REQUIRED" | "UNSAFE_MATCH" | "WRONG_MATCH" | "AI_OUTPUT_INVALID";

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

function codeOf(candidateId: string | null): string | null {
  if (!candidateId) return null;
  return BENCH_CATALOG.find((b) => b.id === candidateId)?.code ?? candidateId;
}

// Clasificación en los buckets pedidos. Un estado que NO compromete un
// candidato (REVIEW / NO_MATCH / REVIEW_REQUIRED) nunca puede ser unsafe.
function classify(
  expectedDecision: ExpectedDecision,
  expectedCode: string | null,
  status: FinalStatus,
  committedCode: string | null
): Bucket {
  if (status === "INVALID") return "AI_OUTPUT_INVALID";
  if (status === "REVIEW_REQUIRED") return "REVIEW_REQUIRED";
  if (status === "SUGGESTED") {
    if (expectedDecision !== "MATCH") return "UNSAFE_MATCH";
    return committedCode === expectedCode ? "EXACT_CORRECT" : "WRONG_MATCH";
  }
  // REVIEW / NO_MATCH
  const expectedAsStatus = expectedDecision === "MATCH" ? "SUGGESTED" : expectedDecision;
  return status === expectedAsStatus ? "EXACT_CORRECT" : "SAFE_ABSTENTION";
}

// Evidencia mostrable para un REVIEW_REQUIRED — re-derivada SOLO para el
// reporte, con helpers ya exportados (no se toca technical-integrity.ts).
function evidenceFor(c: BenchCase, reason: string | null): string {
  const parts: string[] = [];
  parts.push(`name=${JSON.stringify(c.name)}`);
  if (c.material) parts.push(`material=${JSON.stringify(c.material)}`);
  if (c.properties && Object.keys(c.properties).length > 0) parts.push(`properties=${JSON.stringify(c.properties)}`);
  if (reason === "AMBIGUOUS_RANGE") {
    const inRange = BENCH_CATALOG.map((b) => ({ code: b.code, mm: extractSpecs(b.description).thicknessMm, unit: b.unit }))
      .filter((b) => b.mm != null && b.unit === c.quantityUnit)
      .map((b) => `${b.code}=${b.mm}mm`);
    parts.push(`espesores del catálogo en la misma unidad: ${inRange.join(", ")}`);
  }
  return parts.join(" | ");
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("Falta DEEPSEEK_API_KEY.");
    process.exit(1);
  }

  console.log(`Benchmark COMPLETO — ${BENCH_CASES.length} casos, catálogo de ${BENCH_CATALOG.length} rubros.`);
  console.log(`Pipeline: buildCandidatePool -> checkTechnicalIntegrity -> DeepSeekBatchSemanticMatcher (batches de ${GROUP_BATCH_SIZE})\n`);

  const matcher = new DeepSeekBatchSemanticMatcher();

  const prepared = BENCH_CASES.map((c) => {
    const element = toBimElement(c);
    const candidates = buildCandidatePool(element, BENCH_CATALOG);
    const integrity = checkTechnicalIntegrity(element, BENCH_CATALOG);
    return { case: c, integrity, candidateCount: candidates.length, input: toSemanticMatchInput(element, candidates) };
  });

  const rawByCase = new Map<string, { decision: ExpectedDecision; candidateId: string | null; confidence: number; reason: string } | null>();
  let totalTokens = 0;
  const batchLatencies: number[] = [];
  const startedAt = Date.now();

  for (let i = 0; i < prepared.length; i += GROUP_BATCH_SIZE) {
    const chunk = prepared.slice(i, i + GROUP_BATCH_SIZE);
    const items: BatchMatchItem[] = chunk.map((p) => ({ elementId: p.case.id, input: p.input }));
    const results = await matcher.matchBatch(items);
    totalTokens += matcher.lastUsage?.totalTokens ?? 0;
    if (matcher.lastUsage?.latencyMs != null) batchLatencies.push(matcher.lastUsage.latencyMs);
    for (const p of chunk) {
      const r = results.get(p.case.id);
      rawByCase.set(p.case.id, r ? { decision: r.decision, candidateId: r.candidateId, confidence: r.confidence, reason: r.reason } : null);
    }
    process.stdout.write(`  ... ${Math.min(i + GROUP_BATCH_SIZE, prepared.length)}/${prepared.length} casos\n`);
  }
  const elapsedMs = Date.now() - startedAt;

  // --- Resolución final por caso (CON y SIN capa de integridad) -------------
  const rows = prepared.map((p) => {
    const raw = rawByCase.get(p.case.id) ?? null;
    const rawCode = codeOf(raw?.candidateId ?? null);

    const statusWithout: FinalStatus = !raw
      ? "INVALID"
      : raw.decision === "MATCH" && raw.candidateId
        ? "SUGGESTED"
        : raw.decision === "REVIEW"
          ? "REVIEW"
          : "NO_MATCH";

    const statusWith: FinalStatus = !raw ? "INVALID" : p.integrity.vicious ? "REVIEW_REQUIRED" : statusWithout;

    const committedWithout = statusWithout === "SUGGESTED" ? rawCode : null;
    const committedWith = statusWith === "SUGGESTED" ? rawCode : null;

    return {
      id: p.case.id,
      category: p.case.category,
      group: p.case.group ?? null,
      name: p.case.name,
      expectedDecision: p.case.expectedDecision,
      expectedCode: p.case.expectedCode ?? null,
      integrityVicious: p.integrity.vicious,
      integrityReason: p.integrity.reason,
      candidateCount: p.candidateCount,
      rawDecision: raw?.decision ?? null,
      rawCode,
      confidence: raw?.confidence ?? null,
      reason: raw?.reason ?? null,
      statusWithout,
      statusWith,
      committedWithout,
      committedWith,
      bucketWithout: classify(p.case.expectedDecision, p.case.expectedCode ?? null, statusWithout, committedWithout),
      bucketWith: classify(p.case.expectedDecision, p.case.expectedCode ?? null, statusWith, committedWith),
      // Falso positivo de integridad: se forzó revisión en un caso cuyo golden
      // dice que había una única respuesta correcta y limpia.
      integrityFalsePositive: p.integrity.vicious && p.case.expectedDecision === "MATCH",
    };
  });

  const total = rows.length;
  const countBuckets = (key: "bucketWith" | "bucketWithout") => {
    const acc: Record<Bucket, number> = {
      EXACT_CORRECT: 0,
      SAFE_ABSTENTION: 0,
      REVIEW_REQUIRED: 0,
      UNSAFE_MATCH: 0,
      WRONG_MATCH: 0,
      AI_OUTPUT_INVALID: 0,
    };
    for (const r of rows) acc[r[key]] += 1;
    return acc;
  };
  const bucketsWith = countBuckets("bucketWith");
  const bucketsWithout = countBuckets("bucketWithout");

  // Decision accuracy estricta: REVIEW_REQUIRED != REVIEW.
  const strictCorrect = rows.filter((r) => r.bucketWith === "EXACT_CORRECT").length;
  // Decision accuracy tratando REVIEW_REQUIRED como abstención válida donde el
  // golden ya pedía abstención (REVIEW) — misma consecuencia operativa.
  const safetyEquivalentCorrect = rows.filter(
    (r) => r.bucketWith === "EXACT_CORRECT" || (r.bucketWith === "REVIEW_REQUIRED" && r.expectedDecision === "REVIEW")
  ).length;

  const matchExpected = rows.filter((r) => r.expectedDecision === "MATCH");
  const candidateCorrect = matchExpected.filter((r) => r.committedWith === r.expectedCode).length;

  // Consistency groups sobre el candidato COMPROMETIDO final.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.group) continue;
    const arr = groups.get(r.group) ?? [];
    arr.push(r);
    groups.set(r.group, arr);
  }
  const groupReport = [...groups].map(([group, arr]) => {
    const codes = arr.map((r) => r.committedWith);
    return { group, size: arr.length, consistent: codes.every((c) => c === codes[0]), codes };
  });
  const consistentGroups = groupReport.filter((g) => g.consistent).length;

  const avgBatchLatency = batchLatencies.reduce((s, n) => s + n, 0) / (batchLatencies.length || 1);

  // ==========================  REPORTE  ====================================
  console.log("\n========================================================");
  console.log("BENCHMARK COMPLETO — pipeline actual (con capa REVIEW_REQUIRED)");
  console.log("========================================================");
  console.log(`TOTAL:                 ${total}`);
  console.log(`EXACT_CORRECT:         ${bucketsWith.EXACT_CORRECT}`);
  console.log(`SAFE_ABSTENTION:       ${bucketsWith.SAFE_ABSTENTION}`);
  console.log(`REVIEW_REQUIRED:       ${bucketsWith.REVIEW_REQUIRED}`);
  console.log(`UNSAFE_MATCH:          ${bucketsWith.UNSAFE_MATCH}   <- criterio crítico (debe ser 0)`);
  console.log(`WRONG_MATCH:           ${bucketsWith.WRONG_MATCH}   <- criterio crítico (debe ser 0)`);
  console.log(`AI_OUTPUT_INVALID:     ${bucketsWith.AI_OUTPUT_INVALID}`);
  console.log(`\ndecision accuracy (estricta):              ${strictCorrect}/${total} (${((strictCorrect / total) * 100).toFixed(1)}%)`);
  console.log(
    `decision accuracy (REVIEW_REQUIRED≈REVIEW):  ${safetyEquivalentCorrect}/${total} (${((safetyEquivalentCorrect / total) * 100).toFixed(1)}%)`
  );
  console.log(`candidate accuracy (sobre ${matchExpected.length} MATCH esperados): ${candidateCorrect}/${matchExpected.length} (${((candidateCorrect / matchExpected.length) * 100).toFixed(1)}%)`);
  console.log(`consistency groups:    ${consistentGroups}/${groupReport.length}`);
  console.log(`tokens totales:        ${totalTokens}`);
  console.log(`latencia media/batch:  ${avgBatchLatency.toFixed(0)}ms  (${batchLatencies.length} batches, wall-clock ${(elapsedMs / 1000).toFixed(1)}s)`);

  console.log("\n--- Atribución: MISMA corrida, sin vs. con capa de integridad ---");
  console.log("bucket".padEnd(22), "SIN capa".padEnd(12), "CON capa");
  for (const b of ["EXACT_CORRECT", "SAFE_ABSTENTION", "REVIEW_REQUIRED", "UNSAFE_MATCH", "WRONG_MATCH", "AI_OUTPUT_INVALID"] as Bucket[]) {
    console.log(b.padEnd(22), String(bucketsWithout[b]).padEnd(12), String(bucketsWith[b]));
  }

  const reviewRequired = rows.filter((r) => r.bucketWith === "REVIEW_REQUIRED");
  console.log(`\n--- REVIEW_REQUIRED (${reviewRequired.length}) ---`);
  for (const r of reviewRequired) {
    const flag = r.integrityFalsePositive ? "  [!!] POSIBLE FALSO POSITIVO (el golden esperaba MATCH limpio)" : "";
    console.log(`  ${r.id} [${r.category}] reason=${r.integrityReason}${flag}`);
    console.log(`      golden: ${r.expectedDecision}${r.expectedCode ? ":" + r.expectedCode : ""}   |   sin capa habría sido: ${r.statusWithout}${r.committedWithout ? ":" + r.committedWithout : ""}`);
    const original = BENCH_CASES.find((c) => c.id === r.id)!;
    console.log(`      evidencia: ${evidenceFor(original, r.integrityReason)}`);
  }

  const falsePositives = rows.filter((r) => r.integrityFalsePositive);
  console.log(`\n--- FALSOS POSITIVOS DE INTEGRIDAD: ${falsePositives.length} ---`);
  for (const r of falsePositives) {
    console.log(`  ${r.id} [${r.category}] reason=${r.integrityReason} — golden esperaba MATCH:${r.expectedCode}`);
  }

  const unsafe = rows.filter((r) => r.bucketWith === "UNSAFE_MATCH");
  const wrong = rows.filter((r) => r.bucketWith === "WRONG_MATCH");
  const invalid = rows.filter((r) => r.bucketWith === "AI_OUTPUT_INVALID");

  if (unsafe.length > 0) {
    console.log(`\n--- UNSAFE_MATCH (${unsafe.length}) ---`);
    for (const r of unsafe) {
      console.log(`  ${r.id} [${r.category}] "${r.name}"`);
      console.log(`      golden=${r.expectedDecision}  obtenido=SUGGESTED:${r.committedWith} confidence=${r.confidence}`);
      console.log(`      integrity=${r.integrityVicious} (${r.integrityReason ?? "-"})   razón DeepSeek: ${r.reason}`);
    }
  }
  if (wrong.length > 0) {
    console.log(`\n--- WRONG_MATCH (${wrong.length}) ---`);
    for (const r of wrong) {
      console.log(`  ${r.id} [${r.category}] "${r.name}"`);
      console.log(`      golden=MATCH:${r.expectedCode}  obtenido=SUGGESTED:${r.committedWith} confidence=${r.confidence}`);
      console.log(`      razón DeepSeek: ${r.reason}`);
    }
  }
  if (invalid.length > 0) {
    console.log(`\n--- AI_OUTPUT_INVALID (${invalid.length}) ---`);
    for (const r of invalid) console.log(`  ${r.id} [${r.category}] "${r.name}" (sin resultado usable del modelo)`);
  }

  const safeAbst = rows.filter((r) => r.bucketWith === "SAFE_ABSTENTION");
  console.log(`\n--- SAFE_ABSTENTION (${safeAbst.length}) ---`);
  for (const r of safeAbst) {
    console.log(`  ${r.id} [${r.category}] golden=${r.expectedDecision}${r.expectedCode ? ":" + r.expectedCode : ""} -> ${r.statusWith}  integrity=${r.integrityVicious}`);
  }

  console.log("\n--- Por categoría (CON capa) ---");
  const byCat = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const acc = byCat.get(r.category) ?? {};
    acc[r.bucketWith] = (acc[r.bucketWith] ?? 0) + 1;
    acc.total = (acc.total ?? 0) + 1;
    byCat.set(r.category, acc);
  }
  for (const [cat, acc] of byCat) {
    const parts = Object.entries(acc)
      .filter(([k]) => k !== "total")
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(`  ${cat.padEnd(24)} (${acc.total})  ${parts}`);
  }

  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        pipeline: "buildCandidatePool -> checkTechnicalIntegrity -> DeepSeekBatchSemanticMatcher",
        batchSize: GROUP_BATCH_SIZE,
        total,
        bucketsWith,
        bucketsWithout,
        strictDecisionAccuracy: strictCorrect / total,
        safetyEquivalentDecisionAccuracy: safetyEquivalentCorrect / total,
        candidateAccuracy: candidateCorrect / matchExpected.length,
        consistentGroups,
        consistencyGroups: groupReport,
        totalTokens,
        avgBatchLatencyMs: avgBatchLatency,
        elapsedMs,
        integrityFalsePositives: falsePositives.map((r) => r.id),
        rows,
      },
      null,
      2
    )
  );
  console.log(`\nReporte completo: ${OUT_PATH}`);
}

void main();
