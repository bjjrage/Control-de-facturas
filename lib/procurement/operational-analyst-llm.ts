import { DailyWeatherForecast, OperationalStatus } from "@/lib/types";

export interface BudgetItemOperationalInput {
  budget_item_id: string;
  item_code: string;
  description: string;
  unit: string;
}

export interface OperationalAssessmentItem {
  budget_item_id: string;
  workability: OperationalStatus; // "NORMAL" | "PARTIAL" | "BLOCKED" | "DEGRADED" | "UNAVAILABLE"
  productive_factor: number; // 0.0 to 1.0
  reason: string;
  risk_flags?: string[];
}

export interface OperationalAnalysisOutput {
  items: OperationalAssessmentItem[];
  overall_summary: string;
  llm_used: boolean;
  is_degraded: boolean;
}

// In-memory cache for operational analysis runs by project and forecast hash
interface AnalysisCacheEntry {
  timestamp: number;
  output: OperationalAnalysisOutput;
}

const analysisCache = new Map<string, AnalysisCacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 4; // 4 hours

function generateCacheKey(
  projectId: string,
  items: BudgetItemOperationalInput[],
  forecasts: DailyWeatherForecast[]
): string {
  const itemIds = items.map((i) => i.budget_item_id).sort().join(",");
  const forecastSig = forecasts.map((f) => `${f.date}:${f.precipitation_sum_mm}:${f.weather_code}`).join("|");
  return `${projectId}__${itemIds}__${forecastSig}`;
}

/**
 * Explicit degraded fallback when LLM is unavailable and no cache exists.
 * STRICTURE: Does NOT invent arbitrary productive factors (e.g. mamposteria = 0.4).
 * Explicitly marks items as "DEGRADED" / "UNAVAILABLE" with factor 1.0 (raw unadjusted)
 * and flags them so the UI and engine clearly distinguish it from an AI-analyzed forecast.
 */
export function createDegradedOperationalFallback(
  items: BudgetItemOperationalInput[],
  reasonText: string = "Análisis operacional no disponible (sin LLM ni cache válido)."
): OperationalAnalysisOutput {
  return {
    items: items.map((item) => ({
      budget_item_id: item.budget_item_id,
      workability: "DEGRADED",
      productive_factor: 1.0, // Raw baseline, but marked explicitly as degraded
      reason: `Proyección base no ajustada por clima: ${reasonText}`,
      risk_flags: ["ANALISIS_CLIMATICO_NO_DISPONIBLE"],
    })),
    overall_summary: `ADVERTENCIA: ${reasonText} Se presenta proyección de ritmo base sin ajuste climático inteligente.`,
    llm_used: false,
    is_degraded: true,
  };
}

/**
 * Operates the LLM as an operational field expert.
 * STRICT CONTRACT: The LLM outputs ONLY qualitative workability and productive_factor (0..1).
 * It NEVER computes quantities, financial amounts, stock balances, or purchase totals.
 * 
 * FALLBACK POLICY (Order of precedence):
 * 1. Valid LLM response with JSON Schema validation.
 * 2. Reuse previous cached LLM analysis if matching project, items, and forecast window.
 * 3. Explicit degraded status (DEGRADED / UNAVAILABLE) without simulating fake semantic reasoning.
 */
export async function analyzeOperationalWorkability(
  projectId: string,
  items: BudgetItemOperationalInput[],
  forecasts: DailyWeatherForecast[]
): Promise<OperationalAnalysisOutput> {
  const cacheKey = generateCacheKey(projectId, items, forecasts);

  // 1. Check cache first
  const cached = analysisCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return {
      ...cached.output,
      overall_summary: `${cached.output.overall_summary} (Reutilizado de cache operacional reciente)`,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || items.length === 0 || forecasts.length === 0) {
    return createDegradedOperationalFallback(
      items,
      !apiKey ? "OPENAI_API_KEY no configurada." : "Sin partidas o pronóstico meteorológico disponible."
    );
  }

  const weatherSummary = forecasts
    .map(
      (f) =>
        `- ${f.date}: Lluvia ${f.precipitation_sum_mm.toFixed(1)} mm, Horas lluvia: ${f.precipitation_hours}h, Viento máx: ${f.wind_gusts_max_kmh.toFixed(0)} km/h, Temp: ${f.temperature_min_c ?? 20}°C / ${f.temperature_max_c ?? 30}°C`
    )
    .join("\n");

  const itemsSummary = items
    .map((it) => `ID: ${it.budget_item_id} | Código: ${it.item_code} | Descripción: ${it.description} | Unidad: ${it.unit}`)
    .join("\n");

  const prompt = `Actuá como un Ingeniero Residente y Analista de Operaciones de Obras Civiles en Paraguay.
Tu única función es evaluar la OPERABILIDAD TÉCNICA de cada partida presupuestaria en base al pronóstico meteorológico diario proyectado.

PRONÓSTICO METEOROLÓGICO:
${weatherSummary}

PARTIDAS A EVALUAR:
${itemsSummary}

REGLAS DE EVALUACIÓN:
1. Movimiento de suelos, excavaciones y fundaciones sufren saturación de suelo: lluvia fuerte genera imposibilidad de tránsito y barro severo (BLOCKED o factor bajo 0.1 a 0.3).
2. Tareas en altura, cubiertas y estructuras metálicas se suspenden por seguridad si hay viento fuerte (>40 km/h) o tormentas.
3. Hormigonados exteriores requieren ventana sin lluvia para evitar lavado de mezcla.
4. Trabajos interiores (instalaciones, pintura interior, carpintería, pisos bajo techo) operan normalmente (factor 1.0, NORMAL) salvo lluvia extrema que inunde accesos.
5. El productive_factor debe ser un número flotante entre 0.0 y 1.0 representando la fracción efectiva de trabajo realizable.
6. NO inventes costos, NO calcules metros ni dinero. Limítate a workability ("NORMAL" | "PARTIAL" | "BLOCKED"), productive_factor (0..1) y reason breve en español técnico.`;

  const SCHEMA = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            budget_item_id: { type: "string" },
            workability: { type: "string", enum: ["NORMAL", "PARTIAL", "BLOCKED"] },
            productive_factor: { type: "number" },
            reason: { type: "string" },
            risk_flags: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["budget_item_id", "workability", "productive_factor", "reason"],
          additionalProperties: false,
        },
      },
      overall_summary: { type: "string" },
    },
    required: ["items", "overall_summary"],
    additionalProperties: false,
  };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "operational_workability_analysis",
            schema: SCHEMA,
            strict: true,
          },
        },
        messages: [
          {
            role: "system",
            content:
              "Sos un experto en planificación de obras civiles. Respondés en JSON estricto evaluando la operabilidad física frente al clima.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(`LLM call failed (${response.status}). Returning explicit degraded status.`);
      return createDegradedOperationalFallback(
        items,
        `Fallo en la comunicación con el servicio de IA (${response.status}).`
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return createDegradedOperationalFallback(items, "Respuesta vacía del servicio de IA.");
    }

    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      return createDegradedOperationalFallback(items, "Estructura JSON no conforme del LLM.");
    }

    // Sanitize and ensure productive_factor is strictly bounded in [0, 1]
    const sanitizedItems: OperationalAssessmentItem[] = parsed.items.map(
      (item: any) => ({
        budget_item_id: String(item.budget_item_id),
        workability:
          item.workability === "BLOCKED" || item.workability === "PARTIAL"
            ? item.workability
            : "NORMAL",
        productive_factor: Math.min(1.0, Math.max(0.0, Number(item.productive_factor) || 0)),
        reason: String(item.reason || ""),
        risk_flags: Array.isArray(item.risk_flags) ? item.risk_flags : [],
      })
    );

    const output: OperationalAnalysisOutput = {
      items: sanitizedItems,
      overall_summary: String(parsed.overall_summary || "Análisis operacional completado por IA."),
      llm_used: true,
      is_degraded: false,
    };

    // Save in cache
    analysisCache.set(cacheKey, { timestamp: Date.now(), output });
    return output;
  } catch (err: any) {
    console.error("Error in analyzeOperationalWorkability LLM call:", err);
    return createDegradedOperationalFallback(
      items,
      `Error de ejecución de IA: ${err.message || "desconocido"}.`
    );
  }
}
