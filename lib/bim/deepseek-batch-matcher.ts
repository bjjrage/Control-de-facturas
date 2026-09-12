// Variante en LOTE del matcher semántico DeepSeek — mismo modelo/proveedor
// que deepseek-matcher.ts (DeepSeekSemanticMatcher, sin tocar), pero evalúa
// varios grupos BIM en una sola llamada para no pagar una request por cada
// grupo cuando hay muchos. Prompt PROPIO (nunca reutiliza ni modifica el
// system prompt individual) — validado en el stress test de 60 elementos
// (live-stress-test.spec.ts): 100% accuracy, 0 falsos positivos, mismo
// comportamiento que la variante individual.
//
// Reglas idénticas a deepseek-matcher.ts: API key solo server-side, nunca se
// loguea, nunca hay fallback silencioso a fuzzy matching, y cualquier
// candidate_id que el modelo devuelva fuera de la whitelist de ESE elemento
// se descarta (nunca se confía ciegamente).
import type { SemanticMatchInput, SemanticMatchResult } from "./semantic-matcher";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_TIMEOUT_MS = 60000;

export class DeepSeekBatchConfigError extends Error {}
export class DeepSeekBatchRequestError extends Error {}
export class DeepSeekBatchResponseError extends Error {}

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

export interface BatchMatchItem {
  elementId: string;
  input: SemanticMatchInput;
}

export interface BatchUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export interface DeepSeekBatchMatcherOptions {
  apiKey?: string;
  timeoutMs?: number;
  baseUrl?: string;
  model?: string;
}

export class DeepSeekBatchSemanticMatcher {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly model: string;

  public lastUsage: BatchUsage | null = null;

  constructor(options: DeepSeekBatchMatcherOptions = {}) {
    const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new DeepSeekBatchConfigError(
        "DEEPSEEK_API_KEY no está configurada. El matcher semántico DeepSeek la requiere server-side; " +
          "no existe un fallback silencioso a fuzzy matching cuando falta."
      );
    }
    this.apiKey = apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = options.baseUrl ?? DEEPSEEK_BASE_URL;
    this.model = options.model ?? DEEPSEEK_MODEL;
  }

  async matchBatch(items: BatchMatchItem[]): Promise<Map<string, SemanticMatchResult>> {
    if (items.length === 0) return new Map();

    const validIdsByElement = new Map(items.map((it) => [it.elementId, new Set(it.input.candidates.map((c) => c.id))]));
    const payload = {
      elements: items.map((it) => ({
        element_id: it.elementId,
        bim: it.input.bim,
        candidates: it.input.candidates.map((c) => ({ id: c.id, code: c.code, description: c.description, unit: c.unit, unit_price: c.unitPrice })),
      })),
    };

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
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
        throw new DeepSeekBatchRequestError(`DeepSeek (batch) no respondió dentro de ${this.timeoutMs}ms.`);
      }
      throw new DeepSeekBatchRequestError(`Error de red llamando a DeepSeek (batch): ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new DeepSeekBatchRequestError(`DeepSeek (batch) respondió HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
    }

    const json = await response.json();
    const latencyMs = Date.now() - startedAt;
    const usage = json?.usage;
    this.lastUsage = {
      promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
      completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0,
      totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : 0,
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

    const results = new Map<string, SemanticMatchResult>();
    for (const raw of matches) {
      const r = raw as Record<string, unknown>;
      const elementId = typeof r.element_id === "string" ? r.element_id : null;
      if (!elementId || !validIdsByElement.has(elementId)) continue;
      const decision = r.decision;
      if (decision !== "MATCH" && decision !== "REVIEW" && decision !== "NO_MATCH") continue;
      let candidateId = typeof r.candidate_id === "string" ? r.candidate_id : null;
      if (decision === "MATCH") {
        const validForThisElement = validIdsByElement.get(elementId)!;
        if (!candidateId || !validForThisElement.has(candidateId)) continue; // candidate cruzado/inventado -> se descarta
      } else {
        candidateId = null;
      }
      const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
      const reason = typeof r.reason === "string" ? r.reason : "";
      results.set(elementId, { decision, candidateId, confidence, reason, warnings: [] });
    }

    return results;
  }
}
