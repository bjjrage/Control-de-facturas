// Agrupa elementos BIM técnicamente equivalentes ANTES de llamar al matcher
// semántico — evita pagar/latenciar una llamada a DeepSeek por cada uno de
// N elementos que en realidad son "el mismo rubro" (10 muros de 15cm ->
// 1 grupo, no 10 llamadas).
//
// Reutiliza EXACTAMENTE la misma noción de compatibilidad técnica que ya usa
// el filtro determinista de matching.ts (extractSpecs, normalizeUnit) — no
// se inventa una segunda regla de agrupación. Dos elementos van al mismo
// grupo solo si:
//   - mismo ifc_type (nunca se mezcla un muro con una columna);
//   - misma unidad canónica de cantidad (normalizeUnit debe coincidir);
//   - mismo quantity_type (área/volumen/longitud/...);
//   - material compatible (igual, normalizado, o alguno de los dos sin dato);
//   - espesor/resistencia compatibles cuando ambos elementos tienen el dato
//     (misma tolerancia que isTechnicallyCompatible) — si a alguno le falta,
//     no se usa como motivo para separar (no hay evidencia de que sean
//     distintos, y "no agrupar si existen diferencias técnicas relevantes"
//     exige evidencia, no ausencia de datos).
//
// El agrupamiento es determinista y auditable: cada bim_element conserva su
// fila original (bim_elements.group_id apunta al grupo), nunca se pierde la
// trazabilidad grupo -> elementos.
import type { BimElement } from "@/lib/types";
import { extractSpecs, localTokenScorer, normalizeUnit } from "./matching";
import { roundQuantity4 } from "@/lib/format";

const THICKNESS_TOLERANCE_MM = 15;

// Umbral deliberadamente bajo: agrupar de más solo le agrega candidatos al
// mismo grupo que igual pasa por DeepSeek después (ya certificado con 100%
// accuracy incluso ante variantes de idioma/nomenclatura de material — ver
// live-stress-test.spec.ts). Agrupar de menos multiplica llamadas sin
// necesidad. Exigir texto EXACTO acá fallaría con variantes reales del mismo
// material ("Ceramic Brick" / "Cerámico" / "Ceramic Block" en el mismo
// dataset) — un umbral de similitud es más fiel a "misma sustancia" que una
// igualdad de string.
const MATERIAL_SIMILARITY_THRESHOLD = 0.25;

function materialCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true; // sin dato de un lado no es evidencia de diferencia
  if (a === b) return true;
  return localTokenScorer.score(a, b) >= MATERIAL_SIMILARITY_THRESHOLD;
}

function specsCompatible(a: BimElement, b: BimElement): boolean {
  const textA = [a.name, a.material, a.ifc_type].filter(Boolean).join(" ");
  const textB = [b.name, b.material, b.ifc_type].filter(Boolean).join(" ");
  const specsA = extractSpecs(textA);
  const specsB = extractSpecs(textB);

  if (specsA.resistanceClass && specsB.resistanceClass && specsA.resistanceClass !== specsB.resistanceClass) {
    return false;
  }
  if (specsA.thicknessMm != null && specsB.thicknessMm != null) {
    if (Math.abs(specsA.thicknessMm - specsB.thicknessMm) > THICKNESS_TOLERANCE_MM) return false;
  }
  return true;
}

export function areElementsGroupable(a: BimElement, b: BimElement): boolean {
  if (a.ifc_type !== b.ifc_type) return false;
  if (a.quantity_type !== b.quantity_type) return false;

  const unitA = normalizeUnit(a.quantity_unit);
  const unitB = normalizeUnit(b.quantity_unit);
  // Unidad ausente/no reconocida en cualquiera de los dos: no hay base para
  // agrupar con seguridad (misma política fail-closed que unitsCompatibleForCosting).
  if (!unitA || !unitB || unitA !== unitB) return false;

  if (!materialCompatible(a.material, b.material)) return false;
  if (!specsCompatible(a, b)) return false;

  return true;
}

export interface ElementGroupDraft {
  /** Representante elegido para el nombre normalizado del grupo (el primer elemento agregado). */
  representative: BimElement;
  elements: BimElement[];
  ifcType: string;
  material: string | null;
  quantityType: BimElement["quantity_type"];
  quantityUnit: string | null;
  /** Suma de quantity_value de los elementos del grupo, redondeada a numeric(18,4). null si ninguno tiene cantidad. */
  totalQuantity: number | null;
}

// Clustering greedy: cada elemento se compara contra el representante de los
// grupos ya existentes; si es compatible con alguno, se une; si no, abre un
// grupo nuevo. Para el tamaño típico de un modelo IFC (decenas a pocos
// cientos de elementos) esto es suficiente — no hace falta un algoritmo de
// clustering más sofisticado para esta fase.
export function groupElements(elements: BimElement[]): ElementGroupDraft[] {
  const groups: ElementGroupDraft[] = [];

  for (const element of elements) {
    const existing = groups.find((g) => areElementsGroupable(g.representative, element));
    if (existing) {
      existing.elements.push(element);
      if (!existing.material && element.material) existing.material = element.material;
    } else {
      groups.push({
        representative: element,
        elements: [element],
        ifcType: element.ifc_type,
        material: element.material,
        quantityType: element.quantity_type,
        quantityUnit: element.quantity_unit,
        totalQuantity: null,
      });
    }
  }

  for (const g of groups) {
    const values = g.elements.map((e) => e.quantity_value).filter((v): v is number => v != null);
    g.totalQuantity = values.length > 0 ? roundQuantity4(values.reduce((s, v) => s + v, 0)) : null;
  }

  return groups;
}
