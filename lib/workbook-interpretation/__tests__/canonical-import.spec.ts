import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCanonicalImportCandidate } from "../canonical-import";
import { parseWorkbook } from "../parser";
import type { WorkbookInterpretationResult } from "../types";

function field(value: string | number | null) {
  return { status: value === null ? "NOT_FOUND" as const : "FOUND" as const, value, confidence: 1 };
}

function result(importPlan: WorkbookInterpretationResult["importPlan"]): WorkbookInterpretationResult {
  return {
    documentType: "CONSTRUCTION_PROJECT",
    workbookSummary: { summary: "test", sheetCount: 3 },
    project: {
      name: field("Obra de prueba"),
      code: field("OBR-001"),
      client: field(null),
      contractor: field(null),
      location: field(null),
      contractNumber: field(null),
      startDate: field(null),
      endDate: field(null),
      totalAmount: field(null),
    },
    detectedSections: [],
    importPlan,
    budgetItems: [],
    coverage: [],
    warnings: [],
    unknownSections: [],
    overallConfidence: 1,
  };
}

describe("canonical workbook import mapping", () => {
  it("uses certificate contractual quantities for budget_items and does not apply an incompatible measurement", () => {
    const workbookFile = XLSX.write(
      {
        SheetNames: ["base", "CERTIFICADO", "MEDICIÓN"],
        Sheets: {
          base: XLSX.utils.aoa_to_sheet([
            ["COD", "RUBRO", "UND", "CANT", "P.U."],
            ["1", "Limpieza", "gl", 1, 100],
            ["2", "Replanteo", "m2", 2, 50],
          ]),
          CERTIFICADO: XLSX.utils.aoa_to_sheet([
            ["CERTIFICADO DE EJECUCIÓN DE OBRAS N° 6 - Paquete 05 - ID 14 - SIPP 3458 - Cantidad de viviendas: 37", null, null, null, null, null, null, null],
            ["Período: desde 01/01/2026 hasta 31/01/2026", null, null, null, null, null, null, null],
            ["COD", "RUBRO", "UND", "CONTRACTUAL", "ANTERIOR", "PRESENTE", "ACUMULADO", "P.U."],
            ["1", "Limpieza", "gl", 37, 10, 2, 12, 100],
            ["2", "Replanteo", "m2", 74, 20, 4, 24, 50],
          ]),
          "MEDICIÓN": XLSX.utils.aoa_to_sheet([
            ["Paquete 01 - ID 01 - SIPP 3389 - Cantidad de viviendas: 16"],
            ["V01 M01 L01", "0", "0", "0"],
          ]),
        },
      },
      { type: "buffer", bookType: "xlsx" }
    );
    const workbook = parseWorkbook(new Uint8Array(workbookFile), "test.xlsx");
    const importPlan = {
      workbookType: "CONSTRUCTION_PROJECT",
      overallConfidence: 1,
      blocks: [
        { id: "budget", sheet: "base", sourceRange: "A1:E3", target: "BUDGET" as const, confidence: 1, needsReview: false, headerRowStart: 1, headerRowEnd: 1, dataRowStart: 2, dataRowEnd: 3, columnMappings: [
          { column: "A", role: "code" as const, confidence: 1, notes: "" }, { column: "B", role: "description" as const, confidence: 1, notes: "" }, { column: "C", role: "unit" as const, confidence: 1, notes: "" }, { column: "D", role: "quantity" as const, confidence: 1, notes: "" }, { column: "E", role: "unitPrice" as const, confidence: 1, notes: "" },
        ], repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "" },
        { id: "certificate", sheet: "CERTIFICADO", sourceRange: "A3:H5", target: "CERTIFICATE" as const, confidence: 1, needsReview: false, headerRowStart: 3, headerRowEnd: 3, dataRowStart: 4, dataRowEnd: 5, columnMappings: [
          { column: "A", role: "code" as const, confidence: 1, notes: "" }, { column: "B", role: "description" as const, confidence: 1, notes: "" }, { column: "C", role: "unit" as const, confidence: 1, notes: "" }, { column: "D", role: "quantity" as const, confidence: 1, notes: "" }, { column: "E", role: "previousQuantity" as const, confidence: 1, notes: "" }, { column: "F", role: "currentQuantity" as const, confidence: 1, notes: "" }, { column: "G", role: "cumulativeQuantity" as const, confidence: 1, notes: "" }, { column: "H", role: "unitPrice" as const, confidence: 1, notes: "" },
        ], repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "" },
        { id: "measurement", sheet: "MEDICIÓN", sourceRange: "A1:D2", target: "MEASUREMENT" as const, confidence: 1, needsReview: false, headerRowStart: 1, headerRowEnd: 1, dataRowStart: 2, dataRowEnd: 2, columnMappings: [], repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "" },
      ],
      unresolvedRegions: [],
      warnings: [],
    };
    const candidate = buildCanonicalImportCandidate(workbook, result(importPlan));

    expect(candidate.budgetQuantitySource).toBe("CERTIFICATE_CONTRACT_QUANTITY");
    expect(candidate.budgetItems.map((item) => item.quantity)).toEqual([37, 74]);
    expect(candidate.certificate.status).toBe("SAFE_TO_APPLY");
    expect(candidate.certificate.itemCount).toBe(2);
    expect(candidate.measurement.status).toBe("DETECTED_NOT_APPLIED");
    expect(candidate.measurement.reason).toMatch(/identidad de obra distinta/);
  });

  it.skipIf(!fs.existsSync(path.join(process.env.USERPROFILE ?? "", "Downloads", "P05 - ID14 - SIPP 3458 - CERTIFICADO Nro. 6.-(2).xlsx")))
    ("audits the golden workbook without OpenAI or Supabase writes", () => {
      const file = path.join(process.env.USERPROFILE ?? "", "Downloads", "P05 - ID14 - SIPP 3458 - CERTIFICADO Nro. 6.-(2).xlsx");
      const workbook = parseWorkbook(fs.readFileSync(file), file);
      const mapping = (column: string, role: string) => ({ column, role, confidence: 1, notes: "" });
      const plan = {
        workbookType: "CONSTRUCTION_PROJECT",
        overallConfidence: 1,
        blocks: [
          { id: "budget", sheet: "base", sourceRange: "A11:H65", target: "BUDGET" as const, confidence: 1, needsReview: false, headerRowStart: 11, headerRowEnd: 11, dataRowStart: 12, dataRowEnd: 64, columnMappings: [mapping("A", "code"), mapping("B", "description"), mapping("C", "unit"), mapping("D", "quantity"), mapping("E", "unitPrice")], repeatedHeaderRows: [], subtotalRows: [65], footerRows: [], excludedRows: [], notes: "" },
          { id: "certificate", sheet: "CERTIFICADO", sourceRange: "A19:M75", target: "CERTIFICATE" as const, confidence: 1, needsReview: false, headerRowStart: 19, headerRowEnd: 21, dataRowStart: 22, dataRowEnd: 74, columnMappings: [mapping("A", "code"), mapping("B", "description"), mapping("C", "unit"), mapping("D", "quantity"), mapping("E", "previousQuantity"), mapping("F", "currentQuantity"), mapping("G", "cumulativeQuantity"), mapping("H", "unitPrice"), mapping("M", "percentage")], repeatedHeaderRows: [], subtotalRows: [75], footerRows: [], excludedRows: [], notes: "" },
          { id: "measurement", sheet: "MEDICIÓN", sourceRange: "A16:E774", target: "MEASUREMENT" as const, confidence: 1, needsReview: false, headerRowStart: 16, headerRowEnd: 20, dataRowStart: 21, dataRowEnd: 774, columnMappings: [], repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "" },
        ],
        unresolvedRegions: [],
        warnings: [],
      };
      const result = {
        documentType: "CONSTRUCTION_PROJECT",
        workbookSummary: { summary: "golden", sheetCount: 15 },
        project: { name: field("golden"), code: field("P05-ID14"), client: field(null), contractor: field(null), location: field(null), contractNumber: field(null), startDate: field(null), endDate: field(null), totalAmount: field(null) },
        detectedSections: [], importPlan: plan, budgetItems: [], coverage: [], warnings: [], unknownSections: [], overallConfidence: 1,
      } as WorkbookInterpretationResult;
      const candidate = buildCanonicalImportCandidate(workbook, result);
      expect(workbook.sheets).toHaveLength(15);
      expect(workbook.totalCells).toBe(7456);
      expect(candidate.budgetItems).toHaveLength(53);
      expect(candidate.budgetQuantitySource).toBe("CERTIFICATE_CONTRACT_QUANTITY");
      expect(candidate.budgetTotal).toBe(3482791500);
      expect(candidate.certificate.status).toBe("SAFE_TO_APPLY");
      expect(candidate.certificate.itemCount).toBe(53);
      expect(candidate.certificate.matchedBudgetItems).toBe(53);
      expect(candidate.measurement.status).toBe("DETECTED_NOT_APPLIED");
      expect(candidate.measurement.blockCount).toBe(33);
      expect(candidate.measurement.detailRows).toBe(528);
      expect(candidate.measurement.matchingItems).toBe(4);
      expect(candidate.measurement.identity).toMatchObject({ package: "1", id: "1", sipp: "3389", housingCount: "16" });
      expect(candidate.measurement.canonicalIdentity).toMatchObject({ package: "5", id: "14", sipp: "3458" });
    });
});
