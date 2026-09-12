import { describe, expect, it } from "vitest";
import { areElementsGroupable, groupElements } from "../grouping";
import type { BimElement } from "@/lib/types";

function makeElement(overrides: Partial<BimElement> & { id: string }): BimElement {
  return {
    bim_model_id: "model-1",
    project_id: "proj-1",
    ifc_guid: `GUID-${overrides.id}`,
    ifc_type: "IfcWallStandardCase",
    express_id: 1,
    name: null,
    building_storey: "Nivel 1",
    material: null,
    properties: {},
    quantity_type: "area",
    quantity_value: null,
    quantity_unit: "m2",
    quantity_source: "IFC_QTO",
    quantity_property: null,
    created_at: new Date().toISOString(),
    group_id: null,
    ...overrides,
  };
}

describe("areElementsGroupable", () => {
  it("agrupa muros del mismo material/unidad aunque el nombre sea lexicalmente distinto", () => {
    const a = makeElement({ id: "a", name: "External Ceramic Wall 150 - A", material: "Ceramic" });
    const b = makeElement({ id: "b", name: "Muro cerámico e=0.15 - C", material: "Ceramic" });
    expect(areElementsGroupable(a, b)).toBe(true);
  });

  it("NO agrupa tipos IFC distintos (muro vs columna)", () => {
    const wall = makeElement({ id: "w", ifc_type: "IfcWallStandardCase" });
    const column = makeElement({ id: "c", ifc_type: "IfcColumn", quantity_type: "volume", quantity_unit: "m3" });
    expect(areElementsGroupable(wall, column)).toBe(false);
  });

  it("NO agrupa unidades distintas", () => {
    const a = makeElement({ id: "a", quantity_unit: "m2" });
    const b = makeElement({ id: "b", quantity_unit: "m3", quantity_type: "volume" });
    expect(areElementsGroupable(a, b)).toBe(false);
  });

  it("NO agrupa espesores incompatibles (15cm vs 10cm) aunque compartan tipo/unidad/material", () => {
    const a = makeElement({ id: "a", name: "Muro 150mm", material: "Ceramic" });
    const b = makeElement({ id: "b", name: "Muro 100mm", material: "Ceramic" });
    expect(areElementsGroupable(a, b)).toBe(false);
  });

  it("SÍ agrupa cuando el espesor no es detectable en uno de los dos (no es evidencia de diferencia)", () => {
    const a = makeElement({ id: "a", name: "External Wall - Ceramic Brick - 150", material: "Ceramic Brick" });
    const b = makeElement({ id: "b", name: "Wall - Ceramic - 150mm - F", material: "Ceramic" });
    expect(areElementsGroupable(a, b)).toBe(true);
  });

  it("NO agrupa materiales distintos (cerámico vs hormigón) aunque compartan tipo/unidad", () => {
    const a = makeElement({ id: "a", material: "Ceramic" });
    const b = makeElement({ id: "b", material: "Concrete" });
    expect(areElementsGroupable(a, b)).toBe(false);
  });

  it("SÍ agrupa cuando falta el material de un lado (sin dato no es evidencia de diferencia)", () => {
    const a = makeElement({ id: "a", material: "Ceramic" });
    const b = makeElement({ id: "b", material: null });
    expect(areElementsGroupable(a, b)).toBe(true);
  });
});

describe("groupElements", () => {
  it("reduce 10 muros equivalentes a 1 solo grupo, sin perder trazabilidad", () => {
    const names = [
      "External Ceramic Wall 150 - A",
      "External Ceramic Wall 150 - B",
      "Muro cerámico e=0.15 - C",
      "Ceramic Brick Wall 150 - D",
      "Mampostería cerámica 15cm - E",
      "Wall - Ceramic - 150mm - F",
      "Ceramic masonry wall 15 cm - G",
      "Muro de mampostería cerámica espesor 15 - H",
      "15cm Ceramic Block Wall - I",
      "Ext. Wall Ceramic 150mm - J",
    ];
    const elements = names.map((name, i) =>
      makeElement({ id: `w${i}`, name, material: "Ceramic", quantity_value: 15 + i })
    );

    const groups = groupElements(elements);

    expect(groups).toHaveLength(1);
    expect(groups[0].elements).toHaveLength(10);
    // 15+16+...+24 = 195
    expect(groups[0].totalQuantity).toBe(195);
  });

  it("separa en grupos distintos cuando el tipo/unidad/espesor difiere", () => {
    const wall15 = makeElement({ id: "w15", name: "Muro 150mm", material: "Ceramic", quantity_value: 20 });
    const wall10 = makeElement({ id: "w10", name: "Muro 100mm", material: "Ceramic", quantity_value: 10 });
    const column = makeElement({
      id: "col",
      ifc_type: "IfcColumn",
      name: "Columna H30",
      quantity_type: "volume",
      quantity_unit: "m3",
      quantity_value: 5,
    });

    const groups = groupElements([wall15, wall10, column]);

    expect(groups).toHaveLength(3);
  });

  it("total_quantity queda null si ningún elemento del grupo tiene cantidad extraída", () => {
    const a = makeElement({ id: "a", quantity_value: null });
    const b = makeElement({ id: "b", quantity_value: null });
    const groups = groupElements([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalQuantity).toBeNull();
  });

  it("no pierde elementos sin cantidad al sumar los que sí tienen (mezcla parcial)", () => {
    const a = makeElement({ id: "a", quantity_value: 10 });
    const b = makeElement({ id: "b", quantity_value: null });
    const groups = groupElements([a, b]);
    expect(groups[0].elements).toHaveLength(2);
    expect(groups[0].totalQuantity).toBe(10);
  });
});
