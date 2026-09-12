import { describe, expect, it } from "vitest";
import { findElementByExpressId } from "../identity";
import type { BimElement } from "@/lib/types";

function makeElement(overrides: Partial<BimElement>): BimElement {
  return {
    id: "el-default",
    bim_model_id: "model-1",
    project_id: "proj-1",
    ifc_guid: "GUID-default",
    ifc_type: "IfcWall",
    express_id: 1,
    name: null,
    building_storey: null,
    material: null,
    properties: {},
    quantity_type: null,
    quantity_value: null,
    quantity_unit: null,
    quantity_source: null,
    quantity_property: null,
    created_at: new Date().toISOString(),
    group_id: null,
    ...overrides,
  };
}

describe("findElementByExpressId — express_id es identidad efímera, no durable entre versiones", () => {
  it("resuelve el elemento correcto acotando por bim_model_id, no solo por express_id", () => {
    // Dos elementos de DOS modelos (versiones) distintos pueden compartir el
    // mismo express_id numérico (STEP expressID no es global, es por
    // archivo). Un lookup que ignorara bim_model_id devolvería el elemento
    // equivocado.
    const elements: BimElement[] = [
      makeElement({ id: "el-v1-wall", bim_model_id: "model-v1", express_id: 110, ifc_guid: "GUID-A" }),
      makeElement({ id: "el-v2-wall", bim_model_id: "model-v2", express_id: 110, ifc_guid: "GUID-A-reexport" }),
    ];

    expect(findElementByExpressId(elements, "model-v1", 110)?.id).toBe("el-v1-wall");
    expect(findElementByExpressId(elements, "model-v2", 110)?.id).toBe("el-v2-wall");
  });

  it("devuelve null si el express_id no existe en ese modelo (aunque exista en otro)", () => {
    const elements: BimElement[] = [makeElement({ id: "el-v1", bim_model_id: "model-v1", express_id: 5 })];
    expect(findElementByExpressId(elements, "model-v2", 5)).toBeNull();
  });

  it("ifc_guid es canónico DENTRO de un bim_model, no una garantía entre versiones — dos modelos distintos pueden reusar el mismo GUID sin que eso implique reconciliación automática", () => {
    // La unicidad real en bim_elements es (bim_model_id, ifc_guid) — ver
    // 0071_bim_presupuesto.sql. Este test documenta que findElementByExpressId
    // (y por extensión, cualquier lookup de este módulo) nunca asume que un
    // ifc_guid repetido entre dos bim_model distintos se refiere al "mismo"
    // elemento real — la reconciliación entre versiones no está implementada.
    const elements: BimElement[] = [
      makeElement({ id: "el-v1-wall", bim_model_id: "model-v1", express_id: 42, ifc_guid: "GUID-preservado" }),
      makeElement({ id: "el-v2-wall", bim_model_id: "model-v2", express_id: 99, ifc_guid: "GUID-preservado" }),
    ];
    expect(findElementByExpressId(elements, "model-v1", 42)?.id).toBe("el-v1-wall");
    expect(findElementByExpressId(elements, "model-v2", 99)?.id).toBe("el-v2-wall");
  });
});
