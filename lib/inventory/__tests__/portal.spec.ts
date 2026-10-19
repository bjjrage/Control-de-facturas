import { describe, expect, it } from "vitest";
import { enforceWarehousePortalFileLimit, inspectWarehousePortalFile } from "../portal";

describe("warehouse portal upload limit", () => {
  it("accepts all files at or below the limit", () => {
    expect(enforceWarehousePortalFileLimit(["a", "b"], 2)).toEqual({ allowed: true, files: ["a", "b"] });
  });

  it("rejects the complete request rather than silently truncating excess evidence", () => {
    expect(enforceWarehousePortalFileLimit(["a", "b", "c"], 2)).toEqual({ allowed: false, files: [] });
  });
});

describe("D1 warehouse bucket compatibility", () => {
  it.each([false, true])("rejects GIF even with allowSheets=%s", allowSheets => {
    expect(inspectWarehousePortalFile("photo.gif", "image/gif", new TextEncoder().encode("GIF89a"), allowSheets).ok).toBe(false);
  });
  it.each([
    ["sheet.csv", "text/csv", new TextEncoder().encode("producto,cantidad\ncemento,2")],
    ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new Uint8Array([...new Uint8Array([80,75,3,4]), ...new TextEncoder().encode("xl/workbook.xml")])],
    ["sheet.xls", "application/vnd.ms-excel", new Uint8Array([208,207,17,224,161,177,26,225])],
  ] as const)("rejects unsupported submission %s before creating a record", (name, type, bytes) => {
    expect(inspectWarehousePortalFile(name, type, bytes, true).ok).toBe(false);
  });
  it("keeps PDF evidence accepted", () => {
    expect(inspectWarehousePortalFile("remito.pdf", "application/pdf", new TextEncoder().encode("%PDF-1.4"), true).ok).toBe(true);
  });
});
