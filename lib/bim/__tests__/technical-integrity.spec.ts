import { describe, expect, it } from "vitest";
import { checkTechnicalIntegrity } from "../technical-integrity";
import type { BimElement, BudgetItem } from "@/lib/types";

function element(overrides: Partial<BimElement>): BimElement {
  return {
    id: "el-1",
    bim_model_id: "model-1",
    project_id: "project-1",
    ifc_guid: "guid-1",
    ifc_type: "IfcWallStandardCase",
    express_id: 1,
    name: null,
    building_storey: null,
    material: null,
    properties: {},
    quantity_type: "area",
    quantity_value: 10,
    quantity_unit: "m2",
    quantity_source: "IFC_QTO",
    quantity_property: null,
    created_at: new Date().toISOString(),
    group_id: null,
    ...overrides,
  };
}

function budgetItem(overrides: Pick<BudgetItem, "code" | "description" | "unit">): BudgetItem {
  return {
    id: `bi-${overrides.code}`,
    project_id: "project-1",
    parent_id: null,
    quantity: null,
    unit_price: 100000,
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

describe("checkTechnicalIntegrity", () => {
  it("detecta CONFLICTING_THICKNESS entre name y properties", () => {
    const el = element({ name: "Muro cerámico 10 cm", properties: { thickness: "200 mm" } });
    const result = checkTechnicalIntegrity(el, []);
    expect(result).toEqual({ vicious: true, reason: "CONFLICTING_THICKNESS" });
  });

  it("detecta CONFLICTING_STRENGTH entre name y properties (hormigón)", () => {
    const el = element({ name: "Hormigón estructural H30", properties: { strength: "H40" } });
    const result = checkTechnicalIntegrity(el, []);
    expect(result).toEqual({ vicious: true, reason: "CONFLICTING_STRENGTH" });
  });

  it("detecta CONFLICTING_STRENGTH entre name y properties (acero)", () => {
    const el = element({ name: "Acero CA-50", properties: { grado: "CA-60" } });
    const result = checkTechnicalIntegrity(el, []);
    expect(result).toEqual({ vicious: true, reason: "CONFLICTING_STRENGTH" });
  });

  it("detecta CONFLICTING_MATERIAL entre name y el campo material", () => {
    const el = element({ name: "Ceramic Brick Wall", material: "Concrete" });
    const result = checkTechnicalIntegrity(el, []);
    expect(result).toEqual({ vicious: true, reason: "CONFLICTING_MATERIAL" });
  });

  it("detecta AMBIGUOUS_RANGE cuando el rango deja más de un candidato plausible", () => {
    const el = element({ name: "Muro cerámico, espesor aproximado entre 15 y 18 cm" });
    const candidates = [
      budgetItem({ code: "MAM-15", description: "Mampostería cerámica 15 cm", unit: "m2" }),
      budgetItem({ code: "MAM-18", description: "Mampostería cerámica 18 cm", unit: "m2" }),
    ];
    const result = checkTechnicalIntegrity(el, candidates);
    expect(result).toEqual({ vicious: true, reason: "AMBIGUOUS_RANGE" });
  });

  it("NO marca AMBIGUOUS_RANGE si el rango deja un único candidato plausible", () => {
    const el = element({ name: "Muro cerámico, espesor aproximado entre 9 y 11 cm" });
    const candidates = [
      budgetItem({ code: "MAM-10", description: "Mampostería cerámica 10 cm", unit: "m2" }),
      budgetItem({ code: "MAM-18", description: "Mampostería cerámica 18 cm", unit: "m2" }),
    ];
    const result = checkTechnicalIntegrity(el, candidates);
    expect(result).toEqual({ vicious: false, reason: null });
  });

  it("no marca conflicto en un input coherente y completo", () => {
    const el = element({ name: "Mampostería cerámica 15 cm", material: "Cerámica", properties: { espesor_cm: 15 } });
    const result = checkTechnicalIntegrity(el, []);
    expect(result).toEqual({ vicious: false, reason: null });
  });

  it("no opina si properties no declara nada reconocible (conservador)", () => {
    const el = element({ name: "Hormigón H30", properties: { nota: "verificar en obra" } });
    const result = checkTechnicalIntegrity(el, []);
    expect(result).toEqual({ vicious: false, reason: null });
  });

  // --- Texto libre en properties: evidencia contextual requerida -------------

  it("detecta CONFLICTING_THICKNESS en una nota libre con lenguaje de incertidumbre", () => {
    const el = element({
      name: "Mampostería cerámica 10 cm",
      properties: { nota_obra: "verificar in situ, podría ser 20cm" },
    });
    const result = checkTechnicalIntegrity(el, []);
    expect(result).toEqual({ vicious: true, reason: "CONFLICTING_THICKNESS" });
  });

  it("detecta CONFLICTING_THICKNESS en una nota libre con palabra de espesor", () => {
    const el = element({ name: "Mampostería cerámica 10 cm", properties: { obs: "esp. 20 cm según planilla" } });
    const result = checkTechnicalIntegrity(el, []);
    expect(result).toEqual({ vicious: true, reason: "CONFLICTING_THICKNESS" });
  });

  it.each([
    ["separación 20 cm", { nota: "separación 20 cm" }],
    ["zócalo 10 cm", { nota: "zócalo 10 cm" }],
    ["junta cada 15 cm", { nota: "junta cada 15 cm" }],
  ])("NO marca conflicto por una dimensión sin evidencia de espesor: %s", (_label, properties) => {
    const el = element({ name: "Mampostería cerámica 15 cm", properties });
    const result = checkTechnicalIntegrity(el, []);
    expect(result).toEqual({ vicious: false, reason: null });
  });

  it("NO lee como espesor una clave que declara otra dimensión, aun con incertidumbre", () => {
    const el = element({ name: "Mampostería cerámica 15 cm", properties: { altura: "verificar, aprox 250 cm" } });
    const result = checkTechnicalIntegrity(el, []);
    expect(result).toEqual({ vicious: false, reason: null });
  });

  it("nunca interpreta números sin unidad explícita", () => {
    const el = element({ name: "Mampostería cerámica 15 cm", properties: { nota: "verificar, podría ser 20" } });
    const result = checkTechnicalIntegrity(el, []);
    expect(result).toEqual({ vicious: false, reason: null });
  });

  // --- Rangos: conteo sobre el catálogo completo, por espesores distintos ----

  it("detecta AMBIGUOUS_RANGE en la forma con guión (15-18 cm)", () => {
    const el = element({ name: "Muro cerámico 15-18 cm" });
    const candidates = [
      budgetItem({ code: "MAM-15", description: "Mampostería cerámica 15 cm", unit: "m2" }),
      budgetItem({ code: "MAM-18", description: "Mampostería cerámica 18 cm", unit: "m2" }),
    ];
    const result = checkTechnicalIntegrity(el, candidates);
    expect(result).toEqual({ vicious: true, reason: "AMBIGUOUS_RANGE" });
  });

  it("NO marca AMBIGUOUS_RANGE si los candidatos del rango comparten el mismo espesor", () => {
    const el = element({ name: "Muro, espesor aproximado entre 14 y 16 cm" });
    const candidates = [
      budgetItem({ code: "MAM-CER-15", description: "Mampostería cerámica 15 cm", unit: "m2" }),
      budgetItem({ code: "MAM-LAD-15", description: "Mampostería de ladrillo común 15 cm", unit: "m2" }),
    ];
    const result = checkTechnicalIntegrity(el, candidates);
    expect(result).toEqual({ vicious: false, reason: null });
  });

  it("ignora candidatos con unidad no costeable al contar el rango", () => {
    const el = element({ name: "Muro cerámico, espesor entre 15 y 18 cm", quantity_unit: "m2", quantity_type: "area" });
    const candidates = [
      budgetItem({ code: "MAM-15", description: "Mampostería cerámica 15 cm", unit: "m2" }),
      budgetItem({ code: "HOR-18", description: "Hormigón en muros 18 cm", unit: "m3" }),
    ];
    const result = checkTechnicalIntegrity(el, candidates);
    expect(result).toEqual({ vicious: false, reason: null });
  });
});
