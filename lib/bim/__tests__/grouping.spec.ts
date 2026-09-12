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

  it("SÍ agrupa cuando el espesor no es detectable en uno de los dos y el material es idéntico (no es evidencia de diferencia)", () => {
    const a = makeElement({ id: "a", name: "External Wall - Ceramic Brick - 150", material: "Ceramic Brick" });
    const b = makeElement({ id: "b", name: "Wall - Ceramic Brick - 150mm - F", material: "Ceramic Brick" });
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

  // --- Adversariales: agrupación conservadora ------------------------------
  // La agrupación ocurre ANTES del semantic matcher — fusionar de más acá es
  // una decisión física irreversible (bim_elements.group_id), no una
  // sugerencia que la IA pueda corregir después. Por eso exige igualdad
  // exacta de material (normalizada), nunca similitud lexical.

  it("ADVERSARIAL: 'Ceramic Brick' vs 'Ceramic Block' NO se fusionan solo por parecido lexical", () => {
    // Bigram similarity real entre estos dos strings es ~0.69 (comparten
    // "Ceramic" y ambas palabras terminan parecido) — un umbral de similitud
    // los fusionaría por error. Ladrillo cerámico y bloque cerámico son
    // productos distintos con costos distintos.
    const a = makeElement({ id: "a", name: "Ceramic Brick Wall", material: "Ceramic Brick" });
    const b = makeElement({ id: "b", name: "Ceramic Block Wall", material: "Ceramic Block" });
    expect(areElementsGroupable(a, b)).toBe(false);
  });

  it("ADVERSARIAL: 'Ceramic' vs 'Ceramic Brick' NO se fusionan sin evidencia de que son el mismo producto", () => {
    // Aunque uno sea un prefijo textual del otro, "Ceramic" a secas es
    // ambiguo (¿ladrillo? ¿bloque? ¿revestimiento?) — sin más evidencia, no
    // se asume que es el mismo material que "Ceramic Brick".
    const a = makeElement({ id: "a", material: "Ceramic" });
    const b = makeElement({ id: "b", material: "Ceramic Brick" });
    expect(areElementsGroupable(a, b)).toBe(false);
  });

  it("ADVERSARIAL: variantes de idioma del mismo material ('Ceramic' vs 'Cerámico') tampoco se fusionan automáticamente", () => {
    // Preferible generar más grupos y dejar que DeepSeek los relacione al
    // mismo budget_item después (ver finalBudgetRows, que agrega por
    // budget_item_id sumando varios grupos confirmados) — nunca fusionar
    // físicamente antes de que la IA los vea.
    const a = makeElement({ id: "a", material: "Ceramic" });
    const b = makeElement({ id: "b", material: "Cerámico" });
    expect(areElementsGroupable(a, b)).toBe(false);
  });

  it("ADVERSARIAL: 'H30' vs 'H40' en el campo material tampoco se fusionan (similitud de texto alta, resistencia distinta)", () => {
    const a = makeElement({ id: "a", ifc_type: "IfcColumn", quantity_type: "volume", quantity_unit: "m3", material: "H30" });
    const b = makeElement({ id: "b", ifc_type: "IfcColumn", quantity_type: "volume", quantity_unit: "m3", material: "H40" });
    expect(areElementsGroupable(a, b)).toBe(false);
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

  it("con variantes REALES de material (idioma/nomenclatura distinta), genera VARIOS grupos en vez de fusionar por similitud — comportamiento esperado tras el fix de agrupación conservadora", () => {
    // Mismo dataset que el test de arriba, pero con las variantes de
    // material reales que trae aurora-stress-dataset.ts (Ceramic / Cerámico
    // / Ceramic Brick / Ceramic Block). Antes del fix (umbral de similitud
    // 0.25) esto colapsaba a 1 solo grupo. Ahora, sin evidencia de que son
    // el mismo material exacto, quedan separados — y es DeepSeek quien los
    // relaciona al mismo budget_item después, no la agrupación.
    const entries: Array<[string, string]> = [
      ["External Ceramic Wall 150 - A", "Ceramic"],
      ["External Ceramic Wall 150 - B", "Ceramic"],
      ["Muro cerámico e=0.15 - C", "Cerámico"],
      ["Ceramic Brick Wall 150 - D", "Ceramic Brick"],
      ["Mampostería cerámica 15cm - E", "Cerámico"],
      ["Wall - Ceramic - 150mm - F", "Ceramic"],
      ["Ceramic masonry wall 15 cm - G", "Ceramic"],
      ["Muro de mampostería cerámica espesor 15 - H", "Cerámico"],
      ["15cm Ceramic Block Wall - I", "Ceramic Block"],
      ["Ext. Wall Ceramic 150mm - J", "Ceramic"],
    ];
    const elements = entries.map(([name, material], i) =>
      makeElement({ id: `w${i}`, name, material, quantity_value: 15 + i })
    );

    const groups = groupElements(elements);

    // Ceramic / Cerámico / Ceramic Brick / Ceramic Block -> 4 materiales
    // textualmente distintos -> al menos 4 grupos (nunca 1).
    expect(groups.length).toBeGreaterThanOrEqual(4);
    const totalElementsAcrossGroups = groups.reduce((s, g) => s + g.elements.length, 0);
    expect(totalElementsAcrossGroups).toBe(10); // ningún elemento se pierde
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
