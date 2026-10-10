import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Contract = { file: string; opening: string; children: string };
const before: Contract[] = JSON.parse(readFileSync("audit-artifacts/ui-recovery-01/correction-3/select-contracts-before.json", "utf8"));
function controls(file: string) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result: Contract[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "Select") result.push({ file, opening: node.openingElement.getText(source), children: node.children.map(child => child.getText(source)).join("") });
    ts.forEachChild(node, visit);
  }
  visit(source); return result;
}

describe("global operational Select migration contracts", () => {
  it("covers all 51 audited controls", () => { expect(before).toHaveLength(51); });
  it.each([...new Set(before.map(control => control.file))])("preserves every authored prop, enum, option, handler and default in %s", file => {
    const normalizeNewlines = (value: string) => value.replace(/\r\n?/g, "\n");
    const expected = before.filter(control => control.file === file).map(control => ({
      ...control,
      opening: normalizeNewlines(control.opening.replace(/^<select\b/, "<Select").replace("(e.target as HTMLSelectElement).value", "e.target.value")),
      children: normalizeNewlines(control.children),
    }));
    const actual = controls(file).map(control => ({
      ...control,
      opening: normalizeNewlines(control.opening),
      children: normalizeNewlines(control.children),
    }));
    expect(actual).toEqual(expected);
    expect(readFileSync(file, "utf8")).toMatch(/import\s*\{\s*Select\s*\}\s*from\s*["']@\/components\/ui\/select["']/);
  });
  it("contains zero operational native JSX dropdowns across app and components", () => {
    const native: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.[jt]sx$/.test(file) && !/\.(test|spec)\./.test(file)) {
          const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
          function visit(node: ts.Node) {
            if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "select") native.push(file);
            ts.forEachChild(node, visit);
          }
          visit(source);
        }
      }
    }
    walk("app"); walk("components"); expect(native).toEqual([]);
  });
});
