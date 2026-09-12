import { describe, expect, it } from "vitest";
import { computoItemToBimElement, COMPUTO_SYNTHETIC_IFC_TYPE } from "../computo-mapper";
import type { ComputoItem } from "@/lib/types";

function item(overrides: Partial<ComputoItem>): ComputoItem {
  return {
    id: "item-1",
    computo_import_id: "import-1",
    project_id: "project-1",
    row_index: 0,
    description: "Mampostería cerámica 15 cm",
    quantity_value: 40,
    quantity_unit: "m2",
    raw_row: {},
    row_confidence: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("computoItemToBimElement", () => {
  it("mapea descripción, cantidad y unidad al shape de BimElement", () => {
    const el = computoItemToBimElement(item({}));
    expect(el.name).toBe("Mampostería cerámica 15 cm");
    expect(el.quantity_value).toBe(40);
    expect(el.quantity_unit).toBe("m2");
    expect(el.quantity_type).toBe("area");
    expect(el.ifc_type).toBe(COMPUTO_SYNTHETIC_IFC_TYPE);
    expect(el.material).toBeNull();
    expect(el.properties).toEqual({});
  });

  it("infiere quantity_type correctamente por unidad (m3->volume, kg->weight, u->count)", () => {
    expect(computoItemToBimElement(item({ quantity_unit: "m3" })).quantity_type).toBe("volume");
    expect(computoItemToBimElement(item({ quantity_unit: "kg" })).quantity_type).toBe("weight");
    expect(computoItemToBimElement(item({ quantity_unit: "u" })).quantity_type).toBe("count");
  });

  it("no infiere quantity_type si no hay cantidad (evita falsa certeza)", () => {
    const el = computoItemToBimElement(item({ quantity_value: null, quantity_unit: "m2" }));
    expect(el.quantity_type).toBeNull();
  });

  it("no infiere quantity_type si la unidad no está en el mapa conocido", () => {
    const el = computoItemToBimElement(item({ quantity_unit: "desconocida" }));
    expect(el.quantity_type).toBeNull();
  });
});
