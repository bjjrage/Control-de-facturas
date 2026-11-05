import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import catalog from "../docs/imports/contratos-v1.json";
import { parseWorkbook } from "@/lib/workbook-interpretation/parser";
import { reconcileImportPlan } from "@/lib/workbook-interpretation/import-plan";
import { extractCertificateWorkbookData } from "@/lib/certificates/workbook-import";
import { interpretScheduleSheet, buildScheduleUpdates, resolveSchedulePredecessors } from "@/lib/schedule/schedule-import";
import { resolveApuMaterialImportMapping, resolveApuLaborImportMapping, resolveApuEquipmentImportMapping, resolveApuSubcontractImportMapping } from "@/lib/procurement/apu-import";
import { sourceFunctions } from "./support/source-functions";

function read(id: string) {
  return XLSX.read(readFileSync(`docs/imports/plantillas/${id}.xlsx`), { type: "buffer" });
}

describe("published input templates use the existing ERP contracts", () => {
  it("maps every budget template header through the current budget importer", () => {
    const { autoDetectMapping } = sourceFunctions("app/(internal)/projects/[id]/import-budget-dialog.tsx", ["HEADER_VARIANTS", "normalize", "autoDetectMapping"]);
    const definition = catalog.templates.find(template => template.id === "01-presupuesto")!;
    expect(autoDetectMapping(definition.fields.map(field => field.header))).toEqual({ 0: "code", 1: "description", 2: "unit", 3: "quantity", 4: "unit_price", 5: "start_date", 6: "end_date" });
  });
  it("ships blank data tables with no formulas or accidental sample records", () => {
    for (const definition of catalog.templates) {
      const book = read(definition.id);
      expect(book.SheetNames[0]).toBe("Datos");
      const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Datos, { header: 1, raw: true, blankrows: false });
      expect(rows.at(-1)).toEqual(definition.fields.map(field => field.header));
      for (const cell of Object.values(book.Sheets.Datos)) {
        if (cell && typeof cell === "object") expect(cell.f).toBeUndefined();
      }
    }
  });
  it("extracts a filled historical template with contractual, previous and current quantities kept separate", () => {
    const book = read("03-certificado-historico");
    XLSX.utils.sheet_add_aoa(book.Sheets.Datos, [["Certificado N° 1"], ["Período: 01/11/2026 al 30/11/2026"]], { origin: "A1" });
    XLSX.utils.sheet_add_aoa(book.Sheets.Datos, [["001", "Hormigón", "m3", 100, 0, 12.5, 2000]], { origin: "A5" });
    const parsed = parseWorkbook(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "certificado.xlsx");
    const inferred = reconcileImportPlan(parsed, { workbookType: "CONSTRUCTION_PROJECT", overallConfidence: 1, blocks: [], unresolvedRegions: [], warnings: [] }, ["CERTIFICATE"]);
    const result = extractCertificateWorkbookData(parsed, inferred.plan);
    expect(result).toMatchObject({ number: 1, periodStart: "2026-11-01", periodEnd: "2026-11-30" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ code: "001", quantityContractual: 100, quantityPrevious: 0, quantityCurrent: 12.5, quantityCumulative: 12.5, unitPrice: 2000 });
  });
  it("uses exact part and product identities and preserves fractional APU inputs", () => {
    const items = [{ id: "part-1", code: "001", unit: "m3" }];
    const materials = resolveApuMaterialImportMapping([{ itemCode: "001", productSku: "MAT-001", quantityPerUnit: 1.7424, desperdicioPct: 3 }], items, [{ id: "material-1", sku: "MAT-001" }]);
    expect(materials.errors).toEqual([]);
    expect(materials.mapped[0]).toMatchObject({ budgetItemId: "part-1", productoId: "material-1", cantidadPorUnidad: 1.7424, desperdicioPct: 3 });
    expect(resolveApuMaterialImportMapping([{ itemCode: "001", productSku: "MISSING", quantityPerUnit: 1 }], items, []).errors).toHaveLength(1);
    expect(resolveApuLaborImportMapping([{ itemCode: "001", rol: "Oficial", horasPorUnidad: 0.75, costoHora: 12000 }], items).mapped[0]).toMatchObject({ horasPorUnidad: 0.75, costoHora: 12000 });
    expect(resolveApuEquipmentImportMapping([{ itemCode: "001", tipoEquipo: "Mezcladora", horasPorUnidad: 0.25, costoHora: 40000 }], items).mapped[0]).toMatchObject({ horasPorUnidad: 0.25, costoHora: 40000 });
    expect(resolveApuSubcontractImportMapping([{ itemCode: "001", descripcion: "Transporte", precioPorUnidad: 900 }], items).mapped[0]).toMatchObject({ precioPorUnidad: 900 });
  });
  it("imports only explicit schedule dates and an existing predecessor", () => {
    const book = read("08-cronograma");
    XLSX.utils.sheet_add_aoa(book.Sheets.Datos, [["001", "Preparación", "2026-11-01", "2026-11-03", ""], ["002", "Hormigón", "2026-11-04", "2026-11-06", "001"]], { origin: "A2" });
    const items = [{ id: "part-1", code: "001", description: "Preparación" }, { id: "part-2", code: "002", description: "Hormigón" }];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Datos, { header: 1, raw: true, defval: "" });
    const parsed = interpretScheduleSheet(rows, items);
    const updates = buildScheduleUpdates(parsed.rows, resolveSchedulePredecessors(parsed.rows, items));
    expect(updates).toEqual([{ itemId: "part-1", start_date: "2026-11-01", end_date: "2026-11-03", depends_on: null }, { itemId: "part-2", start_date: "2026-11-04", end_date: "2026-11-06", depends_on: "part-1" }]);
  });
});
