import { describe, expect, it } from "vitest";
import { enforceWarehousePortalFileLimit } from "../portal";

describe("warehouse portal upload limit", () => {
  it("accepts all files at or below the limit", () => {
    expect(enforceWarehousePortalFileLimit(["a", "b"], 2)).toEqual({ allowed: true, files: ["a", "b"] });
  });

  it("rejects the complete request rather than silently truncating excess evidence", () => {
    expect(enforceWarehousePortalFileLimit(["a", "b", "c"], 2)).toEqual({ allowed: false, files: [] });
  });
});
