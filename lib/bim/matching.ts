// Matching BIM <-> presupuesto (budget_items).
//
// Dos niveles, según lo definido para el módulo:
//   1. Filtro determinista: descarta candidatos técnicamente incompatibles
//      (unidad distinta, resistencia distinta, espesor muy distinto). Nunca
//      deja pasar un "Hormigón H20" como candidato de un "Hormigón H40".
//   2. Ranking semántico: sobre los candidatos que sobrevivieron al filtro,
//      puntúa por similitud de texto. La implementación default es local
//      (sin proveedor externo) para no acoplar el módulo a un LLM — el
//      `SemanticScorer` es un adapter reemplazable por embeddings/LLM más
//      adelante sin tocar el resto del pipeline.
//
// La IA (en cualquiera de sus formas) solo PROPONE un ranking; nunca escribe
// en budget_items ni fija un match por su cuenta.

import type { BimElement, BudgetItem } from "@/lib/types";

// ---------------------------------------------------------------------------
// Normalización de texto y unidades
// ---------------------------------------------------------------------------

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9.,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Alias conocidos -> unidad canónica. Ampliar acá, no en cada callsite.
const UNIT_ALIASES: Record<string, string> = {
  m2: "m2", "m²": "m2", mts2: "m2", "metro cuadrado": "m2", "metros cuadrados": "m2",
  m3: "m3", "m³": "m3", mts3: "m3", "metro cubico": "m3", "metros cubicos": "m3",
  ml: "m", m: "m", mt: "m", mts: "m", metro: "m", metros: "m", "metro lineal": "m", "metros lineales": "m",
  kg: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
  u: "u", un: "u", und: "u", unid: "u", unidad: "u", unidades: "u", pza: "u", pieza: "u",
  gl: "gl", global: "gl",
};

export function normalizeUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const norm = normalizeText(raw.replace(/²/g, "2").replace(/³/g, "3"));
  return UNIT_ALIASES[norm] ?? null;
}

// ---------------------------------------------------------------------------
// Extracción de especificaciones técnicas desde texto libre
// ---------------------------------------------------------------------------

export interface ExtractedSpecs {
  thicknessMm: number | null;
  resistanceClass: string | null; // ej. "h20", "h30"
}

export function extractSpecs(text: string): ExtractedSpecs {
  const norm = normalizeText(text);

  let thicknessMm: number | null = null;
  const mmMatch = norm.match(/(\d+(?:[.,]\d+)?)\s*mm\b/);
  const cmMatch = norm.match(/(\d+(?:[.,]\d+)?)\s*cm\b/);
  if (mmMatch) thicknessMm = parseFloat(mmMatch[1].replace(",", "."));
  else if (cmMatch) thicknessMm = parseFloat(cmMatch[1].replace(",", ".")) * 10;

  let resistanceClass: string | null = null;
  const hMatch = norm.match(/\bh\s?-?\s?(\d{2,3})\b/);
  if (hMatch) resistanceClass = `h${hMatch[1]}`;

  return { thicknessMm, resistanceClass };
}

// ---------------------------------------------------------------------------
// Nivel 1 — filtro determinista
// ---------------------------------------------------------------------------

// Tolerancia entre espesores para considerarlos "el mismo" (redondeos de
// catálogo: "15 cm" en el Excel vs "150 mm" u observado 148mm real en el IFC).
const THICKNESS_TOLERANCE_MM = 15;

export function isTechnicallyCompatible(element: BimElement, item: BudgetItem): boolean {
  const elementUnit = normalizeUnit(element.quantity_unit);
  const itemUnit = normalizeUnit(item.unit);
  if (elementUnit && itemUnit && elementUnit !== itemUnit) return false;

  const elementText = [element.name, element.material, element.ifc_type].filter(Boolean).join(" ");
  const itemText = item.description;
  const elementSpecs = extractSpecs(elementText);
  const itemSpecs = extractSpecs(itemText);

  if (elementSpecs.resistanceClass && itemSpecs.resistanceClass) {
    if (elementSpecs.resistanceClass !== itemSpecs.resistanceClass) return false;
  }

  if (elementSpecs.thicknessMm != null && itemSpecs.thicknessMm != null) {
    if (Math.abs(elementSpecs.thicknessMm - itemSpecs.thicknessMm) > THICKNESS_TOLERANCE_MM) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Nivel 2 — ranking semántico (adapter: local por default, reemplazable)
// ---------------------------------------------------------------------------

export interface SemanticScorer {
  /** Devuelve un score en [0, 1] de similitud entre dos textos ya normalizados. */
  score(a: string, b: string): number;
}

function bigrams(s: string): Set<string> {
  const padded = ` ${s} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 1; i++) set.add(padded.slice(i, i + 2));
  return set;
}

// Coeficiente de Dice sobre bigramas + bonus por tokens compartidos. Sin
// dependencias externas ni llamadas de red — apto para correr en batch sobre
// cientos de elementos sin costo ni latencia de IA.
export const localTokenScorer: SemanticScorer = {
  score(a, b) {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;

    const bgA = bigrams(na);
    const bgB = bigrams(nb);
    const shared = [...bgA].filter((g) => bgB.has(g)).length;
    const dice = bgA.size + bgB.size > 0 ? (2 * shared) / (bgA.size + bgB.size) : 0;

    const tokensA = new Set(na.split(" ").filter(Boolean));
    const tokensB = new Set(nb.split(" ").filter(Boolean));
    const sharedTokens = [...tokensA].filter((t) => tokensB.has(t)).length;
    const tokenScore = tokensA.size + tokensB.size > 0 ? (2 * sharedTokens) / (tokensA.size + tokensB.size) : 0;

    return Math.min(1, dice * 0.6 + tokenScore * 0.4);
  },
};

export interface MatchCandidate {
  budgetItem: BudgetItem;
  score: number;
}

// ---------------------------------------------------------------------------
// Agregación: varios elementos BIM pueden mapear al mismo rubro (ej. 57
// muros -> "Mampostería cerámica 15 cm"). El total económico del rubro usa la
// SUMA de las cantidades BIM confirmadas, no una línea por elemento. Un
// elemento con unidad incompatible respecto al rubro se excluye de la suma y
// se reporta aparte — nunca se mezclan unidades en un total.
// ---------------------------------------------------------------------------

export interface AggregationResult {
  compatible: BimElement[];
  incompatible: BimElement[];
  totalQuantity: number | null;
  unit: string | null;
}

export function aggregateElementsForBudgetItem(elements: BimElement[], item: BudgetItem): AggregationResult {
  const itemUnit = normalizeUnit(item.unit);
  const compatible: BimElement[] = [];
  const incompatible: BimElement[] = [];

  for (const el of elements) {
    const elUnit = normalizeUnit(el.quantity_unit);
    if (el.quantity_value == null) continue;
    if (itemUnit && elUnit && itemUnit !== elUnit) {
      incompatible.push(el);
    } else {
      compatible.push(el);
    }
  }

  const totalQuantity =
    compatible.length > 0 ? compatible.reduce((sum, el) => sum + (el.quantity_value ?? 0), 0) : null;

  return { compatible, incompatible, totalQuantity, unit: item.unit };
}

export function suggestMatches(
  element: BimElement,
  candidates: BudgetItem[],
  options: { scorer?: SemanticScorer; limit?: number; minScore?: number } = {}
): MatchCandidate[] {
  const scorer = options.scorer ?? localTokenScorer;
  const limit = options.limit ?? 5;
  const minScore = options.minScore ?? 0.2;

  const elementText = [element.name, element.material, element.ifc_type].filter(Boolean).join(" ");

  return candidates
    .filter((item) => isTechnicallyCompatible(element, item))
    .map((item) => ({ budgetItem: item, score: scorer.score(elementText, item.description) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
