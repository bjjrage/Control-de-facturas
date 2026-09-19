const RESPONSE_KEYS = ["mensaje", "respuesta", "answer", "message", "resumen"] as const;

function parseJsonCandidate(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/** Makes accidental legacy JSON readable without changing the model/tool protocol. */
export function normalizeRodrigoResponse(value: string): string {
  const parsed = parseJsonCandidate(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return value;
  const record = parsed as Record<string, unknown>;
  for (const key of RESPONSE_KEYS) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return value;
}
