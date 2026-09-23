import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clearInterpretationCache, interpretWorkbook } from "../interpreter";
import { parseWorkbook } from "../parser";
import { buildCanonicalImportCandidate } from "../canonical-import";

const goldenPath = path.join(process.env.USERPROFILE ?? "", "Downloads", "P05 - ID14 - SIPP 3458 - CERTIFICADO Nro. 6.-(2).xlsx");

describe("golden workbook semantic importer", () => {
  it.skipIf(!fs.existsSync(goldenPath) || !process.env.OPENAI_API_KEY)("runs the real 15-sheet workbook through parser, ImportPlan, validation and preview result", async () => {
    const workbook = parseWorkbook(fs.readFileSync(goldenPath), goldenPath);
    expect(workbook.sheets).toHaveLength(15);
    expect(workbook.totalCells).toBe(7456);

    for (let attempt = 1; attempt <= 2; attempt++) {
      clearInterpretationCache();
      const result = await interpretWorkbook(workbook);
      const candidate = buildCanonicalImportCandidate(workbook, result);
      const baseBudgetBlock = result.importPlan.blocks.find((block) => block.sheet === "base" && block.target === "BUDGET");
      const baseBudgetRows = result.budgetItems.filter((item) => item.source.sheet === "base").map((item) => ({ row: item.source.row, code: item.code, description: item.description }));
      console.log(JSON.stringify({
        file: path.basename(goldenPath),
        attempt,
        openai_plan: { blocks: result.importPlan.blocks.length, targets: result.importPlan.blocks.map((block) => `${block.sheet}:${block.target}`) },
        base_budget_block: baseBudgetBlock ? { sourceRange: baseBudgetBlock.sourceRange, dataRows: [baseBudgetBlock.dataRowStart, baseBudgetBlock.dataRowEnd] } : null,
        base_budget_rows: baseBudgetRows,
        canonical: { budget: candidate.budgetItems.length, certificate: candidate.certificate.status, certificateItems: candidate.certificate.itemCount, matched: candidate.certificate.matchedBudgetItems, budgetTotal: candidate.budgetTotal, measurement: candidate.measurement.status },
      }, null, 2));
      expect(result.importPlan.blocks.length).toBeGreaterThan(0);
      expect(candidate.budgetItems).toHaveLength(53);
      expect(candidate.certificate.status).toBe("SAFE_TO_APPLY");
      expect(candidate.certificate.itemCount).toBe(53);
      expect(candidate.certificate.matchedBudgetItems).toBe(53);
      expect(candidate.budgetTotal).toBe(3482791500);
      expect(candidate.measurement.status).toBe("DETECTED_NOT_APPLIED");
    }
  }, 180_000);
});
