// Corre SOLO un subconjunto de casos del dataset congelado contra el
// pipeline REAL de producción (buildCandidatePool -> checkTechnicalIntegrity
// -> DeepSeekBatchSemanticMatcher, igual que processBimGroups en
// app/(internal)/projects/[id]/bim-actions.ts), replicando exactamente cómo
// se combina el resultado de integridad técnica con el de DeepSeek.
//
// Uso: npx tsx scripts/bim-adversarial-benchmark/run-subset.ts 089 119 122 040 086 087 112
import { config as loadDotenv } from "dotenv";
import { join } from "path";

loadDotenv({ path: join(process.cwd(), ".env.local") });

import { buildCandidatePool, toSemanticMatchInput } from "../../lib/bim/semantic-pipeline";
import { DeepSeekBatchSemanticMatcher, type BatchMatchItem } from "../../lib/bim/deepseek-batch-matcher";
import { checkTechnicalIntegrity } from "../../lib/bim/technical-integrity";
import type { BimElement } from "../../lib/types";
import { BENCH_CATALOG } from "./catalog";
import { BENCH_CASES, type BenchCase } from "./dataset";

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

async function main() {
  const idPrefixes = process.argv.slice(2);
  if (idPrefixes.length === 0) {
    console.error("Uso: npx tsx scripts/bim-adversarial-benchmark/run-subset.ts <prefijo-id...>  (ej: 089 119 122)");
    process.exit(1);
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("Falta DEEPSEEK_API_KEY.");
    process.exit(1);
  }

  const selected = BENCH_CASES.filter((c) => idPrefixes.some((p) => c.id.startsWith(p)));
  if (selected.length !== idPrefixes.length) {
    const found = new Set(selected.map((c) => c.id));
    const missing = idPrefixes.filter((p) => ![...found].some((id) => id.startsWith(p)));
    console.error(`AVISO: no se encontraron casos para: ${missing.join(", ")}`);
  }

  console.log(`Corriendo ${selected.length} casos LIVE contra el pipeline real (candidatePool -> checkTechnicalIntegrity -> DeepSeekBatchSemanticMatcher)\n`);

  const matcher = new DeepSeekBatchSemanticMatcher();

  const prepared = selected.map((c) => {
    const element = toBimElement(c);
    const candidates = buildCandidatePool(element, BENCH_CATALOG);
    // Igual que processBimGroups: el chequeo recibe el catálogo COMPLETO, no
    // el pool ya filtrado por retrieval.
    const integrity = checkTechnicalIntegrity(element, BENCH_CATALOG);
    const input = toSemanticMatchInput(element, candidates);
    return { case: c, element, candidates, integrity, input };
  });

  const items: BatchMatchItem[] = prepared.map((p) => ({ elementId: p.case.id, input: p.input }));
  const batchResults = await matcher.matchBatch(items);

  console.log("========================================================");
  console.log("RESULTADOS POR CASO");
  console.log("========================================================\n");

  for (const p of prepared) {
    const deepseek = batchResults.get(p.case.id);
    const suggestedCandidateId = deepseek?.decision === "MATCH" ? deepseek.candidateId : null;

    let finalStatus: string;
    let finalCandidateCode: string | null = null;
    let finalReason: string;

    if (p.integrity.vicious) {
      finalStatus = "REVIEW_REQUIRED";
      finalCandidateCode = suggestedCandidateId ? BENCH_CATALOG.find((b) => b.id === suggestedCandidateId)?.code ?? suggestedCandidateId : null;
      finalReason = deepseek?.reason ? `[${p.integrity.reason}] ${deepseek.reason}` : `[${p.integrity.reason}] Input técnico contradictorio o ambiguo.`;
    } else if (deepseek?.decision === "MATCH" && deepseek.candidateId) {
      finalStatus = "SUGGESTED";
      finalCandidateCode = BENCH_CATALOG.find((b) => b.id === deepseek.candidateId)?.code ?? deepseek.candidateId;
      finalReason = deepseek.reason;
    } else if (deepseek?.decision === "REVIEW") {
      finalStatus = "REVIEW";
      finalReason = deepseek.reason;
    } else {
      finalStatus = "NO_MATCH";
      finalReason = deepseek?.reason ?? "";
    }

    console.log(`--- ${p.case.id} — "${p.case.name}" [${p.case.category}] ---`);
    console.log(`  esperado (dataset original): ${p.case.expectedDecision}${p.case.expectedCode ? ":" + p.case.expectedCode : ""}`);
    if (p.case.note) console.log(`  nota del caso: ${p.case.note}`);
    console.log(`  input: name=${JSON.stringify(p.case.name)} material=${JSON.stringify(p.case.material ?? null)} unit=${p.case.quantityUnit} qty=${p.case.quantityValue} properties=${JSON.stringify(p.case.properties ?? {})}`);
    console.log(`  candidates (${p.candidates.length}): ${p.candidates.map((c) => c.code).join(", ") || "(ninguno)"}`);
    console.log(`  integrity result: vicious=${p.integrity.vicious} reason=${p.integrity.reason ?? "-"}`);
    console.log(`  DeepSeek result: decision=${deepseek?.decision ?? "(sin respuesta)"} candidate=${suggestedCandidateId ? BENCH_CATALOG.find((b) => b.id === suggestedCandidateId)?.code : "-"} confidence=${deepseek?.confidence?.toFixed(2) ?? "-"} reason="${deepseek?.reason ?? ""}"`);
    console.log(`  FINAL: status=${finalStatus}${finalCandidateCode ? ":" + finalCandidateCode : ""}`);
    console.log(`  reason final: ${finalReason}`);
    console.log("");
  }
}

void main();
