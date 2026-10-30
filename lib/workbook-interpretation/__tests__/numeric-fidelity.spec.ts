import * as XLSX from "xlsx";
import { describe, it, expect } from "vitest";
import { rawNumber, extractBudgetItems } from "../import-plan";
import { parseWorkbook, parseParaguayanNumber } from "../parser";
import type { ImportPlan } from "../types";

describe("numeric fidelity", () => {
  it.each([[0.125, 0.125], ["0,125", 0.125], ["0.125", 0.125], ["1e3", 1000], ["-2.5e-2", -0.025], ["1.234.567,89", 1234567.89], ["1,234,567.89", 1234567.89], ["Gs. 1500", 1500], [0, 0], ["0", 0]])("reads %s without changing scale", (value, expected) => {
    expect(rawNumber(value)).toBe(expected);
  });
  it.each(["s/d", "#DIV/0!", "", " ", "abc123", "1e", "1.234", "1,234", "1,2,3", "1 2", true, null, Infinity])("rejects invalid/ambiguous %s", value => {
    expect(rawNumber(value)).toBeNull();
  });
  it("keeps percentage points explicit in the legacy percentage API", () => {
    expect(rawNumber("35%")).toBeNull(); expect(parseParaguayanNumber("35%")).toBe(35);
    expect(parseParaguayanNumber("s/d")).toBeNull(); expect(parseParaguayanNumber("1e3")).toBe(1000);
  });
  it("never imports the numeric error code of an Excel cell as quantity", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["Código", "Descripción", "Cantidad", "Precio"], ["A", "Trabajo", 1, 100]]);
    sheet.C2 = { t: "e", v: 7, w: "#DIV/0!" };
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "Obra");
    const parsed = parseWorkbook(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "error.xlsx");
    const plan: ImportPlan = { workbookType: "CONSTRUCTION_PROJECT", overallConfidence: 1, unresolvedRegions: [], warnings: [], blocks: [{
      id: "budget", sheet: "Obra", sourceRange: "A1:D2", target: "BUDGET", confidence: 1, needsReview: false,
      headerRowStart: 1, headerRowEnd: 1, dataRowStart: 2, dataRowEnd: 2,
      columnMappings: [{ column: "A", role: "code", confidence: 1, notes: "" }, { column: "B", role: "description", confidence: 1, notes: "" }, { column: "C", role: "quantity", confidence: 1, notes: "" }, { column: "D", role: "unitPrice", confidence: 1, notes: "" }],
      repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "",
    }] };
    const extracted = extractBudgetItems(parsed, plan);
    expect(extracted.items).toHaveLength(1); expect(extracted.items[0].quantity).toBeNull();
    expect(extracted.items[0].unitPrice).toBe(100);
  });
});
