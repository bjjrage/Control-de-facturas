import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseWorkbook } from "@/lib/workbook-interpretation/parser";
import { reconcileImportPlan } from "@/lib/workbook-interpretation/import-plan";
import { extractCertificateWorkbookData, matchCertificateRows, type CertificateBudgetItem } from "@/lib/certificates/workbook-import";
import { buildCanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";

const filePath = path.join(process.env.USERPROFILE ?? "", "Downloads", "P05 - ID14 - SIPP 3458 - CERTIFICADO Nro. 6.-(2).xlsx");

describe("target certificate workbook audit", () => {
  it("audits parser, certificate extraction and matching against golden budget", () => {
    expect(fs.existsSync(filePath)).toBe(true);
    const bytes = fs.readFileSync(filePath);
    const workbook = parseWorkbook(new Uint8Array(bytes), path.basename(filePath));

    const candidates = workbook.sheets.flatMap((sheet) =>
      sheet.blocks.map((block) => ({ ...block, sheetName: sheet.sheetName, sheetIndex: sheet.sheetIndex }))
    );
    for (const c of candidates) {
      const sheet = workbook.sheets.find((s) => s.sheetName === c.sheetName);
      const sampleCells = sheet?.cells.filter((cell) => cell.row >= c.rowStart && cell.row <= Math.min(c.rowEnd, c.rowStart + 25)) ?? [];
      const text = (c.sheetName + " " + (c.title ?? "") + " " + c.candidateHeaders.join(" ") + " " + sampleCells.map((cell) => String(cell.raw ?? cell.formatted ?? "")).join(" "))
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
      let score = (/(certificado|contractual|presente|acumulado)/.test(text) ? 4 : 0)
        + (/codigo|cod|^item\b|\bitem\b/.test(text) ? 1 : 0)
        + (/descripcion|descrip|rubro|partida/.test(text) ? 1 : 0);
      if (/^certificado/i.test(c.sheetName)) score += 5; // Sheet explicitly named CERTIFICADO
      console.log(`Sheet "${c.sheetName}" Block ${c.id}: score=${score}`);
    }
    const inferred = reconcileImportPlan(workbook, {
      workbookType: "CONSTRUCTION_PROJECT",
      overallConfidence: 1,
      blocks: [],
      unresolvedRegions: [],
      warnings: [],
    }, ["CERTIFICATE"]);

    const plan = { ...inferred.plan, warnings: [...inferred.plan.warnings, ...inferred.warnings] };
    const certBlock = plan.blocks.find((b) => b.target === "CERTIFICATE");
    console.log("Inferred CERTIFICATE block:", certBlock);
    expect(certBlock).toBeDefined();

    const certificate = extractCertificateWorkbookData(workbook, plan);

    console.log("Extracted Certificate Summary:", {
      number: certificate.number,
      periodStart: certificate.periodStart,
      periodEnd: certificate.periodEnd,
      rowCount: certificate.rows.length,
      warnings: certificate.warnings,
    });
    expect(certificate.rows.length).toBe(53);

    // Extract budget items from sheet 'base'
    const baseSheet = workbook.sheets.find((s) => s.sheetName === "base")!;
    const budgetRows: CertificateBudgetItem[] = [];
    for (let r = 12; r <= 64; r++) {
      const rowCells = baseSheet.cells.filter((c) => c.row === r);
      const code = rowCells.find((c) => c.column === 1)?.raw ?? String(r - 11);
      const desc = rowCells.find((c) => c.column === 2)?.raw;
      const unit = rowCells.find((c) => c.column === 3)?.raw;
      const qty = rowCells.find((c) => c.column === 4)?.raw;
      const price = rowCells.find((c) => c.column === 5)?.raw;
      if (desc && typeof desc === "string" && !desc.toLowerCase().includes("total")) {
        budgetRows.push({
          id: `budget-item-${r}`,
          project_id: "test-project",
          code: String(code).trim(),
          description: desc.trim(),
          unit: unit ? String(unit).trim() : null,
          quantity: Number(qty) || 0,
          unit_price: Number(price) || 0,
          sort_order: budgetRows.length,
        });
      }
    }

    console.log("Extracted Budget Items from 'base':", budgetRows.length);
    expect(budgetRows.length).toBe(53);

    const matches = matchCertificateRows(certificate.rows, budgetRows, "test-project");
    const matchedCount = matches.filter((m) => m.match === "MATCHED").length;
    const reviewCount = matches.filter((m) => m.match === "NEEDS_REVIEW").length;
    console.log("Matching results:", {
      totalCertificateRows: certificate.rows.length,
      matchedCount,
      reviewCount,
    });

    expect(matchedCount).toBe(53);
    expect(reviewCount).toBe(0);
  });
});
