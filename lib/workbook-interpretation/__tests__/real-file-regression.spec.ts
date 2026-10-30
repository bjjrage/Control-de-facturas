import fs from "node:fs";
import { createHash } from "node:crypto";
import { it, expect } from "vitest";
import { parseWorkbook } from "../parser";
import { buildCanonicalImportCandidate } from "../canonical-import";

const source = process.env.WORKBOOK_REGRESSION_PATH;
const mapping = process.env.WORKBOOK_REGRESSION_MAPPING_PATH;
it.skipIf(!source || !mapping)("preserves Lote 2 values and relationships after conversion changes", () => {
  const bytes = fs.readFileSync(source!);
  const digest = (input: Buffer) => createHash("sha256").update(input).digest("hex");
  const original = digest(bytes);
  const candidate = buildCanonicalImportCandidate(parseWorkbook(bytes, source!), JSON.parse(fs.readFileSync(mapping!, "utf8")));
  expect(candidate.budgetItems).toHaveLength(597);
  const linked = candidate.linkedRecipes;
  if (!linked) throw new Error("Missing linked recipes");
  expect(linked.recipes).toHaveLength(597);
  expect(linked.relativeSchedule).toHaveLength(597);
  expect(linked.issues).toEqual([]);
  expect(candidate.budgetTotal).toBe(738462025);
  expect(digest(fs.readFileSync(source!))).toBe(original);
}, 60000);
