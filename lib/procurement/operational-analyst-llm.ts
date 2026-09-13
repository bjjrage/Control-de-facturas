import { DailyWeatherForecast, OperationalStatus } from "@/lib/types";

export interface BudgetItemOperationalInput {
  budget_item_id: string;
  item_code: string;
  description: string;
  unit: string;
}

export interface OperationalAssessmentItem {
  budget_item_id: string;
  workability: OperationalStatus; // "NORMAL" | "PARTIAL" | "BLOCKED"
  productive_factor: number; // 0.0 to 1.0
  reason: string;
  risk_flags?: string[];
}

export interface OperationalAnalysisOutput {
  items: OperationalAssessmentItem[];
  overall_summary: string;
  llm_used: boolean;
}

/**
 * Heuristic/Deterministic fallback when LLM is unavailable, fails, or has invalid response.
 * Implements standard Paraguayan civil construction site weather rules.
 */
export function evaluateOperationalWorkabilityFallback(
  items: BudgetItemOperationalInput[],
  forecasts: DailyWeatherForecast[]
): OperationalAnalysisOutput {
  // Aggregate weather indicators over the horizon
  const totalRainMm = forecasts.reduce(
    (acc, f) => acc + (f.precipitation_sum_mm || 0),
    0
  );
  const maxRainMm = forecasts.reduce(
    (max, f) => Math.max(max, f.precipitation_sum_mm || 0),
    0
  );
  const maxWindKmh = forecasts.reduce(
    (max, f) => Math.max(max, f.wind_gusts_max_kmh || 0),
    0
  );
  const rainyDaysCount = forecasts.filter(
    (f) => (f.precipitation_sum_mm || 0) >= 3.0
  ).length;
  const severeRainyDaysCount = forecasts.filter(
    (f) => (f.precipitation_sum_mm || 0) >= 15.0
  ).length;

  const results: OperationalAssessmentItem[] = items.map((item) => {
    const desc = item.description.toLowerCase();

    // Identify task sensitivity to weather
    const isEarthwork =
      desc.includes("movimiento de suelo") ||
      desc.includes("excavaci") ||
      desc.includes("nivelaci") ||
      desc.includes("relleno") ||
      desc.includes("fundaci") ||
      desc.includes("pilot") ||
      desc.includes("zapata");

    const isConcreteOutdoor =
      desc.includes("hormig") ||
      desc.includes("viga") ||
      desc.includes("losa") ||
      desc.includes("columna") ||
      desc.includes("pavimento") ||
      desc.includes("revoque exterior") ||
      desc.includes("pintura exterior") ||
      desc.includes("techo") ||
      desc.includes("cubierta");

    const isHighElevation =
      desc.includes("cubierta") ||
      desc.includes("techo") ||
      desc.includes("andamio") ||
      desc.includes("fachada") ||
      desc.includes("estructura metálica");

    const isIndoor =
      desc.includes("instalaci") ||
      desc.includes("sanitari") ||
      desc.includes("eléctric") ||
      desc.includes("piso interior") ||
      desc.includes("cielorraso") ||
      desc.includes("pintura interior") ||
      desc.includes("azulejo") ||
      desc.includes("carpinter") ||
      desc.includes("placard") ||
      desc.includes("puerta");

    // Earthwork: severe sensitivity to ground saturation
    if (isEarthwork) {
      if (severeRainyDaysCount > 0 || totalRainMm >= 30) {
        return {
          budget_item_id: item.budget_item_id,
          workability: "BLOCKED",
          productive_factor: 0.1,
          reason: `Lluvia intensa proyectada (${totalRainMm.toFixed(1)} mm, ${rainyDaysCount} días afectados). Suelo saturado impide tránsito de maquinaria pesada y excavación.`,
          risk_flags: ["SATURACION_SUELO", "MAQUINARIA_INOPERATIVA"],
        };
      } else if (rainyDaysCount > 0 || totalRainMm >= 8) {
        return {
          budget_item_id: item.budget_item_id,
          workability: "PARTIAL",
          productive_factor: 0.5,
          reason: `Lluvias intermitentes (${totalRainMm.toFixed(1)} mm) reducirán el ritmo de zanjeo y movimiento de suelo.`,
          risk_flags: ["BARRO_MODERADO"],
        };
      }
    }

    // High elevation: wind or rain
    if (isHighElevation && (maxWindKmh >= 45 || severeRainyDaysCount > 0)) {
      return {
        budget_item_id: item.budget_item_id,
        workability: "BLOCKED",
        productive_factor: 0.2,
        reason: `Riesgo de seguridad por ráfagas de viento (${maxWindKmh.toFixed(0)} km/h) o lluvia intensa en altura.`,
        risk_flags: ["VIENTO_FUERTE", "ALTURA_INSEGURA"],
      };
    }

    // Concrete & outdoor masonry
    if (isConcreteOutdoor) {
      if (severeRainyDaysCount >= 2 || totalRainMm >= 25) {
        return {
          budget_item_id: item.budget_item_id,
          workability: "PARTIAL",
          productive_factor: 0.4,
          reason: `Lluvias persistentes impiden cargamento continuo de hormigón y fraguado óptimo al aire libre.`,
          risk_flags: ["LAVADO_HORMIGON"],
        };
      } else if (rainyDaysCount > 0) {
        return {
          budget_item_id: item.budget_item_id,
          workability: "PARTIAL",
          productive_factor: 0.75,
          reason: `Interrupciones puntuales por lluvias leves a moderadas.`,
        };
      }
    }

    // Indoor finishing: resilient to rain unless severe flood
    if (isIndoor) {
      return {
        budget_item_id: item.budget_item_id,
        workability: "NORMAL",
        productive_factor: 1.0,
        reason:
          "Trabajo bajo cubierta no afectado sustancialmente por condiciones meteorológicas externas.",
      };
    }

    // Default general tasks
    if (rainyDaysCount > 0) {
      const factor = Math.max(
        0.5,
        1 - (rainyDaysCount / forecasts.length) * 0.5
      );
      return {
        budget_item_id: item.budget_item_id,
        workability: factor < 0.6 ? "PARTIAL" : "NORMAL",
        productive_factor: Number(factor.toFixed(2)),
        reason: `Afectación parcial estimada por ${rainyDaysCount} días con lluvias en el horizonte analizado.`,
      };
    }

    return {
      budget_item_id: item.budget_item_id,
      workability: "NORMAL",
      productive_factor: 1.0,
      reason: "Condiciones meteorológicas favorables para el avance normal.",
    };
  });

  return {
    items: results,
    overall_summary: `Análisis meteorológico determinístico: ${forecasts.length} días analizados, ${rainyDaysCount} días con lluvia (${totalRainMm.toFixed(1)} mm total acumulado).`,
    llm_used: false,
  };
}

/**
 * Operates the LLM as an operational field expert.
 * STRICT CONTRACT: The LLM outputs ONLY qualitative workability and productive_factor (0..1).
 * It NEVER computes quantities, financial amounts, stock balances, or purchase totals.
 */
export async function analyzeOperationalWorkability(
  items: BudgetItemOperationalInput[],
  forecasts: DailyWeatherForecast[]
): Promise<OperationalAnalysisOutput> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || items.length === 0 || forecasts.length === 0) {
    return evaluateOperationalWorkabilityFallback(items, forecasts);
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
      console.warn(
        `LLM operational analysis failed (${response.status}), activating deterministic fallback.`
      );
      return evaluateOperationalWorkabilityFallback(items, forecasts);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return evaluateOperationalWorkabilityFallback(items, forecasts);
    }

    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      return evaluateOperationalWorkabilityFallback(items, forecasts);
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

    return {
      items: sanitizedItems,
      overall_summary: String(parsed.overall_summary || "Análisis operacional completado por IA."),
      llm_used: true,
    };
  } catch (err) {
    console.error("Error in analyzeOperationalWorkability LLM call:", err);
    return evaluateOperationalWorkabilityFallback(items, forecasts);
  }
}
