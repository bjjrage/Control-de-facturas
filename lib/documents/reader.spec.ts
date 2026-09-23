import { describe, expect, it } from "vitest";
import { hashExtractedContent } from "./reader";
import type { DocumentExtractionResult } from "./reader";

function result(structured: DocumentExtractionResult["structured"]): DocumentExtractionResult {
  return {
    documentId: "document-1",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extractionMethod: "xlsx_structured",
    structured,
    warnings: [],
    truncated: false,
    requiresVision: false,
  };
}

describe("hashExtractedContent", () => {
  it("includes nested workbook contents and canonicalizes object key order", () => {
    const first = result({ sheets: [{ name: "Budget", cols: ["code", "amount"], rows: [{ code: "A1", amount: 10 }] }] });
    const reordered = result({ sheets: [{ rows: [{ amount: 10, code: "A1" }], cols: ["code", "amount"], name: "Budget" }] });
    const changed = result({ sheets: [{ name: "Budget", cols: ["code", "amount"], rows: [{ code: "A1", amount: 11 }] }] });

    expect(hashExtractedContent(first)).toBe(hashExtractedContent(reordered));
    expect(hashExtractedContent(first)).not.toBe(hashExtractedContent(changed));
  });
});
