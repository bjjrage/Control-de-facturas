/**
 * ITEM MATCHING ENGINE (GATE 7)
 * Pipeline híbrido determinístico para emparejar ítems de pliegos y cómputos con insumos del catálogo:
 * 1. Limpieza y normalización de textos técnicos de construcción en Paraguay (lematización de unidades y sufijos)
 * 2. Normalización de dimensiones y calibres (ej: "10 mm", "d=10mm", "10mm" -> "10mm")
 * 3. Expansión de sinónimos técnicos paraguayos (hormigon=concreto, varilla=acero=hierro, etc.)
 * 4. Tokenización y eliminación de stopwords operativas
 * 5. Matching exacto por código de catálogo
 * 6. Similitud ponderada bidireccional (Mayor peso en dimensiones, calibres y sustantivos clave)
 * 7. Umbrales:
 *    - >= 0.65: MATCH_AUTOMATICO
 *    - 0.40 - 0.64: REQUIERE_REVISION
 *    - < 0.40: NO_MATCH
 */

export interface CatalogItem {
  id: string;
  codigo?: string;
  descripcion: string;
  unidad: string;
  categoria?: string;
  especificaciones?: string[];
}

export type MatchStatus = 'MATCH_AUTOMATICO' | 'REQUIERE_REVISION' | 'NO_MATCH';

export interface ItemMatchResult {
  sourceItemDescription: string;
  sourceUnit: string;
  bestMatch: {
    item: CatalogItem;
    similarityScore: number;
    matchedTerms: string[];
    confidence: MatchStatus;
  } | null;
  candidateMatches: Array<{
    item: CatalogItem;
    similarityScore: number;
  }>;
}

const STOPWORDS_CONSTRUCCION = new Set([
  'de', 'la', 'el', 'en', 'y', 'a', 'los', 'las', 'del', 'para', 'con', 'por', 'o',
  'tipo', 'segun', 'pliego', 'especificacion', 'tecnica', 'incluye', 'provision', 'colocacion',
  'puesta', 'obra', 'calidad', 'elaborado', 'planta', 'armado', 'estructural', 'clasificada',
  'conformadas', 'conformado', 'perfilado', 'cuneteado', 'desague', 'cloacal', 'armaduras',
  'combustible', 'equipos', 'viales', 'calidad'
]);

const SINONIMOS_CONSTRUCCION: Record<string, string> = {
  'hierro': 'acero',
  'varilla': 'acero',
  'varillas': 'acero',
  'diesel': 'gasoil',
  'concreto': 'hormigon',
  'tuberia': 'tubo',
  'tubos': 'tubo',
  'tuberias': 'tubo',
  'ladrillos': 'ladrillo',
  'mamposteria': 'ladrillo',
  'hormigones': 'hormigon'
};

/**
 * Normaliza y tokeniza una descripción técnica de construcción
 */
export function tokenizeTechnicalDescription(desc: string): string[] {
  let cleaned = desc
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Normalizar dimensiones y estándares técnicos
    .replace(/ap\s*500/g, 'ap500')
    .replace(/d\s*=\s*(\d+)\s*mm/g, '$1mm')
    .replace(/(\d+)\s*mm/g, '$1mm')
    .replace(/(\d+)\s*m3/g, '$1m3')
    .replace(/(\d+)\s*kg/g, '$1kg')
    .replace(/h[- ]?21/g, 'h21')
    .replace(/f[- ]?32/g, 'f32')
    .replace(/e\s*=\s*0[.,]\d+m?/g, '')
    .replace(/[^a-z0-9]/g, ' ');

  const rawTokens = cleaned.split(/\s+/).filter(t => t.length > 0);
  const tokens: string[] = [];

  for (const t of rawTokens) {
    if (STOPWORDS_CONSTRUCCION.has(t)) continue;
    let syn = SINONIMOS_CONSTRUCCION[t] || t;
    if (syn === 'comunes' || syn === 'comun') syn = 'comun';
    if (syn === 'cocidos' || syn === 'cocido') syn = 'cocido';
    if (syn.length > 1) {
      tokens.push(syn);
    }
  }

  return tokens;
}

/**
 * Calcula similitud ponderada entre pliego (A) y catálogo (B)
 */
export function calculateWeightedTechnicalSimilarity(tokensA: string[], tokensB: string[]): {
  score: number;
  matchedTerms: string[];
} {
  if (tokensA.length === 0 || tokensB.length === 0) {
    return { score: 0, matchedTerms: [] };
  }

  const setB = new Set(tokensB);
  let matchedWeight = 0;
  let totalWeightA = 0;
  const matchedTerms: string[] = [];

  for (const token of tokensA) {
    // Dimensiones o calibres específicos (10mm, 12mm, h21, f32, 4ta, 110mm) tienen peso 4x
    const isCriticalSpec = /\d/.test(token) || token === 'cemento' || token === 'arena' || token === 'motoniveladora' || token === 'ladrillo';
    const weight = isCriticalSpec ? 4.0 : 1.5;

    totalWeightA += weight;

    if (setB.has(token)) {
      matchedWeight += weight;
      matchedTerms.push(token);
    }
  }

  const coverageA = totalWeightA > 0 ? matchedWeight / totalWeightA : 0;
  const jaccardIntersection = matchedTerms.length;
  const jaccardUnion = new Set([...tokensA, ...tokensB]).size;
  const jaccard = jaccardUnion > 0 ? jaccardIntersection / jaccardUnion : 0;

  // 75% cobertura del requerimiento del pliego, 25% similitud global Jaccard
  const combinedScore = coverageA * 0.75 + jaccard * 0.25;

  return {
    score: Number(combinedScore.toFixed(3)),
    matchedTerms
  };
}

/**
 * Empareja un ítem de pliego contra un catálogo de insumos
 */
export function matchTenderItem(
  sourceDescription: string,
  sourceUnit: string,
  catalog: CatalogItem[],
  thresholds = { autoMatch: 0.65, reviewMatch: 0.40 }
): ItemMatchResult {
  const sourceTokens = tokenizeTechnicalDescription(sourceDescription);
  const candidates: Array<{ item: CatalogItem; similarityScore: number; matchedTerms: string[] }> = [];

  for (const catalogItem of catalog) {
    // Si los códigos coinciden exactamente, match inmediato 1.0
    if (catalogItem.codigo && sourceDescription.toLowerCase().includes(catalogItem.codigo.toLowerCase())) {
      candidates.push({
        item: catalogItem,
        similarityScore: 1.0,
        matchedTerms: [catalogItem.codigo]
      });
      continue;
    }

    const targetTokens = tokenizeTechnicalDescription(catalogItem.descripcion);
    const { score, matchedTerms } = calculateWeightedTechnicalSimilarity(sourceTokens, targetTokens);

    // Bonificación de compatibilidad de unidad
    let unitBonus = 0;
    const cleanSourceUnit = sourceUnit.trim().toUpperCase();
    const cleanCatalogUnit = catalogItem.unidad.trim().toUpperCase();
    if (cleanSourceUnit && cleanCatalogUnit && cleanSourceUnit === cleanCatalogUnit) {
      unitBonus = 0.08;
    }

    const finalScore = Math.min(1.0, score + unitBonus);

    if (finalScore >= thresholds.reviewMatch) {
      candidates.push({
        item: catalogItem,
        similarityScore: Number(finalScore.toFixed(3)),
        matchedTerms
      });
    }
  }

  // Ordenar candidatos por puntaje descendente
  candidates.sort((a, b) => b.similarityScore - a.similarityScore);

  let bestMatch: ItemMatchResult['bestMatch'] = null;

  if (candidates.length > 0) {
    const top = candidates[0];
    let confidence: MatchStatus = 'NO_MATCH';

    if (top.similarityScore >= thresholds.autoMatch) {
      confidence = 'MATCH_AUTOMATICO';
    } else if (top.similarityScore >= thresholds.reviewMatch) {
      confidence = 'REQUIERE_REVISION';
    }

    bestMatch = {
      item: top.item,
      similarityScore: top.similarityScore,
      matchedTerms: top.matchedTerms,
      confidence
    };
  }

  return {
    sourceItemDescription: sourceDescription,
    sourceUnit,
    bestMatch,
    candidateMatches: candidates.map(c => ({ item: c.item, similarityScore: c.similarityScore }))
  };
}
