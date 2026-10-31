import * as XLSX from "xlsx";
import type { CanonicalImportCandidate } from "./canonical-import";
import type { ImportIssue } from "./import-integrity";
import { isBudgetShapedBlock, rawNumber, type ImportPlanCheck } from "./import-plan";
import type { ImportBlock, WorkbookInterpretationResult, WorkbookRepresentation } from "./types";

const numericRoles = new Set(["quantity", "unitPrice", "subtotal", "previousQuantity", "currentQuantity", "cumulativeQuantity", "previousAmount", "currentAmount", "cumulativeAmount", "percentage"]);
function domainFor(block: ImportBlock): ImportIssue["domain"] {
  if (isBudgetShapedBlock(block)) return "BUDGET";
  if (block.target === "NON_WORKING_DAYS") return "WEATHER";
  if (["CERTIFICATE", "STAFF", "EXECUTION", "SCHEDULE"].includes(block.target)) return block.target as ImportIssue["domain"];
  return "COVERAGE";
}
const sourceOf = (item: { source: { sheet: string; row?: number; range?: string } }) => `${item.source.sheet}!${item.source.row ? `fila ${item.source.row}` : item.source.range ?? ""}`;

/** This gate validates the proposed operational payload before any write.
 * It does not trust a confidence score or the mere existence of source cells. */
export function inspectOperationalIntegrity(workbook: WorkbookRepresentation, result: WorkbookInterpretationResult, candidate: CanonicalImportCandidate, checked: ImportPlanCheck): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const add = (domain: ImportIssue["domain"], severity: ImportIssue["severity"], source: string, message: string) => issues.push({ domain, severity, source, message });
  const blocks = checked.plan.blocks.filter(b => b.mainProject !== false);
  const blockIds = new Set<string>();
  for (const block of blocks) {
    const domain = domainFor(block), source = `${block.sheet}!${block.sourceRange}`;
    if (blockIds.has(block.id)) add(domain, "ERROR", source, "Dos bloques tienen el mismo identificador; sus vínculos son ambiguos.");
    blockIds.add(block.id);
    if (block.needsReview && domain !== "COVERAGE") add(domain, "REVIEW", source, "El mapeo de este bloque requiere revisión antes de aplicar sus datos.");
    // Curves and calendars have their own matrix mappings. Repeated value
    // columns are expected there; the flat-table contract must not apply.
    if (["COVERAGE", "SCHEDULE", "WEATHER"].includes(domain)) continue;
    const range = XLSX.utils.decode_range(block.sourceRange);
    const mappedRoles = new Set<string>();
    for (const mapping of block.columnMappings.filter(m => m.role !== "ignore")) {
      if (mappedRoles.has(mapping.role)) add(domain, "ERROR", source, `Hay varias columnas para «${mapping.role}». Debe elegirse una; no se usa automáticamente la primera.`);
      mappedRoles.add(mapping.role);
      const column = mapping.column.replace(/\$/g, "").toUpperCase();
      if (!/^[A-Z]{1,3}\d*$/.test(column)) {
        add(domain, "ERROR", source, `«${mapping.column}» no identifica una sola columna para «${mapping.role}».`);
        continue;
      }
      const col = XLSX.utils.decode_col(column.replace(/\d/g, ""));
      if (col < range.s.c || col > range.e.c) add(domain, "ERROR", source, `La columna «${mapping.column}» queda fuera del rango de origen.`);
    }
    // Numeric errors and absent formula results must not turn into zero,
    // even in optional quantity columns or on an otherwise readable row.
    if (!["BUDGET", "CERTIFICATE", "EXECUTION"].includes(domain)) continue;
    const sheet = workbook.sheets.find(s => s.sheetName === block.sheet)!;
    const excluded = new Set([...block.repeatedHeaderRows, ...block.subtotalRows, ...block.footerRows, ...block.excludedRows.map(e => e.row)]);
    const columns = new Map(block.columnMappings.filter(m => numericRoles.has(m.role) && /^[A-Z]{1,3}\d*$/i.test(m.column.replace(/\$/g, ""))).map(m => [XLSX.utils.decode_col(m.column.replace(/[\d$]/g, "")), m.role]));
    const invalid: string[] = [];
    for (const cell of sheet.cells) {
      const role = columns.get(cell.column - 1);
      if (!role || cell.row < block.dataRowStart || cell.row > block.dataRowEnd || excluded.has(cell.row)) continue;
      const nonempty = cell.raw !== null && String(cell.raw).trim() !== "";
      if (cell.type === "e" || cell.type === "b" || cell.type === "d"
        || (cell.formula && !nonempty)
        || (nonempty && rawNumber(cell.raw) === null)
        || (nonempty && role !== "percentage" && (String(cell.raw).includes("%") || (cell.numberFormat && (XLSX.SSF.is_date(cell.numberFormat) || /%/.test(cell.numberFormat.replace(/"[^"]*"|\\./g, ""))))))) invalid.push(cell.address);
    }
    if (invalid.length) add(domain, "ERROR", source, `${invalid.length} celda(s) numérica(s) no utilizables: ${invalid.slice(0, 12).join(", ")}. Revisá errores, fechas, porcentajes o fórmulas sin resultado; no se reemplazan por cero.`);
  }
  for (const item of candidate.budgetItems) {
    const source = sourceOf(item);
    if (!item.code || !item.description.trim()) add("BUDGET", "ERROR", source, "La partida necesita código y descripción.");
    const parent = item.code && candidate.budgetItems.some(other => other.code?.startsWith(`${item.code}.`));
    if (!parent && (!item.unit || item.quantity === null || item.unitPrice === null)) add("BUDGET", "ERROR", source, "La partida ejecutable necesita unidad, cantidad y precio numéricos; un dato faltante no equivale a cero.");
    if ([item.quantity, item.unitPrice].some(v => v !== null && (!Number.isFinite(v) || v < 0))) add("BUDGET", "ERROR", source, "La cantidad y el precio deben ser números finitos no negativos.");
    if ((item.quantity !== null && Math.abs(item.quantity - Number(item.quantity.toFixed(4))) > 1e-8) || (item.unitPrice !== null && Math.abs(item.unitPrice - Number(item.unitPrice.toFixed(2))) > 1e-8)) add("BUDGET", "ERROR", source, "La precisión excede lo que guarda el ERP (cantidad: 4 decimales; precio: 2). Revisá el valor; no se redondea silenciosamente.");
  }
  const codes = new Set<string>();
  for (const item of candidate.budgetItems) if (item.code) {
    if (codes.has(item.code)) add("BUDGET", "ERROR", sourceOf(item), `El código «${item.code}» aparece más de una vez en el presupuesto.`);
    codes.add(item.code);
  }
  for (const check of candidate.checks.filter(c => c.status === "WARNING")) {
    if (check.id.startsWith("budget_") || check.id.startsWith("scale_")) add("BUDGET", "ERROR", blocks.filter(isBudgetShapedBlock).map(b => `${b.sheet}!${b.sourceRange}`).join(", "), `${check.label}: ${check.detail}`);
    if (check.id.startsWith("certificate_") && check.id !== "certificate_budget_match") add("CERTIFICATE", "ERROR", blocks.filter(b => b.target === "CERTIFICATE").map(b => `${b.sheet}!${b.sourceRange}`).join(", "), `${check.label}: ${check.detail}`);
  }
  for (const item of candidate.certificate.items) {
    if (item.matchQuality !== "EXACT" && candidate.budgetItems.length) add("CERTIFICATE", "REVIEW", sourceOf(item), item.matchedBudgetCode ? `El vínculo a la partida ${item.matchedBudgetCode} tiene diferencias de texto o unidad; requiere aceptación expresa.` : "Esta línea del certificado se creará sin vínculo a una partida; requiere aceptación expresa.");
    if ([item.quantityContractual, item.quantityPrevious, item.quantityCurrent, item.quantityCumulative, item.unitPrice].some(v => !Number.isFinite(v) || v < 0)) add("CERTIFICATE", "ERROR", sourceOf(item), "El certificado contiene cantidades o precios negativos o no finitos.");
    if ([item.quantityContractual, item.quantityPrevious, item.quantityCurrent].some(v => Math.abs(v - Number(v.toFixed(4))) > 1e-8) || Math.abs(item.unitPrice - Number(item.unitPrice.toFixed(2))) > 1e-8) add("CERTIFICATE", "ERROR", sourceOf(item), "La precisión del certificado excede lo que guarda el ERP (cantidades: 4 decimales; precio: 2). No se redondea silenciosamente.");
  }
  for (const entry of candidate.executionEntries) {
    if (!entry.matchedBudgetCode || !codes.has(entry.matchedBudgetCode)) add("EXECUTION", "ERROR", sourceOf(entry), "El avance no tiene una partida válida de destino. No se importa un subconjunto silenciosamente.");
    if (!Number.isFinite(entry.quantityExecuted) || entry.quantityExecuted < 0) add("EXECUTION", "ERROR", sourceOf(entry), "La cantidad de avance no es un número válido.");
    if (Math.abs(entry.quantityExecuted - Number(entry.quantityExecuted.toFixed(4))) > 1e-8) add("EXECUTION", "ERROR", sourceOf(entry), "El avance tiene más de 4 decimales; requiere revisión antes de guardarlo.");
  }
  for (const person of candidate.staff) if (!person.name.trim() || !person.role.trim()) add("STAFF", "ERROR", `${person.sheet}!fila ${person.row}`, "El personal necesita nombre y función verificables.");
  for (const coverage of checked.coverage) {
    const block = blocks.find(b => b.id === coverage.blockId);
    if (!block) continue;
    if (coverage.unmappedRows.length) add("COVERAGE", "REVIEW", `${block.sheet}!${block.sourceRange}`, `Hay filas adyacentes fuera del mapeo de esta tabla: ${coverage.unmappedRows.slice(0, 12).join(", ")}. Revisá si contienen datos operativos pendientes.`);
    if (coverage.pendingRows.length && isBudgetShapedBlock(block)) add("BUDGET", "ERROR", `${block.sheet}!${block.sourceRange}`, `${coverage.pendingRows.length} fila(s) del presupuesto quedaron sin extraer; revisá el mapeo.`);
  }
  const foreignOnlySheets = new Set(checked.plan.blocks.filter(b => b.mainProject === false && !blocks.some(main => main.sheet === b.sheet)).map(b => b.sheet));
  for (const region of [...checked.plan.unresolvedRegions, ...result.unknownSections]) {
    if (foreignOnlySheets.has(region.sheet)) continue;
    if (region.reason.startsWith("UNMAPPED_REGION") && checked.coverage.some(c => c.sheet === region.sheet && c.sourceRange === region.range && c.unmappedRows.length)) continue;
    add("COVERAGE", "REVIEW", `${region.sheet}!${region.range}`, `Información sin resolver que no se incorporará: ${region.reason}`);
  }
  for (const domain of candidate.domains) if (domain.target !== "PROJECT_METADATA") add("COVERAGE", "REVIEW", domain.sheets.join(", "), `${domain.labels.join(" · ")}: detectado como ${domain.target}, pero su importación no está conectada. Se conserva en el archivo original y queda fuera de los datos operativos.`);
  return [...new Map(issues.map(i => [`${i.domain}|${i.source}|${i.message}`, i])).values()];
}
