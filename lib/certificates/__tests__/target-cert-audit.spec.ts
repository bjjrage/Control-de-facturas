import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseWorkbook } from "@/lib/workbook-interpretation/parser";
import { reconcileImportPlan } from "@/lib/workbook-interpretation/import-plan";
import { extractCertificateWorkbookData, matchCertificateRows, type CertificateBudgetItem } from "@/lib/certificates/workbook-import";

describe("certificate workbook import audit", () => {
  it("parses, infers, extracts and matches all 53 certificate rows reproducibly", () => {
    const baseRows: Array<Array<string | number>> = [
      ["COD", "RUBRO", "UND", "CANT", "P.U."],
    ];
    const certificateRows: Array<Array<string | number | null>> = [
      ["CERTIFICADO Nro. 6 - Auditoria reproducible", null, null, null, null, null, null, null],
      ["Periodo: desde 01/01/2026 hasta 31/01/2026", null, null, null, null, null, null, null],
      ["COD", "RUBRO", "UND", "CONTRACTUAL", "ANTERIOR", "PRESENTE", "ACUMULADO", "P.U."],
    ];
    for (let index = 1; index <= 53; index++) {
      const code = String(index);
      const description = `Rubro de prueba ${index}`;
      const unit = index % 2 === 0 ? "m2" : "gl";
      const quantity = index * 2;
      const previous = index;
      const current = index;
      const price = index * 100;
      baseRows.push([code, description, unit, quantity, price]);
      certificateRows.push([code, description, unit, quantity, previous, current, previous + current, price]);
    }

    const bytes = XLSX.write({
      SheetNames: ["base", "CERTIFICADO"],
      Sheets: {
        base: XLSX.utils.aoa_to_sheet(baseRows),
        CERTIFICADO: XLSX.utils.aoa_to_sheet(certificateRows),
      },
    }, { type: "buffer", bookType: "xlsx" });
    const workbook = parseWorkbook(new Uint8Array(bytes), "certificate-audit-fixture.xlsx");
    const inferred = reconcileImportPlan(workbook, {
      workbookType: "CONSTRUCTION_PROJECT",
      overallConfidence: 1,
      blocks: [],
      unresolvedRegions: [],
      warnings: [],
    }, ["CERTIFICATE"]);
    const plan = { ...inferred.plan, warnings: [...inferred.plan.warnings, ...inferred.warnings] };
    expect(plan.blocks.filter((block) => block.target === "CERTIFICATE")).toHaveLength(1);

    const certificate = extractCertificateWorkbookData(workbook, plan);
    expect(certificate.number).toBe(6);
    expect(certificate.periodStart).toBe("2026-01-01");
    expect(certificate.periodEnd).toBe("2026-01-31");
    expect(certificate.rows).toHaveLength(53);

    const budgetItems: CertificateBudgetItem[] = baseRows.slice(1).map((row, index) => ({
      id: `budget-item-${index + 1}`,
      project_id: "test-project",
      code: String(row[0]),
      description: String(row[1]),
      unit: String(row[2]),
      quantity: Number(row[3]),
      unit_price: Number(row[4]),
      sort_order: index,
    }));
    const matches = matchCertificateRows(certificate.rows, budgetItems, "test-project");
    expect(matches).toHaveLength(53);
    expect(matches.filter((row) => row.match === "MATCHED")).toHaveLength(53);
    expect(matches.filter((row) => row.match === "NEEDS_REVIEW")).toHaveLength(0);
    expect(new Set(matches.map((row) => row.budgetItemId)).size).toBe(53);
  });
});
