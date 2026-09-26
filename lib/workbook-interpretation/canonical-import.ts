import * as XLSX from "xlsx";
import { extractBudgetItems, rawNumber, validateImportPlan, type ImportPlanCheck } from "./import-plan";
import type {
  DetectedField,
  ImportBlock,
  ImportKeyValueKey,
  ImportPlan,
  ImportRelationship,
  ImportScale,
  WorkbookBudgetItem,
  WorkbookInterpretationResult,
  WorkbookRepresentation,
} from "./types";

// The model decided what every block means. This module only:
//   1. copies cell values from the columns/rows the model mapped,
//   2. verifies the scalars it pointed at really are in those cells,
//   3. runs arithmetic checks.
// Semantic doubts become warnings for the human preview, never silent drops.

export type CertificateMatchQuality = "EXACT" | "APPROXIMATE" | "UNMATCHED" | "NO_BUDGET";

export type CanonicalCertificateItem = {
  code: string | null;
  description: string;
  unit: string | null;
  quantityContractual: number;
  quantityPrevious: number;
  quantityCurrent: number;
  quantityCumulative: number;
  unitPrice: number;
  amountPrevious: number | null;
  amountCurrent: number | null;
  amountCumulative: number | null;
  percentage: number | null;
  matchedBudgetCode: string | null;
  matchedBudgetRow: number | null;
  matchQuality: CertificateMatchQuality;
  matchNote: string | null;
  source: { sheet: string; row: number; range: string };
};

export type CanonicalCertificateAudit = {
  // DETECTED_NOT_APPLIED is reserved for technical impossibility (no
  // readable lines, or no verifiable number/period, which the database
  // requires). Semantic doubts give APPLY_WITH_WARNINGS.
  status: "NOT_DETECTED" | "SAFE_TO_APPLY" | "APPLY_WITH_WARNINGS" | "DETECTED_NOT_APPLIED";
  itemCount: number;
  matchedBudgetItems: number;
  number: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  contractTotal: number | null;
  previousTotal: number | null;
  currentTotal: number | null;
  cumulativeTotal: number | null;
  cumulativePercent: number | null;
  scaleUnits: number | null;
  reason: string;
  issues: string[];
  items: CanonicalCertificateItem[];
};

export type CanonicalCheck = { id: string; label: string; status: "OK" | "WARNING"; detail: string };

export type CanonicalScaleAudit = {
  fromBlock: string;
  toBlock: string;
  factor: number;
  comparedLines: number;
  consistentLines: number;
  evidence: string;
};

export type CanonicalDomainSummary = {
  target: string;
  labels: string[];
  sheets: string[];
  rows: number;
  warnings: string[];
  persistence: "NOT_CONNECTED";
};

export type CanonicalRelationship = ImportRelationship & { fromLabel: string; toLabel: string };

export type CanonicalImportCandidate = {
  budgetItems: WorkbookBudgetItem[];
  budgetQuantitySource: "BUDGET" | "CERTIFICATE_CONTRACT_QUANTITY";
  budgetTotal: number;
  budgetScale: ImportScale | null;
  relationships: CanonicalRelationship[];
  scale: CanonicalScaleAudit | null;
  certificate: CanonicalCertificateAudit;
  domains: CanonicalDomainSummary[];
  foreignBlocks: CanonicalForeignBlock[];
  checks: CanonicalCheck[];
  warnings: string[];
};

type Sheet = WorkbookRepresentation["sheets"][number];
type VerifiedValue = { value: number | string; cell: string; verified: boolean; cellText: string };

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fieldText(field: DetectedField): string | null {
  if (field.status === "NOT_FOUND" || field.value === null) return null;
  const value = String(field.value).trim();
  return value || null;
}

function columnName(column: string): string {
  return column.replace(/[0-9$]/g, "").toUpperCase();
}

function cellIndex(sheet: Sheet) {
  return new Map(sheet.cells.map((cell) => [cell.address, cell]));
}

function mappingColumn(block: ImportBlock, role: string): string | null {
  const column = block.columnMappings.find((mapping) => mapping.role === role)?.column;
  return column ? columnName(column) : null;
}

function excludedRows(block: ImportBlock): Set<number> {
  return new Set([
    ...block.repeatedHeaderRows,
    ...block.subtotalRows,
    ...block.footerRows,
    ...block.excludedRows.map((row) => row.row),
  ]);
}

function blockLabel(block: ImportBlock): string {
  return block.label || `${block.target} · ${block.sheet}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 2 }).format(value);
}

function close(left: number, right: number, tolerance = 1) {
  return Math.abs(left - right) <= Math.max(tolerance, Math.abs(right) * 1e-6);
}

// ---------------------------------------------------------------------------
// Scalars the model located by cell: accept them only if the cell holds them.

function excelSerialToIso(serial: number): string | null {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed?.y) return null;
  return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
}

function datesInText(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/g)) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    found.push(`${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`);
  }
  for (const match of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) found.push(match[0]);
  return found;
}

function numbersInText(text: string): number[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((match) => rawNumber(match[0])).filter((value): value is number => value !== null);
}

const DATE_KEYS: ImportKeyValueKey[] = ["periodStart", "periodEnd"];

function verifiedKeyValue(workbook: WorkbookRepresentation, blocks: ImportBlock[], key: ImportKeyValueKey): VerifiedValue | null {
  for (const block of blocks) {
    const entry = block.keyValues?.find((item) => item.key === key);
    if (!entry) continue;
    const [sheetPart, cellPart] = entry.cell.includes("!") ? [entry.cell.slice(0, entry.cell.lastIndexOf("!")).replace(/^'|'$/g, ""), entry.cell.slice(entry.cell.lastIndexOf("!") + 1)] : [block.sheet, entry.cell];
    const address = cellPart.replace(/\$/g, "").toUpperCase();
    const cell = workbook.sheets.find((sheet) => sheet.sheetName === sheetPart)?.cells.find((item) => item.address === address);
    const cellText = cell ? String(cell.formatted ?? cell.raw ?? "") : "";
    if (DATE_KEYS.includes(key)) {
      const expected = String(entry.value).slice(0, 10);
      const candidates = typeof cell?.raw === "number" ? [excelSerialToIso(cell.raw)] : datesInText(String(cell?.raw ?? ""));
      return { value: expected, cell: `${sheetPart}!${address}`, verified: /^\d{4}-\d{2}-\d{2}$/.test(expected) && candidates.includes(expected), cellText };
    }
    const expected = rawNumber(entry.value);
    if (expected === null) return { value: String(entry.value), cell: `${sheetPart}!${address}`, verified: false, cellText };
    const candidates = typeof cell?.raw === "number" ? [cell.raw] : numbersInText(String(cell?.raw ?? ""));
    return { value: expected, cell: `${sheetPart}!${address}`, verified: candidates.some((candidate) => close(candidate, expected)), cellText };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Certificate lines: copied from the columns the model mapped.

function readCertificateBlock(workbook: WorkbookRepresentation, block: ImportBlock, issues: string[]): CanonicalCertificateItem[] {
  const sheet = workbook.sheets.find((candidate) => candidate.sheetName === block.sheet);
  if (!sheet) return [];
  const columns = {
    code: mappingColumn(block, "code"),
    description: mappingColumn(block, "description"),
    unit: mappingColumn(block, "unit"),
    contractual: mappingColumn(block, "quantity"),
    previous: mappingColumn(block, "previousQuantity"),
    current: mappingColumn(block, "currentQuantity"),
    cumulative: mappingColumn(block, "cumulativeQuantity"),
    unitPrice: mappingColumn(block, "unitPrice"),
    amountPrevious: mappingColumn(block, "previousAmount"),
    amountCurrent: mappingColumn(block, "currentAmount"),
    amountCumulative: mappingColumn(block, "cumulativeAmount"),
    percentage: mappingColumn(block, "percentage"),
  };
  const missing = [
    !columns.description && "descripción",
    !columns.contractual && "cantidad contractual",
    !columns.unitPrice && "precio unitario",
    !columns.current && "cantidad presente",
    !columns.previous && !columns.cumulative && "cantidad anterior o acumulada",
  ].filter(Boolean);
  if (missing.length) {
    issues.push(`El bloque ${blockLabel(block)} no tiene mapeadas las columnas: ${missing.join(", ")}.`);
    return [];
  }
  const cells = cellIndex(sheet);
  const raw = (row: number, column: string | null) => (column ? cells.get(`${column}${row}`)?.raw ?? null : null);
  const text = (row: number, column: string | null) => String(raw(row, column) ?? "").trim();
  const num = (row: number, column: string | null) => (column ? rawNumber(raw(row, column)) : null);
  const excluded = excludedRows(block);
  const result: CanonicalCertificateItem[] = [];
  const unreadable: number[] = [];
  for (let row = block.dataRowStart; row <= block.dataRowEnd; row++) {
    if (excluded.has(row)) continue;
    const description = text(row, columns.description);
    if (!description) continue;
    const contractual = num(row, columns.contractual);
    const unitPrice = num(row, columns.unitPrice);
    const current = num(row, columns.current) ?? 0;
    const cumulativeRead = num(row, columns.cumulative);
    const previousRead = num(row, columns.previous);
    const previous = previousRead ?? (cumulativeRead !== null ? cumulativeRead - current : null);
    if (contractual === null || unitPrice === null || previous === null) {
      unreadable.push(row);
      continue;
    }
    result.push({
      code: text(row, columns.code) || null,
      description,
      unit: text(row, columns.unit) || null,
      quantityContractual: contractual,
      quantityPrevious: previous,
      quantityCurrent: current,
      quantityCumulative: cumulativeRead ?? previous + current,
      unitPrice,
      amountPrevious: num(row, columns.amountPrevious),
      amountCurrent: num(row, columns.amountCurrent),
      amountCumulative: num(row, columns.amountCumulative),
      percentage: num(row, columns.percentage),
      matchedBudgetCode: null,
      matchedBudgetRow: null,
      matchQuality: "NO_BUDGET",
      matchNote: null,
      source: { sheet: block.sheet, row, range: block.sourceRange },
    });
  }
  if (unreadable.length) issues.push(`Filas del certificado con cantidad contractual o precio no numérico (no se copiaron): ${unreadable.join(", ")}.`);
  return result;
}

export function extractCertificateItems(workbook: WorkbookRepresentation, plan: ImportPlan): CanonicalCertificateItem[] {
  return plan.blocks.filter((block) => block.target === "CERTIFICATE").flatMap((block) => readCertificateBlock(workbook, block, []));
}

// ---------------------------------------------------------------------------
// Budget ↔ certificate lines. The model asserts the two blocks list the same
// items (SAME_ITEMS / CONTRACT_SCALE); the join key is the item code, or the
// row order when no codes exist. Differences in wording are reported.

function pairCertificateLines(budgetLines: WorkbookBudgetItem[], items: CanonicalCertificateItem[]) {
  const byCode = new Map(budgetLines.filter((line) => line.code).map((line) => [normalized(line.code), line]));
  const useOrder = byCode.size === 0 && budgetLines.length === items.length;
  const used = new Set<WorkbookBudgetItem>();
  return items.map((item, index) => {
    const budget = useOrder ? budgetLines[index] : item.code ? byCode.get(normalized(item.code)) : undefined;
    if (!budget || used.has(budget)) return { ...item, matchQuality: "UNMATCHED" as const, matchNote: "Sin partida de presupuesto con el mismo código." };
    used.add(budget);
    const differences = [
      normalized(budget.description) !== normalized(item.description) && `descripción “${budget.description}” vs “${item.description}”`,
      normalized(budget.unit) !== normalized(item.unit) && `unidad “${budget.unit ?? "—"}” vs “${item.unit ?? "—"}”`,
    ].filter(Boolean);
    return {
      ...item,
      matchedBudgetCode: budget.code,
      matchedBudgetRow: budget.source.row ?? null,
      matchQuality: differences.length ? "APPROXIMATE" as const : "EXACT" as const,
      matchNote: differences.length ? differences.join("; ") : null,
    };
  });
}

// ---------------------------------------------------------------------------

// Link between the budget and the certificate as declared by the model. A
// CONTRACT_SCALE relationship wins over a plain SAME_ITEMS one because it
// also carries the factor. `factor` is always oriented budget → certificate.
function relationshipBetween(plan: ImportPlan, budgetIds: Set<string>, certificateIds: Set<string>) {
  const links = (plan.relationships ?? []).flatMap((relationship) => {
    if (relationship.type !== "SAME_ITEMS" && relationship.type !== "CONTRACT_SCALE") return [];
    const scaleFactor = relationship.type === "CONTRACT_SCALE" && relationship.factor ? relationship.factor : 1;
    if (budgetIds.has(relationship.from) && certificateIds.has(relationship.to)) return [{ relationship, factor: scaleFactor }];
    if (certificateIds.has(relationship.from) && budgetIds.has(relationship.to)) return [{ relationship, factor: 1 / scaleFactor }];
    return [];
  });
  return links.find((link) => link.relationship.type === "CONTRACT_SCALE") ?? links[0] ?? null;
}

export type CanonicalForeignBlock = { label: string; sheet: string; target: string; warnings: string[] };

export function buildCanonicalImportCandidate(
  workbook: WorkbookRepresentation,
  result: WorkbookInterpretationResult,
  checked?: ImportPlanCheck
): CanonicalImportCandidate {
  const planCheck = checked ?? validateImportPlan(result.importPlan, workbook);
  const plan = planCheck.plan;
  const extracted = extractBudgetItems(workbook, plan, planCheck.coverage);
  const mainBlocks = plan.blocks.filter((block) => block.mainProject !== false);
  const budgetBlocks = mainBlocks.filter((block) => block.target === "BUDGET");
  const certificateBlocks = mainBlocks.filter((block) => block.target === "CERTIFICATE");
  const checks: CanonicalCheck[] = [];
  const check = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, status: ok ? "OK" : "WARNING", detail });
  const budgetLines = extracted.items;

  // Budget arithmetic, in the budget's own scale.
  const withMath = budgetLines.filter((item) => item.quantity !== null && item.unitPrice !== null && item.subtotal != null);
  if (withMath.length) {
    const wrong = withMath.filter((item) => !close(item.quantity! * item.unitPrice!, item.subtotal!));
    check("budget_line_math", "Presupuesto: cantidad × precio = parcial", !wrong.length, `${withMath.length - wrong.length}/${withMath.length} partidas cuadran${wrong.length ? `; revisar filas ${wrong.map((item) => item.source.row).join(", ")}` : ""}.`);
  }
  const budgetSum = budgetLines.reduce((sum, item) => sum + (item.subtotal ?? (item.quantity ?? 0) * (item.unitPrice ?? 0)), 0);
  const declaredBudgetTotal = verifiedKeyValue(workbook, budgetBlocks, "declaredTotal");
  if (declaredBudgetTotal) {
    const declared = Number(declaredBudgetTotal.value);
    check("budget_declared_total", "Presupuesto: suma de partidas = total declarado", declaredBudgetTotal.verified && close(budgetSum, declared), `Suma ${formatNumber(budgetSum)} · total declarado ${formatNumber(declared)} (${declaredBudgetTotal.cell}${declaredBudgetTotal.verified ? "" : ", no verificado en la celda"}).`);
  }

  // Certificate lines.
  const certificateIssues: string[] = [];
  const certificateSheets = new Set(certificateBlocks.map((block) => block.sheet));
  let items = certificateSheets.size > 1 ? [] : certificateBlocks.flatMap((block) => readCertificateBlock(workbook, block, certificateIssues));
  if (certificateSheets.size > 1) certificateIssues.push(`Se marcaron certificados en varias hojas (${[...certificateSheets].join(", ")}); no se puede elegir uno automáticamente.`);

  const link = relationshipBetween(plan, new Set(budgetBlocks.map((block) => block.id)), new Set(certificateBlocks.map((block) => block.id)));
  if (items.length && budgetLines.length) {
    if (link) items = pairCertificateLines(budgetLines, items);
    else certificateIssues.push("El análisis no relacionó el presupuesto con el certificado; las líneas del certificado quedan sin vínculo a partidas.");
  }
  const matched = items.filter((item) => item.matchQuality === "EXACT" || item.matchQuality === "APPROXIMATE");
  const approximate = items.filter((item) => item.matchQuality === "APPROXIMATE");
  const unmatched = items.filter((item) => item.matchQuality === "UNMATCHED");
  if (link && items.length) {
    check("budget_certificate_match", "Presupuesto ↔ certificado: partidas vinculadas", !unmatched.length && !approximate.length, `${matched.length}/${items.length} vinculadas${approximate.length ? ` (${approximate.length} con diferencias de texto/unidad)` : ""}${unmatched.length ? `; sin vínculo: filas ${unmatched.map((item) => item.source.row).join(", ")}` : ""}.`);
    for (const item of approximate) certificateIssues.push(`Fila ${item.source.row}: ${item.matchNote}.`);
    if (unmatched.length) certificateIssues.push(`${unmatched.length} línea(s) del certificado sin partida de presupuesto; se importarían sin vínculo.`);
  }

  // Scale declared by the model, verified line by line.
  let scale: CanonicalScaleAudit | null = null;
  if (link && link.factor !== 1) {
    const budgetByRow = new Map(budgetLines.map((line) => [line.source.row, line]));
    const budgetFor = (item: CanonicalCertificateItem) => (item.matchedBudgetRow === null ? undefined : budgetByRow.get(item.matchedBudgetRow));
    const compared = matched.filter((item) => (budgetFor(item)?.quantity ?? 0) > 0);
    const consistent = compared.filter((item) => Math.abs(item.quantityContractual / budgetFor(item)!.quantity! - link.factor) <= link.factor * 0.005);
    const fromBlock = plan.blocks.find((block) => block.id === link.relationship.from)!;
    const toBlock = plan.blocks.find((block) => block.id === link.relationship.to)!;
    scale = { fromBlock: blockLabel(fromBlock), toBlock: blockLabel(toBlock), factor: link.factor, comparedLines: compared.length, consistentLines: consistent.length, evidence: link.relationship.evidence };
    check("scale_consistency", `Escala ×${formatNumber(scale.factor)} consistente`, consistent.length === compared.length, `${consistent.length}/${compared.length} partidas cumplen cantidad contractual = presupuesto × ${formatNumber(link.factor)}.`);
    const priceMismatch = matched.filter((item) => { const budget = budgetFor(item); return budget?.unitPrice != null && !close(budget.unitPrice, item.unitPrice); });
    check("scale_unit_price", "Precios unitarios iguales en ambas escalas", !priceMismatch.length, priceMismatch.length ? `Difieren en filas ${priceMismatch.map((item) => item.source.row).join(", ")}; se usa el precio del certificado.` : `${matched.length} partidas con el mismo precio unitario.`);
  }

  // Certificate arithmetic and declared totals.
  let totals: Pick<CanonicalCertificateAudit, "contractTotal" | "previousTotal" | "currentTotal" | "cumulativeTotal" | "cumulativePercent"> = { contractTotal: null, previousTotal: null, currentTotal: null, cumulativeTotal: null, cumulativePercent: null };
  if (items.length) {
    const cumulativeWrong = items.filter((item) => !close(item.quantityPrevious + item.quantityCurrent, item.quantityCumulative, 1e-6));
    check("certificate_quantities", "Certificado: anterior + presente = acumulado", !cumulativeWrong.length, cumulativeWrong.length ? `No cuadran filas ${cumulativeWrong.map((item) => item.source.row).join(", ")}.` : `${items.length}/${items.length} líneas cuadran.`);
    const amount = (value: number | null, quantity: number, price: number) => value ?? Math.round(quantity * price);
    const contractTotal = items.reduce((sum, item) => sum + Math.round(item.quantityContractual * item.unitPrice), 0);
    const previousTotal = items.reduce((sum, item) => sum + amount(item.amountPrevious, item.quantityPrevious, item.unitPrice), 0);
    const currentTotal = items.reduce((sum, item) => sum + amount(item.amountCurrent, item.quantityCurrent, item.unitPrice), 0);
    const cumulativeTotal = items.reduce((sum, item) => sum + amount(item.amountCumulative, item.quantityCumulative, item.unitPrice), 0);
    totals = { contractTotal, previousTotal, currentTotal, cumulativeTotal, cumulativePercent: contractTotal ? cumulativeTotal / contractTotal : null };
    const amountWrong = items.filter((item) => item.amountCumulative !== null && !close(item.amountCumulative, Math.round(item.quantityCumulative * item.unitPrice), 2));
    if (items.some((item) => item.amountCumulative !== null)) check("certificate_line_amounts", "Certificado: cantidad × precio = monto", !amountWrong.length, amountWrong.length ? `Montos acumulados que no cuadran en filas ${amountWrong.map((item) => item.source.row).join(", ")}.` : "Montos por línea consistentes.");
    for (const [key, label, computed] of [
      ["contractAmount", "Monto de contrato", contractTotal],
      ["declaredPreviousAmount", "Total anterior", previousTotal],
      ["declaredCurrentAmount", "Total presente", currentTotal],
      ["declaredCumulativeAmount", "Total acumulado", cumulativeTotal],
    ] as const) {
      const declared = verifiedKeyValue(workbook, certificateBlocks, key);
      if (!declared) continue;
      check(`certificate_${key}`, `Certificado: ${label.toLowerCase()} = declarado`, declared.verified && close(computed, Number(declared.value), 2), `Calculado ${formatNumber(computed)} · declarado ${formatNumber(Number(declared.value))} (${declared.cell}${declared.verified ? "" : ", no verificado en la celda"}).`);
    }
  }
  for (const item of checks.filter((entry) => entry.status === "WARNING" && (entry.id.startsWith("certificate_") || entry.id.startsWith("scale_")))) certificateIssues.push(`${item.label}: ${item.detail}`);

  const number = verifiedKeyValue(workbook, certificateBlocks, "certificateNumber");
  const periodStart = verifiedKeyValue(workbook, certificateBlocks, "periodStart");
  const periodEnd = verifiedKeyValue(workbook, certificateBlocks, "periodEnd");
  const identityProblems = [
    !number?.verified && "número",
    !periodStart?.verified && "inicio de período",
    !periodEnd?.verified && "fin de período",
  ].filter(Boolean);
  for (const block of certificateBlocks) {
    for (const warning of block.warnings ?? []) certificateIssues.push(warning);
    if (block.needsReview) certificateIssues.push(`El análisis marcó el bloque ${blockLabel(block)} para revisión.`);
  }
  const certificateScale = certificateBlocks.find((block) => block.scale)?.scale ?? null;
  const certificateStatus: CanonicalCertificateAudit["status"] = !certificateBlocks.length
    ? "NOT_DETECTED"
    : !items.length || identityProblems.length
      ? "DETECTED_NOT_APPLIED"
      : certificateIssues.length ? "APPLY_WITH_WARNINGS" : "SAFE_TO_APPLY";
  const certificateReason = certificateStatus === "NOT_DETECTED"
    ? "No se detectó un certificado."
    : !items.length
      ? "No se pudieron copiar líneas del certificado desde las columnas indicadas."
      : identityProblems.length
        ? `Falta ${identityProblems.join(", ")} verificable en la planilla; la base de datos lo exige para crear el certificado.`
        : certificateStatus === "APPLY_WITH_WARNINGS"
          ? "El certificado puede importarse, pero tiene observaciones que conviene revisar."
          : "Líneas, totales y vínculos verificados.";
  const certificate: CanonicalCertificateAudit = {
    status: certificateStatus,
    itemCount: items.length,
    matchedBudgetItems: matched.length,
    number: number?.verified ? Number(number.value) : null,
    periodStart: periodStart?.verified ? String(periodStart.value) : null,
    periodEnd: periodEnd?.verified ? String(periodEnd.value) : null,
    ...totals,
    scaleUnits: certificateScale?.units ?? null,
    reason: certificateReason,
    issues: [...new Set(certificateIssues)],
    items,
  };

  // Budget to persist: when the model declared a contract scale, the
  // contract quantities are the certificate's own contractual quantities.
  const certificateByBudgetRow = new Map(matched.map((item) => [item.matchedBudgetRow, item]));
  const scaled = Boolean(link && link.factor !== 1 && matched.length);
  const canonicalBudgetItems = scaled
    ? budgetLines.map((line) => {
      const certificateLine = certificateByBudgetRow.get(line.source.row ?? null);
      return certificateLine
        ? { ...line, quantity: certificateLine.quantityContractual, unitPrice: certificateLine.unitPrice, subtotal: null }
        : { ...line, quantity: line.quantity === null ? null : line.quantity * link!.factor, subtotal: null };
    })
    : budgetLines;
  const budgetTotal = canonicalBudgetItems.reduce((sum, item) => sum + Math.round((item.quantity ?? 0) * (item.unitPrice ?? 0)), 0);

  const labels = new Map(plan.blocks.map((block) => [block.id, blockLabel(block)]));
  const relationships = (plan.relationships ?? []).map((relationship) => ({ ...relationship, fromLabel: labels.get(relationship.from) ?? relationship.from, toLabel: labels.get(relationship.to) ?? relationship.to }));

  const domains = new Map<string, CanonicalDomainSummary>();
  for (const block of mainBlocks.filter((item) => item.target !== "BUDGET" && item.target !== "CERTIFICATE")) {
    const domain = domains.get(block.target) ?? { target: block.target, labels: [], sheets: [], rows: 0, warnings: [], persistence: "NOT_CONNECTED" as const };
    domain.labels.push(blockLabel(block));
    if (!domain.sheets.includes(block.sheet)) domain.sheets.push(block.sheet);
    domain.rows += planCheck.coverage.find((item) => item.blockId === block.id)?.sourceRows ?? 0;
    domain.warnings.push(...(block.warnings ?? []));
    domains.set(block.target, domain);
  }

  return {
    budgetItems: canonicalBudgetItems,
    budgetQuantitySource: scaled ? "CERTIFICATE_CONTRACT_QUANTITY" : "BUDGET",
    budgetTotal,
    budgetScale: budgetBlocks.find((block) => block.scale)?.scale ?? null,
    relationships,
    scale,
    certificate,
    domains: [...domains.values()],
    foreignBlocks: plan.blocks.filter((block) => block.mainProject === false).map((block) => ({ label: blockLabel(block), sheet: block.sheet, target: block.target, warnings: block.warnings ?? [] })),
    checks,
    warnings: [...new Set([
      ...extracted.warnings,
      ...planCheck.warnings,
      ...checks.filter((item) => item.status === "WARNING").map((item) => `${item.label}: ${item.detail}`),
      ...(certificate.status === "DETECTED_NOT_APPLIED" ? [certificate.reason] : []),
    ])],
  };
}

export function safeProjectField(result: WorkbookInterpretationResult, key: keyof WorkbookInterpretationResult["project"]): string | null {
  return fieldText(result.project[key]);
}
