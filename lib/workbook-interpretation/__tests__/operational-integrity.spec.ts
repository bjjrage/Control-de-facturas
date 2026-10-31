import { describe, expect, it } from "vitest";
import { rawNumber } from "../import-plan";
import { selectedImportIssues } from "../import-integrity";
import { block, budgetFixture, certificateFixture } from "./contract-fixtures";

const errors = (f: ReturnType<typeof budgetFixture>) => f.candidate().integrity!.issues.filter(i => i.severity === "ERROR");
describe("operational input contract across workbook layouts", () => {
  it.each([
    { columns: ["code", "description", "unit", "quantity", "unitPrice", "subtotal"] as const, top: 0 },
    { columns: ["unitPrice", "unit", "description", "subtotal", "code", "quantity"] as const, top: 7 },
    { columns: ["description", "quantity", "code", "unitPrice", "unit"] as const, top: 18 },
  ])("uses the declared cells with reordered columns and shifted headers: $top", ({ columns, top }) => {
    const f = budgetFixture({ columns: [...columns], top });
    expect(f.candidate().budgetTotal).toBe(251);
    expect(f.candidate().budgetItems[0]).toMatchObject({ code: "1", unit: "m3", quantity: 2, unitPrice: 125.5 });
    expect(errors(f)).toEqual([]);
  });
  it.each(["precio a confirmar", "#DIV/0!", "Gs.", "12abc34", "--", "1,2,3"])("does not manufacture a numeric zero from %s", value => expect(rawNumber(value)).toBeNull());
  it.each([["Gs. 1.234,50", 1234.5], ["USD 1,234.50", 1234.5], ["0", 0]])("preserves supported textual numeric values %s", (value, expected) => expect(rawNumber(value)).toBe(expected));
  it("blocks a missing quantity instead of creating a zero-budget item", () => {
    const f = budgetFixture({ items: [{ code: "1", description: "Excavación", unit: "m3", quantity: null, unitPrice: 10 }] });
    expect(errors(f).some(i => i.domain === "BUDGET" && i.message.includes("dato faltante"))).toBe(true);
  });
  it.each([{ quantity: 1.00001, unitPrice: 10 }, { quantity: 1, unitPrice: 10.001 }])("does not silently lose precision at persistence: %j", values => {
    const f = budgetFixture({ items: [{ code: "1", description: "Partida", unit: "un", ...values }] });
    expect(errors(f).some(i => i.message.includes("precisión"))).toBe(true);
  });
  it("ignores an actual blank spacer but reports an unreadable data row", () => {
    const item = { code: "1", description: "Excavación", unit: "m3", quantity: 1, unitPrice: 10 };
    const f = budgetFixture({ items: [item, null, { ...item, code: "2" }] });
    expect(f.candidate().budgetItems).toHaveLength(2);
    expect(errors(f)).toEqual([]);
    f.workbook.sheets[0].cells.push({ address: "D3", row: 3, column: 4, raw: 5, formatted: "5", formula: null, type: "n" });
    expect(errors(f).some(i => i.message.includes("sin extraer"))).toBe(true);
  });
  it("blocks duplicate column roles and duplicate budget codes", () => {
    const f = budgetFixture();
    f.result.importPlan.blocks[0].columnMappings.push({ column: "F", role: "unitPrice", confidence: 1, notes: "otro precio" });
    expect(errors(f).some(i => i.message.includes("varias columnas"))).toBe(true);
    const item = { code: "1", description: "Partida", unit: "un", quantity: 1, unitPrice: 10 };
    expect(errors(budgetFixture({ items: [item, item] })).some(i => i.message.includes("más de una vez"))).toBe(true);
  });
  it.each(["error", "uncached", "date", "percent"])("rejects a %s cell mapped as a unit price", mode => {
    const f = budgetFixture();
    const cell = f.workbook.sheets[0].cells.find(c => c.address === "E2")!;
    if (mode === "error") { cell.raw = "#DIV/0!"; cell.type = "e"; }
    if (mode === "uncached") { cell.raw = null; cell.formula = "D2*2"; }
    if (mode === "date") cell.numberFormat = "dd/mm/yyyy";
    if (mode === "percent") cell.numberFormat = "0.00%";
    expect(errors(f).some(i => i.message.includes("E2"))).toBe(true);
  });
  it("blocks arithmetic inconsistencies before a financial write", () => {
    const f = budgetFixture();
    f.workbook.sheets[0].cells.find(c => c.address === "F2")!.raw = 999;
    expect(errors(f).some(i => i.message.includes("cantidad × precio"))).toBe(true);
  });
  it("checks a declared contract total in its verified scale, not against a prototype subtotal", () => {
    const f = certificateFixture();
    f.result.importPlan.relationships![0] = { ...f.result.importPlan.relationships![0], type: "CONTRACT_SCALE", factor: 37 };
    f.workbook.sheets[1].cells.find(c => c.address === "D2")!.raw = 74;
    f.workbook.sheets[0].cells.push({ address: "F3", row: 3, column: 6, raw: 9287, formatted: "9287", formula: null, type: "n" });
    f.result.importPlan.blocks[0].keyValues = [{ key: "declaredTotal", cell: "F3", value: 9287, notes: "total contractual" }];
    expect(f.candidate().budgetTotal).toBe(9287);
    expect(errors(f)).toEqual([]);
    f.workbook.sheets[0].cells.find(c => c.address === "F3")!.raw = 9999;
    f.result.importPlan.blocks[0].keyValues[0].value = 9999;
    expect(errors(f).some(i => i.message.includes("total declarado"))).toBe(true);
  });
  it("requires explicit acknowledgement for unsupported APU/BOM and unresolved regions", () => {
    const f = budgetFixture();
    f.result.importPlan.blocks.push(block({ id: "apu", target: "APU", columnMappings: [], label: "Recetas" }));
    f.result.unknownSections.push({ sheet: "Entrada", range: "F2", reason: "dato sin destino" });
    const candidate = f.candidate();
    const issues = selectedImportIssues(candidate.integrity!, { schedule: false, weather: false });
    expect(issues.some(i => i.severity === "REVIEW" && i.message.includes("APU"))).toBe(true);
    expect(issues.some(i => i.message.includes("dato sin destino"))).toBe(true);
  });
  it("blocks inconsistent certificate quantities only when that section is selected", () => {
    const f = certificateFixture();
    expect(f.candidate().certificate.status).toBe("SAFE_TO_APPLY");
    f.workbook.sheets[1].cells.find(c => c.address === "H2")!.raw = 2;
    const integrity = f.candidate().integrity!;
    expect(selectedImportIssues(integrity, { certificate: true, schedule: false, weather: false }).some(i => i.domain === "CERTIFICATE" && i.severity === "ERROR")).toBe(true);
    expect(selectedImportIssues(integrity, { certificate: false, schedule: false, weather: false }).some(i => i.domain === "CERTIFICATE")).toBe(false);
  });
  it("does not import a partial execution set when some rows have no budget counterpart", () => {
    const f = budgetFixture();
    f.result.importPlan.blocks.push(block({ id: "execution", target: "EXECUTION", columnMappings: [{ column: "A", role: "code", confidence: 1, notes: "" }, { column: "B", role: "description", confidence: 1, notes: "" }, { column: "D", role: "currentQuantity", confidence: 1, notes: "" }] }));
    // A different source code can no longer be silently skipped at creation.
    f.result.importPlan.blocks[1].columnMappings[0].column = "F";
    const integrity = f.candidate().integrity!;
    expect(selectedImportIssues(integrity, { execution: true, schedule: false, weather: false }).some(i => i.domain === "EXECUTION" && i.severity === "ERROR")).toBe(true);
  });
});
