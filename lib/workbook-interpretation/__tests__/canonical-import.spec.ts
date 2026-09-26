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
  it("extracts días no trabajados from a month×day calendar grid, skipping invalid days and unrecognized codes", () => {
    const workbookFile = XLSX.write(
      {
        SheetNames: ["clima"],
        Sheets: {
          clima: XLSX.utils.aoa_to_sheet([
            ["año", "mes", 1, 2, 3, 4],
            [2026, "1. Febrero", "B", "LL", "?", "O"],
            [null, "2. Marzo", "HH", "B", "B", "B"],
          ]),
        },
      },
      { type: "buffer", bookType: "xlsx" }
    );
    const workbook = parseWorkbook(new Uint8Array(workbookFile), "test.xlsx");
    const importPlan = {
      workbookType: "CONSTRUCTION_PROJECT",
      overallConfidence: 1,
      blocks: [{
        id: "clima", sheet: "clima", sourceRange: "A1:F3", target: "NON_WORKING_DAYS" as const, confidence: 1, needsReview: false,
        headerRowStart: 1, headerRowEnd: 1, dataRowStart: 2, dataRowEnd: 3, columnMappings: [], repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "",
        // Day 30 in a 28-day February must be dropped; the "?" cell in D2 has
        // no recognized code and must be dropped too — both silently, not as
        // hard errors, with the drop counted in warnings.
        weatherRows: [
          { row: 2, year: 2026, month: 2, dayColumns: [{ column: "C", day: 1 }, { column: "D", day: 2 }, { column: "E", day: 3 }, { column: "F", day: 30 }] },
          { row: 3, year: 2026, month: 3, dayColumns: [{ column: "C", day: 1 }, { column: "D", day: 2 }, { column: "E", day: 3 }, { column: "F", day: 4 }] },
        ],
      }],
      unresolvedRegions: [],
      warnings: [],
    };
    const candidate = buildCanonicalImportCandidate(workbook, result(importPlan));

    expect(candidate.weatherDays).toEqual([
      { date: "2026-02-01", code: "B", sheet: "clima", row: 2, column: "C" },
      { date: "2026-02-02", code: "LL", sheet: "clima", row: 2, column: "D" },
      { date: "2026-03-01", code: "HH", sheet: "clima", row: 3, column: "C" },
      { date: "2026-03-02", code: "B", sheet: "clima", row: 3, column: "D" },
      { date: "2026-03-03", code: "B", sheet: "clima", row: 3, column: "E" },
      { date: "2026-03-04", code: "B", sheet: "clima", row: 3, column: "F" },
    ]);
    expect(candidate.domains).toHaveLength(0);
    expect(candidate.warnings.join(" ")).toMatch(/no existen en su mes/);
    expect(candidate.warnings.join(" ")).toMatch(/distinto de B\/LL\/HH\/O/);
  });

  it("extracts registro LDO execution entries, matching by budget code and dropping zero/near-zero and unmatched rows", () => {
    const workbookFile = XLSX.write(
      {
        SheetNames: ["base", "ldo"],
        Sheets: {
          base: XLSX.utils.aoa_to_sheet([
            ["COD", "RUBRO", "UND", "CANT", "P.U."],
            ["1", "Limpieza", "gl", 1, 100],
            ["2", "Replanteo", "m2", 2, 50],
          ]),
          ldo: XLSX.utils.aoa_to_sheet([
            ["item", "rubro", "unidad", "presente"],
            [1, "Limpieza", "gl", 21.4],
            [2, "Replanteo", "m2", 1.8189894035458565e-12], // floating-point noise from the sheet's own IF() formula; must be treated as "no execution"
            [99, "Rubro inexistente", "un", 5], // no matching budget code; cannot be inserted (execution_entries needs budget_item_id)
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
        { id: "ldo", sheet: "ldo", sourceRange: "A1:D4", target: "EXECUTION" as const, confidence: 1, needsReview: false, headerRowStart: 1, headerRowEnd: 1, dataRowStart: 2, dataRowEnd: 4, columnMappings: [
          { column: "A", role: "code" as const, confidence: 1, notes: "" }, { column: "B", role: "description" as const, confidence: 1, notes: "" }, { column: "C", role: "unit" as const, confidence: 1, notes: "" }, { column: "D", role: "currentQuantity" as const, confidence: 1, notes: "" },
        ], repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "" },
      ],
      unresolvedRegions: [],
      warnings: [],
    };
    const candidate = buildCanonicalImportCandidate(workbook, result(importPlan));

    expect(candidate.executionEntries).toHaveLength(2);
    const matched = candidate.executionEntries.find((e) => e.code === "1")!;
    expect(matched.matchedBudgetCode).toBe("1");
    expect(matched.matchQuality).toBe("EXACT");
    expect(matched.quantityExecuted).toBe(21.4);
    const unmatched = candidate.executionEntries.find((e) => e.code === "99")!;
    expect(unmatched.matchedBudgetCode).toBeNull();
    expect(unmatched.matchQuality).toBe("UNMATCHED");
    // Code "2" never appears: its "presente" was floating-point noise (~0),
    // meaning nothing was actually executed that period.
    expect(candidate.executionEntries.some((e) => e.code === "2")).toBe(false);
    expect(candidate.domains).toHaveLength(0);
    expect(candidate.warnings.join(" ")).toMatch(/sin avance en este período/);
    expect(candidate.warnings.join(" ")).toMatch(/sin partida de presupuesto vinculada/);
  });

  it("extracts staff rows (skipping section headers) and planned schedule months (ignoring executed rows)", () => {
    const workbookFile = XLSX.write(
      {
        SheetNames: ["personal", "curva"],
        Sheets: {
          personal: XLSX.utils.aoa_to_sheet([
            ["DIRECCIÓN Y ADMINISTRACIÓN"],
            ["Arq. Juan Pérez", "Residente de obra"],
            ["OPERADORES"],
            ["Ana Gómez", "Oficial"],
          ]),
          curva: XLSX.utils.aoa_to_sheet([
            ["", "M1", "M2", "M3"],
            ["Programado mes", 20, 30, 50],
            ["Ejecutado mes", 15, 25, 45],
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
        {
          id: "personal", sheet: "personal", sourceRange: "A1:B4", target: "STAFF" as const, confidence: 1, needsReview: false,
          headerRowStart: 1, headerRowEnd: 1, dataRowStart: 2, dataRowEnd: 4,
          columnMappings: [{ column: "A", role: "name" as const, confidence: 1, notes: "" }, { column: "B", role: "value" as const, confidence: 1, notes: "" }],
          repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "",
          // Rows 1 and 3 are section-header labels a model might mistakenly
          // report as staff; the extractor verifies against the real
          // cells (which have no role in column B) and drops them regardless
          // of what the model claims here.
          staffRows: [{ row: 1, name: "DIRECCIÓN Y ADMINISTRACIÓN", role: "n/a" }, { row: 2, name: "Arq. Juan Pérez", role: "Residente de obra" }, { row: 3, name: "OPERADORES", role: "n/a" }, { row: 4, name: "Ana Gómez", role: "Oficial" }],
        },
        {
          id: "curva", sheet: "curva", sourceRange: "A1:D3", target: "SCHEDULE" as const, confidence: 1, needsReview: false,
          headerRowStart: 1, headerRowEnd: 1, dataRowStart: 2, dataRowEnd: 3, columnMappings: [], repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "",
          scheduleSeries: [
            { row: 2, label: "Programado mes", role: "PLANNED_MONTHLY" as const, planVersion: "Original", monthColumns: [{ column: "B", monthIndex: 1 }, { column: "C", monthIndex: 2 }, { column: "D", monthIndex: 3 }] },
            // Real workbooks have ONE shared executed row, not one per
            // contract version — the model may label it under its own group
            // (here "Ejecución observada") instead of "Original". It must
            // still attach to the "Original" plan below.
            { row: 3, label: "Ejecutado mes", role: "EXECUTED_MONTHLY" as const, planVersion: "Ejecución observada", monthColumns: [{ column: "B", monthIndex: 1 }, { column: "C", monthIndex: 2 }, { column: "D", monthIndex: 3 }] },
          ],
        },
      ],
      unresolvedRegions: [],
      warnings: [],
    };
    const candidate = buildCanonicalImportCandidate(workbook, result(importPlan));

    expect(candidate.staff).toEqual([
      { name: "Arq. Juan Pérez", role: "Residente de obra", sheet: "personal", row: 2 },
      { name: "Ana Gómez", role: "Oficial", sheet: "personal", row: 4 },
    ]);
    expect(candidate.schedulePlans).toHaveLength(1);
    expect(candidate.schedulePlans[0].planVersion).toBe("Original");
    expect(candidate.schedulePlans[0].months).toEqual([
      { monthIndex: 1, programadoPct: 20 },
      { monthIndex: 2, programadoPct: 30 },
      { monthIndex: 3, programadoPct: 50 },
    ]);
    // The document's own "Ejecutado" row is kept, separately, as reference —
    // it is never used to override or replace the planned series above.
    expect(candidate.schedulePlans[0].documentedExecuted).toEqual([
      { monthIndex: 1, ejecutadoPct: 15 },
      { monthIndex: 2, ejecutadoPct: 25 },
      { monthIndex: 3, ejecutadoPct: 45 },
    ]);
  });


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
        ], repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "",
          keyValues: [
            { key: "certificateNumber" as const, cell: "A1", value: 6, notes: "" },
            { key: "periodStart" as const, cell: "A2", value: "2026-01-01", notes: "" },
            { key: "periodEnd" as const, cell: "A2", value: "2026-01-31", notes: "" },
          ],
        },
        { id: "measurement", sheet: "MEDICIÓN", sourceRange: "A1:D2", target: "MEASUREMENT" as const, confidence: 1, needsReview: false, mainProject: false, headerRowStart: 1, headerRowEnd: 1, dataRowStart: 2, dataRowEnd: 2, columnMappings: [], repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "", warnings: ["La hoja pertenece a una identidad de obra distinta (Paquete 01 / 16 viviendas) y no se importa."] },
      ],
      relationships: [
        { from: "budget", to: "certificate", type: "CONTRACT_SCALE" as const, factor: 37, confidence: 1, evidence: "test fixture" },
      ],
      unresolvedRegions: [],
      warnings: [],
    };
    const candidate = buildCanonicalImportCandidate(workbook, result(importPlan));

    expect(candidate.budgetQuantitySource).toBe("CERTIFICATE_CONTRACT_QUANTITY");
    expect(candidate.budgetItems.map((item) => item.quantity)).toEqual([37, 74]);
    expect(candidate.certificate.status).toBe("SAFE_TO_APPLY");
    expect(candidate.certificate.itemCount).toBe(2);
    expect(candidate.domains).toHaveLength(0);
    expect(candidate.foreignBlocks).toHaveLength(1);
    expect(candidate.foreignBlocks[0].warnings.join(" ")).toMatch(/identidad de obra distinta/);
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
          { id: "certificate", sheet: "CERTIFICADO", sourceRange: "A19:M75", target: "CERTIFICATE" as const, confidence: 1, needsReview: false, headerRowStart: 19, headerRowEnd: 21, dataRowStart: 22, dataRowEnd: 74, columnMappings: [mapping("A", "code"), mapping("B", "description"), mapping("C", "unit"), mapping("D", "quantity"), mapping("E", "previousQuantity"), mapping("F", "currentQuantity"), mapping("G", "cumulativeQuantity"), mapping("H", "unitPrice"), mapping("M", "percentage")], repeatedHeaderRows: [], subtotalRows: [75], footerRows: [], excludedRows: [], notes: "",
            keyValues: [
              { key: "certificateNumber" as const, cell: "A6", value: 6, notes: "" },
              { key: "periodStart" as const, cell: "A9", value: "2026-07-21", notes: "" },
              { key: "periodEnd" as const, cell: "A9", value: "2026-08-20", notes: "" },
              { key: "contractAmount" as const, cell: "C13", value: 3482791500, notes: "" },
              { key: "declaredPreviousAmount" as const, cell: "I75", value: 1860462510, notes: "" },
              { key: "declaredCurrentAmount" as const, cell: "J75", value: 623788012, notes: "" },
              { key: "declaredCumulativeAmount" as const, cell: "K75", value: 2484250522, notes: "" },
            ],
          },
          { id: "measurement", sheet: "MEDICIÓN", sourceRange: "A16:E774", target: "MEASUREMENT" as const, confidence: 1, needsReview: false, mainProject: false, headerRowStart: 16, headerRowEnd: 20, dataRowStart: 21, dataRowEnd: 774, columnMappings: [], repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "",
            warnings: ["La hoja pertenece a Paquete 01 / ID 01 / SIPP 3389 (16 viviendas), distinto del proyecto principal (Paquete 05 / ID 14 / SIPP 3458, 37 viviendas)."] },
        ],
        relationships: [
          { from: "budget", to: "certificate", type: "CONTRACT_SCALE" as const, factor: 37, confidence: 1, evidence: "test fixture" },
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
      expect(candidate.certificate.number).toBe(6);
      expect(candidate.certificate.periodStart).toBe("2026-07-21");
      expect(candidate.certificate.periodEnd).toBe("2026-08-20");
      expect(candidate.certificate.cumulativePercent).toBeCloseTo(0.7133, 3);
      expect(candidate.scale?.factor).toBe(37);
      expect(candidate.checks.filter((check) => check.status === "WARNING")).toEqual([]);
      expect(candidate.domains).toHaveLength(0);
      expect(candidate.foreignBlocks).toHaveLength(1);
      expect(candidate.foreignBlocks[0].sheet).toBe("MEDICIÓN");
      expect(candidate.foreignBlocks[0].warnings.join(" ")).toMatch(/Paquete 01.*Paquete 05/);
    });
});
