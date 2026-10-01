import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCanonicalImportCandidate } from "../canonical-import";
import { interpretWorkbook } from "../interpreter";
import { parseWorkbook } from "../parser";

const goldenPath = path.join(process.env.USERPROFILE ?? "", "Downloads", "P05 - ID14 - SIPP 3458 - CERTIFICADO Nro. 6.-(2).xlsx");

describe("golden workbook semantic importer", () => {
  it.skipIf(!fs.existsSync(goldenPath) || !process.env.OPENAI_API_KEY)("runs the real 15-sheet workbook through parser, ImportPlan, validation and preview result", async () => {
    const workbook = parseWorkbook(fs.readFileSync(goldenPath), goldenPath);
    const result = await interpretWorkbook(workbook);
    const candidate = buildCanonicalImportCandidate(workbook, result);
    const report = workbook.sheets.map((sheet) => {
      const coverage = result.coverage.filter((item) => item.sheet === sheet.sheetName);
      return {
        sheet: sheet.sheetName,
        regions_found: sheet.blocks.length,
        blocks_mapped: coverage.length,
        targets: result.importPlan.blocks.filter((block) => block.sheet === sheet.sheetName).map((block) => block.target),
        source_rows: coverage.reduce((sum, item) => sum + item.sourceRows, 0),
        processed: coverage.reduce((sum, item) => sum + item.processedRows, 0),
        excluded: coverage.reduce((sum, item) => sum + item.excludedRows.length, 0),
        pending_review: coverage.reduce((sum, item) => sum + item.pendingRows.length, 0),
        unmapped_regions: coverage.reduce((sum, item) => sum + item.unmappedRows.length, 0),
        warnings: coverage.flatMap((item) => item.warnings),
      };
    });
    console.log(JSON.stringify({ file: path.basename(goldenPath), sheets: workbook.sheets.length, total_cells: workbook.totalCells, budget_items: result.budgetItems.length, report }, null, 2));
    expect(workbook.sheets).toHaveLength(15);
    expect(workbook.totalCells).toBe(7456);
    expect(result.importPlan.blocks.length).toBeGreaterThan(0);
    expect(result.coverage.length).toBe(result.importPlan.blocks.length);
    expect(result.budgetItems).toHaveLength(53);
    expect(candidate.budgetItems).toHaveLength(53);
    expect(candidate.budgetTotal).toBe(3482791500);
    // The real model's exact wording/classification varies run to run;
    // both a clean pass and one with a noted documentary inconsistency are
    // correct outcomes here — only an outright failure to link is not.
    expect(["SAFE_TO_APPLY", "APPLY_WITH_WARNINGS"]).toContain(candidate.certificate.status);
    expect(candidate.certificate.itemCount).toBe(53);
    expect(candidate.certificate.matchedBudgetItems).toBe(53);
    expect(candidate.scale?.factor).toBe(37);
    // MEDICIÓN belongs to a different package (16 viviendas) and must never
    // be silently folded into the main project.
    expect(candidate.foreignBlocks.some((block) => block.sheet === "MEDICIÓN")).toBe(true);
  }, 180_000);
});
