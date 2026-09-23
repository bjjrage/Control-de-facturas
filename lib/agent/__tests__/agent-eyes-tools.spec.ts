import { describe, expect, it } from "vitest";
import { toolRegistry } from "../registry";
import "@/lib/tools";

describe("Agent Eyes registration through the production tools barrel", () => {
  it("loads all document and spreadsheet tools with the Planillas role boundary", () => {
    const expected = [
      ["get_spreadsheet_snapshot", 0],
      ["read_spreadsheet_range", 0],
      ["update_spreadsheet_rows", 1],
      ["confirm_spreadsheet", 2],
      ["get_document_content", 0],
      ["extract_document_data", 0],
    ] as const;

    for (const [name, riskLevel] of expected) {
      const tool = toolRegistry.get(name);
      expect(tool, `${name} is registered`).toBeDefined();
      expect(tool?.riskLevel).toBe(riskLevel);
    }

    for (const name of [
      "get_spreadsheet_snapshot",
      "read_spreadsheet_range",
      "update_spreadsheet_rows",
      "confirm_spreadsheet",
    ]) {
      expect(toolRegistry.get(name)?.requiredRoles).toEqual(["administracion", "admin"]);
    }
  });
});
