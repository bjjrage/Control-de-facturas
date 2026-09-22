import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { interpretWorkbook } from "../interpreter";
import { parseWorkbook } from "../parser";

const goldenPath = path.join(process.env.USERPROFILE ?? "", "Downloads", "P05 - ID14 - SIPP 3458 - CERTIFICADO Nro. 6.-(2).xlsx");

describe("golden workbook semantic importer", () => {
  it.skipIf(!fs.existsSync(goldenPath) || !process.env.OPENAI_API_KEY)("runs the real 15-sheet workbook through parser, ImportPlan, validation and preview result", async () => {
    const workbook = parseWorkbook(fs.readFileSync(goldenPath), goldenPath);
    const result = await interpretWorkbook(workbook);
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
    expect(result.importPlan.blocks.length).toBeGreaterThan(0);
    expect(result.coverage.length).toBe(result.importPlan.blocks.length);
  }, 180_000);
});
