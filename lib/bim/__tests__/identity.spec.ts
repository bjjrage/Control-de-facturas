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
    ...overrides,
  };
}

describe("findElementByExpressId — express_id no es identidad durable entre versiones", () => {
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
});
