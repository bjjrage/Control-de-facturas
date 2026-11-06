import { expect, it } from "vitest";
import { CellValueType } from "@univerjs/core";
import { normalizeWorkspaceNumbers } from "@/lib/projects/workspace-inputs";

it("parses Spanish decimals and grouped quantities with Univer's own parser", () => {
  const cells = { 3: { 5: { v: "1,2", t: CellValueType.STRING }, 6: { v: "1.250,75", t: CellValueType.STRING }, 7: { v: "0", t: CellValueType.STRING } } };
  normalizeWorkspaceNumbers("apu", cells);
  expect(cells[3][5]).toEqual({ v: 1.2, t: CellValueType.NUMBER });
  expect(cells[3][6].v).toBe(1250.75); expect(cells[3][7].v).toBe(0);
});
it("preserves codes, explicit text, invalid inputs and formulas", () => {
  const cells = { 3: { 0: { v: "001,2" }, 5: { v: "1,2", t: CellValueType.FORCE_STRING }, 6: { v: "=1,2", f: "=SUM(1,2)" }, 7: { v: "no informado" } } };
  const before = structuredClone(cells); normalizeWorkspaceNumbers("apu", cells);
  expect(cells).toEqual(before);
});
