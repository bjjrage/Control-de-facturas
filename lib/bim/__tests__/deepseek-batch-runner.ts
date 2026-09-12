// Harness de TEST para comparar la estrategia de batching contra el matcher
// individual (deepseek-matcher.ts). NO es código de producción, NO se
// importa desde bim-actions.ts, y usa un prompt de sistema PROPIO — a
// propósito nunca reutiliza ni modifica el prompt individual (para no
// "favorecer artificialmente" ninguna de las dos estrategias).
import type { SemanticMatchInput } from "../semantic-matcher";

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const BATCH_TIMEOUT_MS = 60000;

const BATCH_SYSTEM_PROMPT = `Actuás como clasificador técnico de partidas de construcción, en modo LOTE.

Se te da una lista de elementos extraídos de un modelo BIM (IFC), cada uno con su propia lista de rubros económicos candidatos. Para CADA elemento, determiná si corresponde semántica y técnicamente a alguno de SUS candidatos (nunca a los candidatos de otro elemento de la lista).

Reglas (idénticas para cada elemento, evaluados de forma independiente):
1. No inventes rubros. Para cada elemento, solo podés elegir un candidate_id de SU PROPIA lista de candidates.
2. No inventes precios. El precio es solo contexto.
3. El precio NO determina equivalencia técnica.
4. Respetá unidad, material, espesor, resistencia, dimensión y especificaciones técnicas.
5. Si existe incompatibilidad técnica clara con todos los candidatos de ese elemento, no hagas match para ese elemento.
6. Si faltan datos para distinguir entre candidatos plausibles de ese elemento, respondé REVIEW para ese elemento.
7. Si ningún candidato de ese elemento es técnicamente equivalente, respondé NO_MATCH para ese elemento.
8. Elegí MATCH solo cuando exista evidencia técnica suficiente, evaluando cada elemento de forma independiente de los demás.
9. La similitud de texto/nombre por sí sola NO es evidencia suficiente.
10. Devolvé EXCLUSIVAMENTE un objeto JSON con este schema, un resultado por cada elemento recibido, en el mismo orden:
{"matches":[{"element_id":string,"decision":"MATCH"|"REVIEW"|"NO_MATCH","candidate_id":string|null,"confidence":number entre 0 y 1,"reason":string breve}]}
candidate_id debe ser null salvo que decision sea "MATCH", y debe pertenecer a la lista de candidates de ESE element_id.`;

export class DeepSeekBatchConfigError extends Error {}
export class DeepSeekBatchRequestError extends Error {}
export class DeepSeekBatchResponseError extends Error {}

export interface BatchItemInput {
  elementId: string;
  input: SemanticMatchInput;
}

export interface BatchItemResult {
  elementId: string;
  decision: "MATCH" | "REVIEW" | "NO_MATCH";
  candidateId: string | null;
  confidence: number;
  reason: string;
}

export interface BatchCallUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export interface BatchCallOutcome {
  results: Map<string, BatchItemResult>;
  usage: BatchCallUsage;
}

export async function callDeepSeekBatch(items: BatchItemInput[]): Promise<BatchCallOutcome> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new DeepSeekBatchConfigError("DEEPSEEK_API_KEY no está configurada — sin fallback a mock.");
  }
  if (items.length === 0) return { results: new Map(), usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 } };

  const validIdsByElement = new Map(items.map((it) => [it.elementId, new Set(it.input.candidates.map((c) => c.id))]));
  const payload = {
    elements: items.map((it) => ({
      element_id: it.elementId,
      bim: it.input.bim,
      candidates: it.input.candidates.map((c) => ({ id: c.id, code: c.code, description: c.description, unit: c.unit, unit_price: c.unitPrice })),
    })),
  };

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: BATCH_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new DeepSeekBatchRequestError(`DeepSeek (batch) no respondió dentro de ${BATCH_TIMEOUT_MS}ms.`);
    }
    throw new DeepSeekBatchRequestError(`Error de red (batch): ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new DeepSeekBatchRequestError(`DeepSeek (batch) respondió HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  const json = await response.json();
  const latencyMs = Date.now() - startedAt;
  const usageRaw = json?.usage;
  const usage: BatchCallUsage = {
    promptTokens: typeof usageRaw?.prompt_tokens === "number" ? usageRaw.prompt_tokens : 0,
    completionTokens: typeof usageRaw?.completion_tokens === "number" ? usageRaw.completion_tokens : 0,
    totalTokens: typeof usageRaw?.total_tokens === "number" ? usageRaw.total_tokens : 0,
    latencyMs,
  };

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new DeepSeekBatchResponseError("Respuesta de DeepSeek (batch) sin contenido de texto.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new DeepSeekBatchResponseError(`DeepSeek (batch) no devolvió JSON válido: ${content.slice(0, 500)}`);
  }
  const matches = (parsed as { matches?: unknown })?.matches;
  if (!Array.isArray(matches)) {
    throw new DeepSeekBatchResponseError('Respuesta de DeepSeek (batch) sin array "matches".');
  }

  const results = new Map<string, BatchItemResult>();
  for (const raw of matches) {
    const r = raw as Record<string, unknown>;
    const elementId = typeof r.element_id === "string" ? r.element_id : null;
    if (!elementId || !validIdsByElement.has(elementId)) continue; // ignorar element_id inventado/desconocido
    const decision = r.decision;
    if (decision !== "MATCH" && decision !== "REVIEW" && decision !== "NO_MATCH") continue;
    let candidateId = typeof r.candidate_id === "string" ? r.candidate_id : null;
    if (decision === "MATCH") {
      const validForThisElement = validIdsByElement.get(elementId)!;
      if (!candidateId || !validForThisElement.has(candidateId)) continue; // candidate_id cruzado o inventado -> se descarta esa entrada
    } else {
      candidateId = null;
    }
    const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
    const reason = typeof r.reason === "string" ? r.reason : "";
    results.set(elementId, { elementId, decision, candidateId, confidence, reason });
  }

  return { results, usage };
}
