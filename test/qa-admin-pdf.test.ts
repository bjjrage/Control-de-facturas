import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "../lib/documents/reader";
import config from "../next.config";

describe("QA ADMIN real quote PDFs", () => {
  it("preserves the native Node entry needed by PDF.js in the deployed build", () => {
    expect(config.serverExternalPackages).toContain("pdf-parse");
    for (const route of ["/rfqs/*", "/api/agent/chat"]) {
      const files = config.outputFileTracingIncludes?.[route];
      expect(files).toContain("./node_modules/pdf-parse/dist/pdf-parse/**");
      expect(files).toContain("./node_modules/pdfjs-dist/legacy/build/*.mjs");
      expect(files).toContain("./node_modules/@napi-rs/canvas-*/**");
    }
  });

  it.each([
    ["COT-QA-001_Cementos.pdf", "68.000", "1.550"],
    ["COT-QA-002_Ferreteria.pdf", "72.000", "1.400"],
  ])("extracts original %s without a mock parser", async (file, cement, bricks) => {
    const bytes = readFileSync(resolve("test/fixtures/qa-admin", file));
    const result = await extractPdfText(bytes, 50000);
    expect(result.requiresVision).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain(cement);
    expect(result.text).toContain(bricks);
    expect(result.text).toContain("QA");
  });

  it("retains the extraction limit", async () => {
    const result = await extractPdfText(readFileSync(resolve("test/fixtures/qa-admin/COT-QA-001_Cementos.pdf")), 20);
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(20);
  });
});
