/**
 * Interpretación de cronogramas XLSX/CSV para el Gantt de obra.
 *
 * Capa pura (sin I/O ni DB): detecta columnas por alias flexibles (nunca exige
 * nombres exactos), interpreta fechas reales de Excel, matchea filas contra las
 * partidas ERP existentes y deriva inicio/fin/duración + predecesoras.
 *
 * Garantías de seguridad (también reforzadas en el server action):
 * - Jamás crea partidas, ni toca cantidades, precios, certificados, avance o stock.
 * - Las filas sin match quedan como SIN VINCULAR y no bloquean al resto.
 * - Nunca se inventan fechas: sin información suficiente, la fila queda sin fechas.
 */
import { inclusiveScheduleDuration } from "@/lib/projects/schedule";

export type ScheduleColumnRole =
  | "code"
  | "description"
  | "start"
  | "end"
  | "duration"
  | "predecessor"
  | "depType";

export type ScheduleMatchMethod = "exact-code" | "norm-code" | "exact-desc" | "fuzzy-desc";

export interface ScheduleErpItem {
  id: string;
  code: string;
  description: string;
}

export interface SchedulePreviewRow {
  sourceRow: number;
  docCode: string;
  docDescription: string;
  start: string | null;
  end: string | null;
  durationDays: number | null;
  predecessorRef: string;
  depType: string | null;
  match: { itemId: string; code: string; description: string; method: ScheduleMatchMethod } | null;
  warnings: string[];
}

export interface ScheduleInterpretation {
  columns: Partial<Record<ScheduleColumnRole, number>>;
  rows: SchedulePreviewRow[];
  stats: { detected: number; matched: number; unlinked: number };
}

export interface ScheduleUpdate {
  itemId: string;
  start_date: string;
  end_date: string;
  depends_on: string | null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const COLUMN_ALIASES: Record<ScheduleColumnRole, string[]> = {
  code: ["codigo", "cod", "code", "item", "partida", "nro", "numero", "id partida", "partida nro", "rubro nro"],
  description: ["descripcion", "description", "rubro", "tarea", "task", "actividad", "activity", "detalle", "concepto", "nombre", "name", "title"],
  start: ["inicio", "start", "fecha inicio", "comienzo", "desde", "fecha desde", "fecha inicial"],
  end: ["fin", "end", "fecha fin", "termino", "hasta", "fecha hasta", "fecha final", "final"],
  duration: ["duracion", "duration", "duracion dias", "dias", "plazo", "plazo dias", "duree"],
  predecessor: ["predecesora", "predecesor", "predecessor", "dependencia", "dependencias", "predecessors", "depends", "vinculo anterior", "anterior"],
  depType: ["tipo", "type", "tipo vinculo", "tipo dependencia", "relacion", "vinculo", "rel"],
};

const HEADER_ROLE_PRIORITY: ScheduleColumnRole[] = [
  "code",
  "description",
  "start",
  "end",
  "duration",
  "predecessor",
  "depType",
];

/** Descripción gana a código si el encabezado es ambiguo ("partida" suele ser texto). */
function scoreAlias(headerNorm: string, aliasNorm: string): number {
  if (!aliasNorm) return 0;
  if (headerNorm === aliasNorm) return 100;
  if (headerNorm.startsWith(aliasNorm) || aliasNorm.startsWith(headerNorm)) return 60;
  if (headerNorm.includes(aliasNorm) || aliasNorm.includes(headerNorm)) return 30;
  return 0;
}

export function detectScheduleColumns(headers: string[]): Partial<Record<ScheduleColumnRole, number>> {
  const normHeaders = headers.map(normalizeText);
  const assigned = new Map<ScheduleColumnRole, number>();
  const usedCols = new Set<number>();
  for (const role of HEADER_ROLE_PRIORITY) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < normHeaders.length; i++) {
      if (usedCols.has(i)) continue;
      const header = normHeaders[i];
      if (!header) continue;
      let score = 0;
      for (const alias of COLUMN_ALIASES[role]) {
        score = Math.max(score, scoreAlias(header, normalizeText(alias)));
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0 && bestScore >= 30) {
      assigned.set(role, best);
      usedCols.add(best);
    }
  }
  return Object.fromEntries(assigned) as Partial<Record<ScheduleColumnRole, number>>;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

function toIsoDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const fullYear = year < 100 ? 2000 + year : year;
  const iso = `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** Serial Excel (sistema 1900) → ISO. Rango 2000-01-01..2100-01-01; fuera de rango = null. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 36526 || serial > 73050) return null;
  const ms = Math.round((serial - 25569) * 86_400_000);
  const iso = new Date(ms).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/**
 * Interpreta fechas reales de Excel: Date, serial numérico, "dd/mm/yyyy",
 * "yyyy-mm-dd", "dd-mm-yyyy" y datetimes (se ignora la hora).
 */
export function parseScheduleDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return toIsoDay(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") return excelSerialToIso(Math.floor(value));
  const text = String(value).trim();
  if (!text) return null;
  const isoMatch = ISO_DAY.exec(text.slice(0, 10));
  if (isoMatch) return toIsoDay(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  const numericString = Number(text.replace(",", "."));
  if (text !== "" && Number.isFinite(numericString) && /^[\d.,\s]+$/.test(text)) {
    const asSerial = excelSerialToIso(Math.floor(numericString));
    if (asSerial) return asSerial;
  }
  const dmy = DMY.exec(text);
  if (dmy) return toIsoDay(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
}

export function parseDurationDays(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  const match = /(\d+(?:[.,]\d+)?)/.exec(String(value));
  if (!match) return null;
  const days = Math.round(Number(match[1].replace(",", ".")));
  return days > 0 ? days : null;
}

const DEP_TYPES = ["FS", "SS", "FF", "SF"] as const;

export function normalizeDepType(value: unknown): string | null {
  const norm = normalizeText(value).replace(/\s+/g, "");
  for (const dep of DEP_TYPES) {
    if (norm.toUpperCase().includes(dep)) return dep;
  }
  return null;
}

function normCode(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function tokens(value: string): Set<string> {
  return new Set(normalizeText(value).split(" ").filter((t) => t.length > 2));
}

export function matchScheduleItem(
  docCode: string,
  docDescription: string,
  items: readonly ScheduleErpItem[]
): { itemId: string; code: string; description: string; method: ScheduleMatchMethod } | null {
  const code = docCode.trim();
  if (code) {
    const exact = items.find((i) => i.code.trim().toLowerCase() === code.toLowerCase());
    if (exact) return { itemId: exact.id, code: exact.code, description: exact.description, method: "exact-code" };
    const nc = normCode(code);
    if (nc) {
      const byNorm = items.find((i) => normCode(i.code) === nc);
      if (byNorm) return { itemId: byNorm.id, code: byNorm.code, description: byNorm.description, method: "norm-code" };
    }
  }
  const desc = docDescription.trim();
  if (desc) {
    const nd = normalizeText(desc);
    const exactDesc = items.find((i) => normalizeText(i.description) === nd);
    if (exactDesc) return { itemId: exactDesc.id, code: exactDesc.code, description: exactDesc.description, method: "exact-desc" };
    const docTokens = tokens(desc);
    if (docTokens.size > 0) {
      let best: ScheduleErpItem | null = null;
      let bestScore = 0;
      for (const item of items) {
        const itemTokens = tokens(item.description);
        if (itemTokens.size === 0) continue;
        let overlap = 0;
        for (const t of docTokens) if (itemTokens.has(t)) overlap++;
        const score = overlap / Math.max(docTokens.size, itemTokens.size);
        if (score > bestScore) {
          bestScore = score;
          best = item;
        }
      }
      if (best && bestScore >= 0.5) {
        return { itemId: best.id, code: best.code, description: best.description, method: "fuzzy-desc" };
      }
    }
  }
  return null;
}

function addDaysIso(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * inicio+fin → ambos; inicio+duración → fin = inicio+dur-1 (días calendario
 * inclusivos, igual que inclusiveScheduleDuration); fin+duración → inicio.
 * Sin información suficiente: nulls (nunca se inventa).
 */
export function deriveScheduleDates(
  start: string | null,
  end: string | null,
  durationDays: number | null
): { start: string | null; end: string | null } {
  if (start && end) return { start, end };
  if (start && durationDays) return { start, end: addDaysIso(start, durationDays - 1) };
  if (end && durationDays) return { start: addDaysIso(end, -(durationDays - 1)), end };
  return { start: start ?? null, end: end ?? null };
}

function cellString(row: unknown[], col: number | undefined): string {
  if (col === undefined) return "";
  return String(row[col] ?? "").trim();
}

function findDataStart(rows: unknown[][]): number {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((c) => String(c ?? "").trim() !== "")) return i;
  }
  return 0;
}

const SUMMARY_HINT = /total|subtotal|resumen|firma|elaborado|observaciones/i;

export function interpretScheduleSheet(
  rawRows: unknown[][],
  items: readonly ScheduleErpItem[]
): ScheduleInterpretation {
  const nonEmpty = rawRows.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (nonEmpty.length === 0) return { columns: {}, rows: [], stats: { detected: 0, matched: 0, unlinked: 0 } };
  const headerIdx = findDataStart(nonEmpty);
  const headers = (nonEmpty[headerIdx] as unknown[]).map((h) => String(h ?? ""));
  const columns = detectScheduleColumns(headers);
  const rows: SchedulePreviewRow[] = [];

  for (let r = headerIdx + 1; r < nonEmpty.length; r++) {
    const row = nonEmpty[r] as unknown[];
    if (row.every((c) => String(c ?? "").trim() === "")) continue;
    const docCode = cellString(row, columns.code);
    // Si no hay columna de descripción, el texto de la columna código también
    // sirve para matchear por descripción (planillas de una sola columna).
    const docDescription = columns.description === undefined ? docCode : cellString(row, columns.description);
    if (!docCode && !docDescription) continue;
    if (!docCode && SUMMARY_HINT.test(docDescription)) continue;

    const warnings: string[] = [];
    const startRaw = columns.start === undefined ? "" : row[columns.start];
    const endRaw = columns.end === undefined ? "" : row[columns.end];
    const durRaw = columns.duration === undefined ? "" : row[columns.duration];
    const startParsed = parseScheduleDate(startRaw);
    const endParsed = parseScheduleDate(endRaw);
    const durationDays = parseDurationDays(durRaw);
    if (columns.start !== undefined && startRaw !== "" && !startParsed) warnings.push("Inicio no interpretable.");
    if (columns.end !== undefined && endRaw !== "" && !endParsed) warnings.push("Fin no interpretable.");
    const { start, end } = deriveScheduleDates(startParsed, endParsed, durationDays);
    if (start && end && end < start) warnings.push("Fin anterior al inicio: se importa igual para revisión.");
    if ((!start || !end) && (startParsed || endParsed || durationDays)) {
      warnings.push("Fechas incompletas: faltan datos para derivar el rango.");
    }

    const match = matchScheduleItem(docCode, docDescription, items);
    if (!match) warnings.push("Sin vincular: no se encontró la partida en el ERP.");

    const predecessorRef = cellString(row, columns.predecessor);
    const depType = normalizeDepType(columns.depType === undefined ? "" : row[columns.depType]);

    rows.push({
      sourceRow: r + 1,
      docCode,
      docDescription,
      start,
      end,
      durationDays: start && end ? inclusiveScheduleDuration(start, end) : durationDays,
      predecessorRef,
      depType,
      match,
      warnings,
    });
  }

  const matched = rows.filter((r) => r.match).length;
  return { columns, rows, stats: { detected: rows.length, matched, unlinked: rows.length - matched } };
}

/**
 * Resuelve predecesoras contra partidas matcheadas: primero por código ERP
 * exacto/normalizado, si no por la fila del preview ya vinculada. Solo se
 * resuelve si el destino existe; nunca se inventa. El Gantt actual persiste
 * una única predecesora por partida (depends_on); el tipo FS/SS/FF/SF viaja
 * en el preview (limitación reportada: no se dibuja ni persiste el tipo).
 */
export function resolveSchedulePredecessors(
  preview: readonly SchedulePreviewRow[],
  items: readonly ScheduleErpItem[]
): Map<number, { itemId: string; depType: string | null }> {
  const byRowIndex = new Map<number, SchedulePreviewRow>();
  preview.forEach((row, idx) => byRowIndex.set(idx, row));
  const codeToItem = new Map<string, ScheduleErpItem>();
  for (const item of items) {
    if (!codeToItem.has(item.code.trim().toLowerCase())) codeToItem.set(item.code.trim().toLowerCase(), item);
    const nc = normCode(item.code);
    if (nc && ![...codeToItem.keys()].includes(nc)) codeToItem.set(nc, item);
  }
  const resolved = new Map<number, { itemId: string; depType: string | null }>();
  preview.forEach((row, idx) => {
    const ref = row.predecessorRef.trim();
    if (!ref) return;
    const direct = codeToItem.get(ref.toLowerCase()) ?? codeToItem.get(normCode(ref));
    if (direct) {
      resolved.set(idx, { itemId: direct.id, depType: row.depType });
      return;
    }
    const sameSheet = preview.find(
      (other) => other !== row && other.match && (other.docCode.trim().toLowerCase() === ref.toLowerCase() || normCode(other.docCode) === normCode(ref))
    );
    if (sameSheet?.match) resolved.set(idx, { itemId: sameSheet.match.itemId, depType: row.depType });
  });
  void byRowIndex;
  return resolved;
}

/**
 * Construye los updates a persistir: solo partidas vinculadas CON rango
 * completo (inicio+fin). Las filas sin vincular o sin fechas se omiten sin
 * bloquear al resto. No incluye ningún otro campo: la whitelist de columnas
 * la aplica además el server action (start_date, end_date, depends_on).
 */
export function buildScheduleUpdates(
  preview: readonly SchedulePreviewRow[],
  predecessors: Map<number, { itemId: string; depType: string | null }>
): ScheduleUpdate[] {
  const updates: ScheduleUpdate[] = [];
  preview.forEach((row, idx) => {
    if (!row.match || !row.start || !row.end) return;
    updates.push({
      itemId: row.match.itemId,
      start_date: row.start,
      end_date: row.end,
      depends_on: predecessors.get(idx)?.itemId ?? null,
    });
  });
  return updates;
}
