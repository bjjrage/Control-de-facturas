// Orquesta el pipeline de matching descripto para el módulo BIM:
//
//   IFC -> extracción técnica -> quantity policy -> normalización
//       -> filtros técnicos deterministas -> SEMANTIC MATCHER
//       -> candidato/abstención -> confirmación humana -> cantidad × precio
//
// El filtro determinista (isTechnicallyCompatible) y el scorer de texto local
// (localTokenScorer) siguen existiendo, pero cambian de rol: ya NO deciden el
// match por sí solos — son guardrail técnico y señal de retrieval para
// acotar cuántos candidatos se le mandan al SemanticMatcher (hoy
// DeepSeekSemanticMatcher). La decisión semántica final la toma el matcher.
import type { BimElement, BudgetItem } from "@/lib/types";
import { isTechnicallyCompatible, localTokenScorer } from "./matching";
import type { SemanticMatcher, SemanticMatchCandidate, SemanticMatchInput, SemanticMatchResult } from "./semantic-matcher";

// Generoso a propósito: para un catálogo de costos de tamaño realista
// (decenas de rubros), un tope bajo terminaría actuando como un filtro por
// similitud de texto disfrazado de "límite técnico" — exactamente lo que
// item 2 prohíbe ("no eliminar candidatos solo porque los strings no se
// parecen"). "External Wall - Ceramic Brick - 150" y "Mampostería cerámica
// 15 cm" no comparten casi ningún token, así que si el filtro técnico no
// logra descartar nada (ej. sin espesor detectable en el texto del
// elemento), el candidato correcto puede rankear bajo por puro idioma —
// cortar la lista ahí lo perdería antes de que DeepSeek lo vea. Si el
// catálogo creciera a cientos de rubros, esto necesitaría retrieval real
// (embeddings) en vez de un límite fijo — fuera de alcance de este batch.
const DEFAULT_CANDIDATE_LIMIT = 20;

function elementSearchText(element: BimElement): string {
  return [element.name, element.material, element.ifc_type].filter(Boolean).join(" ");
}

// Reduce el catálogo completo a un subconjunto acotado antes de llamar al
// modelo: primero descarta lo técnicamente imposible (unidad, espesor,
// resistencia — ver isTechnicallyCompatible), después ordena lo que queda
// por similitud de texto y se queda con las top-N. Nunca al revés: el
// filtro nunca descarta un candidato SOLO porque el texto no se parece —
// "External Wall - Ceramic Brick - 150" debe poder seguir compitiendo por
// "Mampostería cerámica 15 cm" aunque sean lexicalmente distintos, siempre
// que pase el filtro técnico.
export function buildCandidatePool(
  element: BimElement,
  budgetItems: BudgetItem[],
  limit = DEFAULT_CANDIDATE_LIMIT
): BudgetItem[] {
  const technicallyCompatible = budgetItems.filter((item) => isTechnicallyCompatible(element, item));
  const text = elementSearchText(element);
  return technicallyCompatible
    .map((item) => ({ item, score: localTokenScorer.score(text, item.description) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}

export function toSemanticMatchInput(element: BimElement, candidates: BudgetItem[]): SemanticMatchInput {
  return {
    bim: {
      ifcType: element.ifc_type,
      name: element.name,
      material: element.material,
      storey: element.building_storey,
      quantity:
        element.quantity_value != null && element.quantity_type != null && element.quantity_unit != null
          ? { type: element.quantity_type, value: element.quantity_value, unit: element.quantity_unit }
          : null,
      properties: element.properties ?? {},
    },
    candidates: candidates.map(
      (item): SemanticMatchCandidate => ({
        id: item.id,
        code: item.code,
        description: item.description,
        unit: item.unit,
        unitPrice: item.unit_price,
      })
    ),
  };
}

// Punto de entrada único del pipeline semántico para un elemento BIM: filtra,
// arma el input estructurado y delega la decisión al matcher inyectado.
export async function runSemanticMatch(
  matcher: SemanticMatcher,
  element: BimElement,
  budgetItems: BudgetItem[],
  limit = DEFAULT_CANDIDATE_LIMIT
): Promise<SemanticMatchResult> {
  const candidates = buildCandidatePool(element, budgetItems, limit);
  return matcher.match(toSemanticMatchInput(element, candidates));
}
