// Convierte un ComputoItem (fila de cómputo métrico importada de Excel/PDF) al
// mismo shape de BimElement que ya consume el pipeline semántico de BIM
// (lib/bim/semantic-pipeline.ts). NO se toca ese pipeline — un cómputo sin
// modelo 3D es, para el matcher, un elemento con cantidad y nombre pero sin
// geometría, material ni properties reales.
import type { BimElement, ComputoItem } from "@/lib/types";

const QUANTITY_TYPE_BY_UNIT: Record<string, BimElement["quantity_type"]> = {
  m2: "area",
  m3: "volume",
  m: "length",
  kg: "weight",
  u: "count",
  gl: "count",
};

// ifc_type sintético — nunca se muestra al usuario ni se compara contra un
// esquema IFC real; solo ocupa el campo que el pipeline espera.
export const COMPUTO_SYNTHETIC_IFC_TYPE = "ComputoMetricoItem";

export function computoItemToBimElement(item: ComputoItem): BimElement {
  const unit = item.quantity_unit;
  const quantityType = unit ? (QUANTITY_TYPE_BY_UNIT[unit] ?? null) : null;
  return {
    id: item.id,
    bim_model_id: item.computo_import_id,
    project_id: item.project_id,
    ifc_guid: item.id,
    ifc_type: COMPUTO_SYNTHETIC_IFC_TYPE,
    express_id: null,
    name: item.description,
    building_storey: null,
    material: null,
    properties: {},
    quantity_type: item.quantity_value != null ? quantityType : null,
    quantity_value: item.quantity_value,
    quantity_unit: unit,
    quantity_source: null,
    quantity_property: null,
    created_at: item.created_at,
    group_id: null,
  };
}
