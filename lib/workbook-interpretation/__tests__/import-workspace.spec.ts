import { describe, expect, it } from "vitest";
import { applyImportDraft, importBlockingIssues, importRows, materialNeed, sourceMaterials, validateImportDraft } from "../import-workspace";
import type { CanonicalImportCandidate } from "../canonical-import";

const candidate = {
  budgetItems: ["01", "02"].map((code, index) => ({ code, description: `Trabajo ${code}`, unit: "m2", quantity: 1, unitPrice: 100, subtotal: 100, source: { sheet: "Ítems", row: index + 2 } })),
  budgetTotal: 200,
  linkedRecipes: { recipes: ["01", "02"].map(budgetCode => ({ budgetCode, lines: [{ kind: "MATERIAL", code: "C", description: "Cemento", unit: "kg", quantity: 0.125 }] })) },
} as CanonicalImportCandidate;
const draft = () => ({ rows: importRows(candidate), name: "Obra", code: "O1", regime: "PUBLIC_WORK", referenceQuantities: true, applySchedule: true, applyCertificate: false, applyStaff: true, applyWeather: true, applyExecution: true });

describe("linked import workspace", () => {
  it("blocks a partial extraction whose lines do not reproduce the source total", () => {
    const partial={...candidate,checks:[{id:"budget_declared_total",status:"WARNING",detail:"Las partidas no suman el total fuente."}]} as CanonicalImportCandidate;
    expect(importBlockingIssues(partial)).toEqual(["Las partidas no suman el total fuente."]);
  });
  it("keeps source data unchanged while reviewed measurements change budget and linked material needs", () => {
    const original = JSON.stringify(candidate);
    const raw = draft(); raw.rows[0].quantity = 6;
    const reviewed = applyImportDraft(candidate, raw);
    expect(reviewed.budgetTotal).toBe(700);
    const [cement] = sourceMaterials(candidate);
    expect(cement.links).toHaveLength(2);
    expect(materialNeed(cement, raw.rows)).toBe(0.875);
    expect(JSON.stringify(candidate)).toBe(original);
  });
  it("rejects lost, duplicated, foreign and relabelled identities", () => {
    const raw = draft(); raw.rows[1]._rowId = raw.rows[0]._rowId;
    expect(() => validateImportDraft(raw, candidate)).toThrow();
    expect(() => validateImportDraft({ ...draft(), rows: draft().rows.slice(1) }, candidate)).toThrow();
    const changed = draft(); changed.rows[0].code = "99";
    expect(() => validateImportDraft(changed, candidate)).toThrow();
  });
  it("distinguishes missing quantities from zero and rejects invalid numeric values", () => {
    const raw = draft(); raw.rows[0].quantity = null;
    expect(materialNeed(sourceMaterials(candidate)[0], raw.rows)).toBeNull();
    raw.rows[0].quantity = 0;
    expect(materialNeed(sourceMaterials(candidate)[0], raw.rows)).toBe(0.125);
    raw.rows[0].quantity = Number.NaN;
    expect(() => validateImportDraft(raw, candidate)).toThrow();
  });
  it("preserves reviewed expressions and never merges materials of different units", () => {
    const raw = draft(); raw.rows[0]._formulas = { quantity: "=3*2" };
    expect(validateImportDraft(raw, candidate).rows[0]._formulas?.quantity).toBe("=3*2");
    const mixed = structuredClone(candidate);
    mixed.linkedRecipes!.recipes[1].lines[0].unit = "bolsa";
    expect(sourceMaterials(mixed)).toHaveLength(2);
  });
});
