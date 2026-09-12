// Reclasifica el reporte baseline YA CORRIDO (report.baseline.raw.json) con
// la nueva taxonomía de seguridad (EXACT_CORRECT/SAFE_ABSTENTION/
// UNSAFE_MATCH/WRONG_MATCH), SIN volver a llamar a DeepSeek — el baseline
// está congelado, esto solo re-etiqueta resultados ya obtenidos.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { classify } from "./classify";

const RAW_PATH = join(__dirname, "report.baseline.raw.json");
const OUT_PATH = join(__dirname, "report.baseline.json");

interface RawResult {
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
}

const raw = JSON.parse(readFileSync(RAW_PATH, "utf-8"));
const allResults: RawResult[] = raw.allResults;

const withSafety = allResults.map((r) => ({
  ...r,
  safetyClass: classify(r.expectedDecision, r.expectedCode, r.obtainedDecision, r.obtainedCode),
}));

const safetyCounts: Record<string, number> = { EXACT_CORRECT: 0, SAFE_ABSTENTION: 0, UNSAFE_MATCH: 0, WRONG_MATCH: 0, ERROR: 0 };
for (const r of withSafety) safetyCounts[r.safetyClass] += 1;

const out = {
  ...raw,
  avgLatencyMs: null, // no se registró latencia por caso en la corrida original — solo tokens/tiempo total
  safetyCounts,
  consistentGroups: raw.consistencyGroups.filter((g: { consistent: boolean }) => g.consistent).length,
  allResults: withSafety,
};

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
console.log("safetyCounts (baseline):", safetyCounts);
console.log(`Reclasificado en ${OUT_PATH}`);
