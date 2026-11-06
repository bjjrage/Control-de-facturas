/* Univer 1.0.2 marks `new Set(...).forEach(...)` as PURE in its ESM build.
 * Turbopack production optimization consequently removes the reference-update
 * loops. Remove only those two incorrect annotations; keep Univer's algorithm.
 * Fail on an SDK change so the compatibility patch is reviewed when upgrading.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../node_modules/@univerjs/sheets-formula", import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
if (version !== "1.0.2") throw new Error(`Review the Univer reference compatibility patch for version ${version}.`);
const file = path.join(root, "lib/es/index.js");
let source = fs.readFileSync(file, "utf8");
const expressions = [
  "new Set([...Object.keys(oldFormulaData), ...Object.keys(newFormulaData)])",
  "new Set([...Object.keys(oldFormulaData[unitId] || {}), ...Object.keys(newFormulaData[unitId] || {})])",
];
for (const expression of expressions) {
  const broken = `(/* @__PURE__ */ ${expression}).forEach`;
  const fixed = `(${expression}).forEach`;
  if (source.includes(broken)) source = source.replace(broken, fixed);
  else if (!source.includes(fixed)) throw new Error("Univer reference-update source changed; review the compatibility patch.");
}
fs.writeFileSync(file, source, "utf8");
console.log("Univer: preserved native formula-reference loops for production builds.");
