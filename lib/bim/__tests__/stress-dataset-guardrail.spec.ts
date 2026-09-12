// Verifica, SIN llamar a DeepSeek, que el guardrail determinista
// (buildCandidatePool -> isTechnicallyCompatible) efectivamente vacía el
// pool de candidatos para los casos adversariales diseñados para eso —
// antes de gastar ninguna llamada real, confirma que el veto ocurre en la
// capa correcta (filtro técnico), no que "por casualidad" el modelo
// responda bien.
import { describe, expect, it } from "vitest";
import { buildCandidatePool } from "../semantic-pipeline";
import { AURORA_BUDGET_ITEMS } from "./fixtures/aurora-budget-items";
import { STRESS_DATASET } from "./fixtures/aurora-stress-dataset";

function caseByE2E(id: string) {
  const found = STRESS_DATASET.find((c) => c.id === id);
  if (!found) throw new Error(`Caso ${id} no encontrado en el dataset`);
  return found;
}

describe("Guardrail determinista sobre casos adversariales (sin DeepSeek)", () => {
  it("ADV-06: el filtro técnico es solo por UNIDAD, no por concepto — 'Revestimiento cerámico' en m³ SÍ deja pasar EST-001/EST-002 (también m³)", () => {
    // Hallazgo real al construir este dataset: isTechnicallyCompatible no
    // descarta por incompatibilidad conceptual (revestimiento vs hormigón
    // estructural), solo por unidad/espesor/resistencia. Como el catálogo SÍ
    // tiene ítems en m³ (el hormigón), el pool NO queda vacío — a diferencia
    // de lo que se asumió al diseñar el caso. La prueba real de que esto no
    // produce un falso positivo queda en manos del matcher semántico (ver
    // live-stress-test.spec.ts), no del guardrail determinista.
    const pool = buildCandidatePool(caseByE2E("ADV-06").element, AURORA_BUDGET_ITEMS);
    const codes = pool.map((i) => i.code).sort();
    expect(codes).toEqual(["EST-001", "EST-002"]);
  });

  it("ADV-07 (H35, sin candidato exacto) queda con pool de candidatos de hormigón VACÍO", () => {
    const pool = buildCandidatePool(caseByE2E("ADV-07").element, AURORA_BUDGET_ITEMS);
    expect(pool.some((i) => i.code === "EST-001" || i.code === "EST-002")).toBe(false);
  });

  it("ADV-08 (12cm, sin candidato exacto) excluye ALB-001 y ALB-002 del pool", () => {
    const pool = buildCandidatePool(caseByE2E("ADV-08").element, AURORA_BUDGET_ITEMS);
    expect(pool.some((i) => i.code === "ALB-001" || i.code === "ALB-002")).toBe(false);
  });

  it("ADV-02/D2 (H40) SÍ deja EST-002 en el pool y excluye EST-001", () => {
    const pool = buildCandidatePool(caseByE2E("ADV-02").element, AURORA_BUDGET_ITEMS);
    const codes = pool.map((i) => i.code);
    expect(codes).toContain("EST-002");
    expect(codes).not.toContain("EST-001");
  });

  it("ADV-01 (100mm) SÍ deja ALB-002 en el pool y excluye ALB-001", () => {
    const pool = buildCandidatePool(caseByE2E("ADV-01").element, AURORA_BUDGET_ITEMS);
    const codes = pool.map((i) => i.code);
    expect(codes).toContain("ALB-002");
    expect(codes).not.toContain("ALB-001");
  });

  it("todos los 60 casos del dataset tienen candidatos definidos o pool vacío intencional — no crashea el pipeline", () => {
    for (const c of STRESS_DATASET) {
      expect(() => buildCandidatePool(c.element, AURORA_BUDGET_ITEMS)).not.toThrow();
    }
  });
});
