// Adapter server-side para DeepSeek — implementación concreta de
// SemanticMatcher (ver semantic-matcher.ts). Server-only: lee
// process.env.DEEPSEEK_API_KEY, nunca debe importarse desde un componente
// "use client" (Next.js lo excluiría del bundle de todos modos al no haber
// ninguna directiva de cliente acá, pero el llamador es responsable de solo
// instanciarlo desde código server-side, ej. una server action).
//
// Reglas duras de este adapter:
//   - la API key nunca se loguea, ni siquiera en los mensajes de error;
//   - si falta la API key, TIRA (DeepSeekConfigError) — nunca hay un
//     fallback silencioso a fuzzy matching disfrazado de respuesta de IA;
//   - si la llamada falla, tira error, no se traga la excepción, no
//     inventa un resultado "razonable";
//   - si el modelo devuelve un candidate_id que no está en `candidates`,
//     se rechaza la respuesta completa (nunca se confía a ciegas en que el
//     modelo respetó el whitelist de IDs).
import type { SemanticMatcher, SemanticMatchInput, SemanticMatchResult } from "./semantic-matcher";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_TIMEOUT_MS = 20000;

export class DeepSeekConfigError extends Error {}
export class DeepSeekRequestError extends Error {}
export class DeepSeekResponseError extends Error {}

// Prompt de sistema corto y estricto — sin las respuestas esperadas de
// ningún test. El modelo debe poder abstenerse (REVIEW) o rechazar
// (NO_MATCH); no se lo empuja a elegir siempre.
const SYSTEM_PROMPT = `Actuás como clasificador técnico de partidas de construcción.

Se te da un elemento extraído de un modelo BIM (IFC) y una lista de rubros económicos candidatos (de un presupuesto/catálogo de costos). Debés determinar si el elemento BIM corresponde semántica y técnicamente a alguno de los rubros suministrados.

Reglas:
1. No inventes rubros. Solo podés elegir un candidate_id incluido en "candidates".
2. No inventes precios. El precio se te da solo como contexto del rubro.
3. El precio NO determina equivalencia técnica — nunca elijas un candidato porque su precio "parezca razonable".
4. Respetá unidad, material, espesor, resistencia, dimensión y especificaciones técnicas cuando estén disponibles. Una incompatibilidad técnica clara (ej. resistencia de hormigón distinta, unidad de medida distinta) descarta el candidato aunque el texto se parezca.
5. Si existe incompatibilidad técnica clara con todos los candidatos, no hagas match.
6. Si faltan datos para distinguir entre candidatos plausibles, respondé REVIEW — no elijas arbitrariamente.
7. Si ningún candidato es técnicamente equivalente al elemento BIM, respondé NO_MATCH.
8. Elegí MATCH solo cuando exista evidencia técnica suficiente de equivalencia.
9. La similitud de texto/nombre por sí sola NO es evidencia suficiente — un nombre parecido con material o especificación distinta debe rechazarse.
10. Devolvé EXCLUSIVAMENTE un objeto JSON con este schema, sin texto adicional:
{"decision":"MATCH"|"REVIEW"|"NO_MATCH","candidate_id":string|null,"confidence":number entre 0 y 1,"reason":string breve en una oración,"warnings":string[]}
candidate_id debe ser null salvo que decision sea "MATCH".`;

export interface DeepSeekMatcherOptions {
  apiKey?: string;
  timeoutMs?: number;
  baseUrl?: string;
  model?: string;
}

export interface DeepSeekUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export class DeepSeekSemanticMatcher implements SemanticMatcher {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly model: string;

  // Instrumentación de solo lectura para reporting (tokens/latencia de la
  // última llamada) — no participa de la decisión de match ni del prompt.
  public lastUsage: DeepSeekUsage | null = null;

  constructor(options: DeepSeekMatcherOptions = {}) {
    const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new DeepSeekConfigError(
        "DEEPSEEK_API_KEY no está configurada. El matcher semántico DeepSeek la requiere server-side; " +
          "no existe un fallback silencioso a fuzzy matching cuando falta."
      );
    }
    this.apiKey = apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = options.baseUrl ?? DEEPSEEK_BASE_URL;
    this.model = options.model ?? DEEPSEEK_MODEL;
  }

  async match(input: SemanticMatchInput): Promise<SemanticMatchResult> {
    if (input.candidates.length === 0) {
      return {
        decision: "NO_MATCH",
        candidateId: null,
        confidence: 1,
        reason: "No hay candidatos técnicamente compatibles para evaluar.",
        warnings: [],
      };
    }

    const validIds = new Set(input.candidates.map((c) => c.id));
    const userPayload = {
      bim: input.bim,
      candidates: input.candidates.map((c) => ({
        id: c.id,
        code: c.code,
        description: c.description,
        unit: c.unit,
        unit_price: c.unitPrice,
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
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(userPayload) },
          ],
        }),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new DeepSeekRequestError(`DeepSeek no respondió dentro de ${this.timeoutMs}ms (timeout).`);
      }
      throw new DeepSeekRequestError(
        `Error de red llamando a DeepSeek: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new DeepSeekRequestError(`DeepSeek respondió HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
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
      throw new DeepSeekResponseError("Respuesta de DeepSeek sin contenido de texto en choices[0].message.content.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new DeepSeekResponseError(`DeepSeek no devolvió JSON válido: ${content.slice(0, 500)}`);
    }

    return validateAndNormalize(parsed, validIds);
  }
}

function validateAndNormalize(parsed: unknown, validIds: Set<string>): SemanticMatchResult {
  if (typeof parsed !== "object" || parsed === null) {
    throw new DeepSeekResponseError("La respuesta de DeepSeek no es un objeto JSON.");
  }
  const p = parsed as Record<string, unknown>;

  const decision = p.decision;
  if (decision !== "MATCH" && decision !== "REVIEW" && decision !== "NO_MATCH") {
    throw new DeepSeekResponseError(`"decision" inválida o ausente en la respuesta de DeepSeek: ${JSON.stringify(p.decision)}`);
  }

  let candidateId = typeof p.candidate_id === "string" ? p.candidate_id : null;
  if (decision === "MATCH") {
    if (!candidateId) {
      throw new DeepSeekResponseError('decision="MATCH" pero candidate_id es null — respuesta descartada.');
    }
    if (!validIds.has(candidateId)) {
      // El modelo "inventó" un id fuera de la lista suministrada — nunca se
      // confía ciegamente en que respetó el whitelist.
      throw new DeepSeekResponseError(
        `DeepSeek devolvió candidate_id "${candidateId}" que no pertenece a los candidatos suministrados.`
      );
    }
  } else {
    candidateId = null; // por contrato: REVIEW/NO_MATCH nunca fijan un candidato.
  }

  const confidenceRaw = p.confidence;
  const confidence = typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0;
  const reason = typeof p.reason === "string" ? p.reason : "";
  const warnings = Array.isArray(p.warnings) ? p.warnings.filter((w): w is string => typeof w === "string") : [];

  return { decision, candidateId, confidence, reason, warnings };
}
