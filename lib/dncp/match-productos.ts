// Matcher liviano ítem de licitación ↔ producto del catálogo de la empresa
// (versión lite de la Parte E2, sin normalización al catálogo DNCP).
//
// No pretende ser exacto: da una sugerencia de costo (CPP) que el usuario
// confirma. La normalización real (Parte C5) viene después.

const STOPWORDS = new Set([
  "de", "la", "el", "los", "las", "y", "o", "para", "por", "con", "sin", "a",
  "en", "del", "al", "un", "una", "tipo", "hasta", "mm", "cm", "mts",
]);

const DIACRITICS = /[̀-ͯ]/g;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export interface ProductoLite {
  id: string;
  nombre: string;
  unidad: string;
  costo_promedio: number;
}

export interface MatchResult {
  producto: ProductoLite;
  score: number; // 0..1 — Jaccard de tokens
}

/**
 * Devuelve el mejor producto del catálogo para una descripción de ítem, si el
 * solapamiento de tokens supera el umbral.
 */
export function matchProducto(
  descripcion: string,
  productos: ProductoLite[],
  umbral = 0.34
): MatchResult | null {
  const dt = new Set(tokens(descripcion));
  if (dt.size === 0) return null;

  let best: MatchResult | null = null;
  for (const p of productos) {
    const pt = new Set(tokens(p.nombre));
    if (pt.size === 0) continue;
    let inter = 0;
    for (const t of pt) if (dt.has(t)) inter++;
    const union = dt.size + pt.size - inter;
    const score = union > 0 ? inter / union : 0;
    if (score >= umbral && (!best || score > best.score)) {
      best = { producto: p, score };
    }
  }
  return best;
}
