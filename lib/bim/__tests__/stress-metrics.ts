// Helper de métricas para el stress test del matcher semántico. Vive junto a
// los tests (no es código de producción) — solo agrega/clasifica resultados
// ya obtenidos de DeepSeek real, no toma ninguna decisión de matching.
import type { SemanticMatchDecision } from "../semantic-matcher";
import type { StressCase } from "./fixtures/aurora-stress-dataset";
import { auroraItemByCode } from "./fixtures/aurora-budget-items";

export interface StressRunResult {
  caseId: string;
  decision: SemanticMatchDecision;
  candidateCode: string | null;
  confidence: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  retries: number;
  error?: string;
}

export type Verdict =
  | "CORRECT_MATCH"
  | "CORRECT_REVIEW"
  | "CORRECT_NO_MATCH"
  | "WRONG_MATCH" // MATCH esperado, matcheó pero al candidato equivocado
  | "FALSE_POSITIVE" // no se esperaba MATCH (REVIEW/NO_MATCH) y matcheó igual
  | "FALSE_NEGATIVE" // se esperaba MATCH y no matcheó (REVIEW o NO_MATCH)
  | "UNEXPECTED_REVIEW" // se esperaba NO_MATCH y respondió REVIEW (cauteloso de más, no grave)
  | "ERROR";

export function classify(expected: StressCase, actual: StressRunResult): Verdict {
  if (actual.error) return "ERROR";
  const exp = expected.expectedDecision;
  const act = actual.decision;

  if (exp === "MATCH") {
    if (act === "MATCH") {
      return actual.candidateCode === expected.expectedCandidateCode ? "CORRECT_MATCH" : "WRONG_MATCH";
    }
    return "FALSE_NEGATIVE"; // esperado MATCH, el modelo no lo dio
  }
  if (exp === "REVIEW") {
    if (act === "REVIEW") return "CORRECT_REVIEW";
    if (act === "MATCH") return "FALSE_POSITIVE";
    return "CORRECT_NO_MATCH"; // NO_MATCH cuando se esperaba REVIEW: aceptable, no es un falso positivo
  }
  // exp === "NO_MATCH"
  if (act === "NO_MATCH") return "CORRECT_NO_MATCH";
  if (act === "MATCH") return "FALSE_POSITIVE";
  return "UNEXPECTED_REVIEW";
}

export interface ConsistencyIssue {
  group: string;
  outcomes: Array<{ caseId: string; decision: SemanticMatchDecision; candidateCode: string | null }>;
}

export function findConsistencyIssues(dataset: StressCase[], results: Map<string, StressRunResult>): ConsistencyIssue[] {
  const groups = new Map<string, StressCase[]>();
  for (const c of dataset) {
    if (!c.consistencyGroup) continue;
    (groups.get(c.consistencyGroup) ?? groups.set(c.consistencyGroup, []).get(c.consistencyGroup)!).push(c);
  }
  const issues: ConsistencyIssue[] = [];
  for (const [group, cases] of groups) {
    const outcomes = cases.map((c) => {
      const r = results.get(c.id);
      return { caseId: c.id, decision: r?.decision ?? ("ERROR" as SemanticMatchDecision), candidateCode: r?.candidateCode ?? null };
    });
    const distinctSignatures = new Set(outcomes.map((o) => `${o.decision}:${o.candidateCode}`));
    if (distinctSignatures.size > 1) issues.push({ group, outcomes });
  }
  return issues;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export interface AggregateMetrics {
  total: number;
  correctMatches: number;
  correctReviews: number;
  correctNoMatch: number;
  wrongMatches: number;
  falsePositives: number;
  falseNegatives: number;
  unexpectedReviews: number;
  errors: number;
  accuracy: number;
  falsePositiveRate: number;
  abstentionAccuracy: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalRetries: number;
}

export function aggregate(dataset: StressCase[], results: Map<string, StressRunResult>): AggregateMetrics {
  const verdicts = dataset.map((c) => classify(c, results.get(c.id) ?? { caseId: c.id, decision: "NO_MATCH", candidateCode: null, confidence: 0, latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, retries: 0, error: "sin resultado" }));

  const count = (v: Verdict) => verdicts.filter((x) => x === v).length;
  const correctMatches = count("CORRECT_MATCH");
  const correctReviews = count("CORRECT_REVIEW");
  const correctNoMatch = count("CORRECT_NO_MATCH");
  const wrongMatches = count("WRONG_MATCH");
  const falsePositives = count("FALSE_POSITIVE");
  const falseNegatives = count("FALSE_NEGATIVE");
  const unexpectedReviews = count("UNEXPECTED_REVIEW");
  const errors = count("ERROR");

  const total = dataset.length;
  const correct = correctMatches + correctReviews + correctNoMatch;
  const abstentionExpected = dataset.filter((c) => c.expectedDecision !== "MATCH").length;
  const abstentionCorrect = correctReviews + correctNoMatch;

  const latencies = [...results.values()].map((r) => r.latencyMs).filter((n) => n >= 0).sort((a, b) => a - b);
  const totalTokens = [...results.values()].reduce((s, r) => s + Math.max(r.totalTokens, 0), 0);
  const inputTokens = [...results.values()].reduce((s, r) => s + Math.max(r.promptTokens, 0), 0);
  const outputTokens = [...results.values()].reduce((s, r) => s + Math.max(r.completionTokens, 0), 0);
  const totalRetries = [...results.values()].reduce((s, r) => s + r.retries, 0);

  return {
    total,
    correctMatches,
    correctReviews,
    correctNoMatch,
    wrongMatches,
    falsePositives,
    falseNegatives,
    unexpectedReviews,
    errors,
    accuracy: total > 0 ? correct / total : 0,
    falsePositiveRate: total > 0 ? falsePositives / total : 0,
    abstentionAccuracy: abstentionExpected > 0 ? abstentionCorrect / abstentionExpected : 1,
    totalTokens,
    inputTokens,
    outputTokens,
    totalLatencyMs: latencies.reduce((s, n) => s + n, 0),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    totalRetries,
  };
}

export function candidateCodeOf(candidateId: string | null): string | null {
  if (!candidateId) return null;
  try {
    // AURORA_BUDGET_ITEMS ids son "aurora-<code>" — ver aurora-budget-items.ts
    const found = candidateId.startsWith("aurora-") ? candidateId.slice("aurora-".length) : candidateId;
    // valida que exista de verdad en el catálogo (nunca confiar ciegamente)
    auroraItemByCode(found);
    return found;
  } catch {
    return candidateId; // el modelo devolvió un id que no resuelve a un código conocido
  }
}
