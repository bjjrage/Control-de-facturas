import { describe, expect, it } from "vitest";
import { aggregateElementsForBudgetItem, isTechnicallyCompatible, normalizeUnit, suggestMatches, unitsCompatibleForCosting } from "../matching";
import type { BimElement, BudgetItem } from "@/lib/types";

function makeElement(overrides: Partial<BimElement> = {}): BimElement {
  return {
    id: "el-1",
    bim_model_id: "model-1",
    project_id: "proj-1",
    ifc_guid: "GUID-1",
    ifc_type: "IfcWall",
    express_id: 1,
    name: "External Ceramic Wall 150",
    building_storey: "Nivel 1",
    material: "Ceramic Brick",
    properties: {},
    quantity_type: "area",
    quantity_value: 742,
    quantity_unit: "m2",
    quantity_source: "IFC_QTO",
    quantity_property: "Qto_WallBaseQuantities.NetSideArea",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeBudgetItem(overrides: Partial<BudgetItem> = {}): BudgetItem {
  return {
    id: "budget-1",
    project_id: "proj-1",
    parent_id: null,
    code: "1.1",
    description: "Mampostería cerámica hueca 15 cm",
    unit: "m2",
    quantity: 0,
    unit_price: 185000,
    subtotal: 0,
    sort_order: 0,
    start_date: null,
    end_date: null,
    depends_on: null,
    quantity_per_unit: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("normalizeUnit", () => {
  it("normaliza variantes conocidas a la unidad canónica", () => {
    expect(normalizeUnit("m²")).toBe("m2");
    expect(normalizeUnit("Metros Cuadrados")).toBe("m2");
    expect(normalizeUnit("ML")).toBe("m");
    expect(normalizeUnit("und")).toBe("u");
  });

  it("devuelve null para unidades desconocidas", () => {
    expect(normalizeUnit("cosa-rara")).toBeNull();
    expect(normalizeUnit(null)).toBeNull();
  });
});

describe("isTechnicallyCompatible", () => {
  it("descarta candidatos con unidad distinta", () => {
    const element = makeElement({ quantity_unit: "m2" });
    const item = makeBudgetItem({ unit: "m3" });
    expect(isTechnicallyCompatible(element, item)).toBe(false);
  });

  it("descarta H20 vs H40 aunque el texto sea semánticamente similar", () => {
    const element = makeElement({
      ifc_type: "IfcColumn",
      name: "Columna Hormigón H20",
      material: null,
      quantity_unit: "m3",
    });
    const item = makeBudgetItem({
      description: "Columna de Hormigón H40",
      unit: "m3",
    });
    expect(isTechnicallyCompatible(element, item)).toBe(false);
  });

  it("acepta candidatos técnicamente compatibles con espesores equivalentes (150mm == 15cm)", () => {
    const element = makeElement({ name: "External Ceramic Wall 150mm", quantity_unit: "m2" });
    const item = makeBudgetItem({ description: "Mampostería cerámica hueca 15 cm", unit: "m2" });
    expect(isTechnicallyCompatible(element, item)).toBe(true);
  });

  it("descarta espesores muy distintos", () => {
    const element = makeElement({ name: "Wall 150mm", quantity_unit: "m2" });
    const item = makeBudgetItem({ description: "Mampostería 30 cm", unit: "m2" });
    expect(isTechnicallyCompatible(element, item)).toBe(false);
  });
});

describe("suggestMatches", () => {
  it("propone y rankea candidatos compatibles por similitud semántica", () => {
    const element = makeElement();
    const candidates = [
      makeBudgetItem({ id: "b1", description: "Mampostería cerámica hueca 15 cm", unit: "m2" }),
      makeBudgetItem({ id: "b2", description: "Mampostería cerámica hueca 12 cm", unit: "m2" }),
      makeBudgetItem({ id: "b3", description: "Excavación manual", unit: "m3" }),
    ];

    const results = suggestMatches(element, candidates);

    expect(results.map((r) => r.budgetItem.id)).toContain("b1");
    expect(results.map((r) => r.budgetItem.id)).not.toContain("b3");
    expect(results[0].budgetItem.id).toBe("b1");
    expect(results[0].score).toBeGreaterThan(0.2);
  });

  it("nunca calcula precio: solo devuelve el budget_item, el precio lo aplica la UI tras confirmación", () => {
    const element = makeElement();
    const candidates = [makeBudgetItem({ unit_price: null })];
    const results = suggestMatches(element, candidates);
    expect(results[0].budgetItem.unit_price).toBeNull();
  });
});

describe("unitsCompatibleForCosting — autoridad para calcular cantidad × precio (fail closed)", () => {
  it("acepta unidades iguales tras normalizar: m, m2, m3, u", () => {
    expect(unitsCompatibleForCosting("m", "ML")).toBe(true);
    expect(unitsCompatibleForCosting("m2", "m²")).toBe(true);
    expect(unitsCompatibleForCosting("m3", "Metros Cúbicos")).toBe(true);
    expect(unitsCompatibleForCosting("u", "unidad")).toBe(true);
  });

  it("nunca convierte implícitamente entre magnitudes distintas: BIM m3 + rubro m2 no calcula", () => {
    expect(unitsCompatibleForCosting("m3", "m2")).toBe(false);
    expect(unitsCompatibleForCosting("kg", "u")).toBe(false);
  });

  it("falla cerrado si cualquiera de las dos unidades no se reconoce (antes fallaba abierto)", () => {
    expect(unitsCompatibleForCosting("cosa-rara", "m2")).toBe(false);
    expect(unitsCompatibleForCosting("m2", "cosa-rara")).toBe(false);
    expect(unitsCompatibleForCosting(null, "m2")).toBe(false);
    expect(unitsCompatibleForCosting("m2", null)).toBe(false);
    expect(unitsCompatibleForCosting(null, null)).toBe(false);
  });
});

describe("aggregateElementsForBudgetItem — agregación N elementos -> 1 rubro sin double counting", () => {
  it("suma solo elementos con unidad compatible con el rubro; excluye los demás (fail closed)", () => {
    const item = makeBudgetItem({ unit: "m2", quantity: 50 });
    const elements = [
      makeElement({ id: "wall-a", quantity_value: 18, quantity_unit: "m2" }),
      makeElement({ id: "wall-b", quantity_value: 23, quantity_unit: "m2" }),
      makeElement({ id: "wall-c", quantity_value: 14, quantity_unit: "m2" }),
      // Unidad no reconocida: antes se sumaba igual (bug), ahora se excluye.
      makeElement({ id: "wall-d", quantity_value: 999, quantity_unit: "cosa-rara" }),
      // Volumen en vez de área: nunca se mezcla con la suma de área.
      makeElement({ id: "column-e", quantity_value: 5, quantity_unit: "m3" }),
    ];

    const result = aggregateElementsForBudgetItem(elements, item);

    expect(result.totalQuantity).toBe(55); // 18 + 23 + 14, caso del enunciado del batch
    expect(result.compatible.map((e) => e.id).sort()).toEqual(["wall-a", "wall-b", "wall-c"]);
    expect(result.incompatible.map((e) => e.id).sort()).toEqual(["column-e", "wall-d"]);
  });

  it("no cuenta elementos sin cantidad extraída", () => {
    const item = makeBudgetItem({ unit: "m2" });
    const elements = [makeElement({ quantity_value: null, quantity_unit: "m2" })];
    const result = aggregateElementsForBudgetItem(elements, item);
    expect(result.totalQuantity).toBeNull();
  });
});
