import { describe, expect, it } from "vitest";
import { inspectWarehousePortalFile } from "../inventory/portal";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("warehouse portal evidence", () => {
  it("rejects a declared PDF without a PDF signature", () => {
    expect(inspectWarehousePortalFile("remito.pdf", "application/pdf", bytes("plain text"), false).ok).toBe(false);
  });
  it("accepts a signed PDF and rejects a mismatched declared type", () => {
    expect(inspectWarehousePortalFile("remito.pdf", "application/pdf", bytes("%PDF-1.4\nqa"), false).ok).toBe(true);
    expect(inspectWarehousePortalFile("remito.pdf", "image/png", bytes("%PDF-1.4\nqa"), false).ok).toBe(false);
  });
  it("rejects spreadsheets in the receipt flow and NUL bytes in CSV", () => {
    expect(inspectWarehousePortalFile("sheet.csv", "text/csv", bytes("a,b\n1,2"), false).ok).toBe(false);
    expect(inspectWarehousePortalFile("sheet.csv", "text/csv", new Uint8Array([97, 44, 0, 98]), true).ok).toBe(false);
  });
});
