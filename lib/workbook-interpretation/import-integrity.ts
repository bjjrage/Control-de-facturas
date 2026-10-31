import * as XLSX from "xlsx";
import type { CanonicalImportCandidate } from "./canonical-import";
import type { WorkbookCell, WorkbookInterpretationResult, WorkbookRepresentation } from "./types";

export type ImportIssue = { domain: "PROJECT" | "BUDGET" | "CERTIFICATE" | "STAFF" | "EXECUTION" | "COVERAGE" | "SCHEDULE" | "WEATHER"; severity: "ERROR" | "REVIEW"; message: string; source: string };
type Fact<T> = { value: T; source: string };
export type ImportIntegrity = {
  version: 1;
  project: { startDate: Fact<string> | null; endDate: Fact<string> | null; orderDate: Fact<string> | null; durationDays: Fact<number> | null };
  issues: ImportIssue[];
  weatherCounts: { B: number; LL: number; HH: number; O: number };
};
const normalized = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function dateValue(cell: WorkbookCell): string | null {
  if (cell.type === "e" || cell.type === "b") return null;
  let iso: string | null = null;
  if (typeof cell.raw === "number") {
    const d = XLSX.SSF.parse_date_code(cell.raw);
    if (d && d.y >= 1900 && d.y <= 2200) iso = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  } else {
    const text = String(cell.raw ?? "");
    const dates = [...text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)];
    if (dates.length === 1) {
      const m = dates[0];
      iso = m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5].padStart(2, "0")}-${m[4].padStart(2, "0")}`;
    }
  }
  return iso && Number.isFinite(Date.parse(iso)) && new Date(iso + "T00:00:00Z").toISOString().slice(0, 10) === iso ? iso : null;
}

/** Recognized contractual labels corroborate semantic roles. A plausible date
 * or a model confidence score alone never authorizes writing project dates. */
export function inspectImportIntegrity(workbook: WorkbookRepresentation, result: WorkbookInterpretationResult, candidate: Pick<CanonicalImportCandidate, "schedulePlans" | "weatherDays">): ImportIntegrity {
  const report: ImportIntegrity = { version: 1, project: { startDate: null, endDate: null, orderDate: null, durationDays: null }, issues: [], weatherCounts: { B: 0, LL: 0, HH: 0, O: 0 } };
  const mainSheets = new Set(result.importPlan.blocks.filter(b => b.mainProject !== false).map(b => b.sheet));
  const foreignSheets = new Set(result.importPlan.blocks.filter(b => b.mainProject === false).map(b => b.sheet));
  const facts = { startDate: [] as Fact<string>[], endDate: [] as Fact<string>[], orderDate: [] as Fact<string>[], durationDays: [] as Fact<number>[] };
  for (const sheet of workbook.sheets.filter(s => mainSheets.has(s.sheetName) && !foreignSheets.has(s.sheetName))) {
    for (const label of sheet.cells.filter(c => typeof c.raw === "string")) {
      const text = normalized(label.raw);
      if (/periodo|certificado|acta de|medicion/.test(text)) continue;
      const key = /^(?:fecha (?:de )?(?:la )?)?orden de inicio(?: de ejecucion)?(?: de obra)?\s*(?::|-|$)/.test(text) ? "orderDate"
        : /^(?:plazo contractual|plazo de ejecucion(?: de (?:la )?obra)?)\s*(?::|-|$)/.test(text) && !/ampli|prorroga/.test(text) ? "durationDays"
        : /^fecha de inicio(?: de (?:la )?obra| contractual)?\s*(?::|-|$)/.test(text) ? "startDate"
        : /^fecha de (?:fin(?:alizacion)?|terminacion)(?: de (?:la )?obra| contractual)?\s*(?::|-|$)/.test(text) ? "endDate" : null;
      if (!key) continue;
      const adjacent = sheet.cells.filter(c => c.row === label.row && c.column > label.column && c.column <= label.column + 4 && c.raw !== null).sort((a,b) => a.column-b.column)[0];
      const sources = [label, ...(adjacent ? [adjacent] : [])];
      for (const cell of sources) {
        const source = `${sheet.sheetName}!${cell.address}`;
        if (key === "durationDays") {
          const match = String(cell.raw ?? "").match(/^(?:plazo[^:]*:\s*)?(\d+)\s*d[ií]as(?:\s+corridos)?\s*$/i);
          const days = match ? Number(match[1]) : cell === adjacent && typeof cell.raw === "number" ? cell.raw : null;
          if (days !== null && Number.isInteger(days) && days > 0 && days <= 36500 && cell.type !== "e") facts.durationDays.push({ value: days, source });
        } else {
          const value = dateValue(cell);
          if (value) facts[key].push({ value, source });
        }
      }
    }
  }
  for (const key of ["startDate", "endDate", "orderDate", "durationDays"] as const) {
    const found = facts[key];
    if (new Set(found.map(f => f.value)).size > 1) report.issues.push({ domain: "PROJECT", severity: "ERROR", source: found.map(f => f.source).join(", "), message: `Hay valores contractuales contradictorios para ${key}; revisá sus celdas antes de importar.` });
    else if (found.length) Object.assign(report.project, { [key]: found[0] });
  }
  report.project.startDate ??= report.project.orderDate;
  for (const key of ["startDate", "endDate"] as const) {
    const proposed = result.project[key];
    if (proposed.value && proposed.value !== report.project[key]?.value) report.issues.push({ domain: "PROJECT", severity: "REVIEW", source: `${proposed.source?.sheet ?? ""}!${proposed.source?.range ?? ""}`, message: `La fecha propuesta ${proposed.value} no acredita ${key === "startDate" ? "el inicio" : "el fin"} de la obra; se usa únicamente la fecha contractual verificada o queda sin completar. El período del certificado se conserva en el certificado.` });
  }
  if (report.project.startDate && report.project.endDate && report.project.endDate.value < report.project.startDate.value) report.issues.push({ domain: "PROJECT", severity: "ERROR", source: report.project.endDate.source, message: "El fin de obra es anterior a su inicio." });
  for (const plan of candidate.schedulePlans) {
    const total = plan.months.reduce((sum, m) => sum + m.programadoPct, 0);
    if (!plan.months.length || Math.abs(total - 100) > 0.15 || plan.months.some(m => !Number.isFinite(m.programadoPct) || m.programadoPct < 0 || m.programadoPct > 100) || new Set(plan.months.map(m => m.monthIndex)).size !== plan.months.length) report.issues.push({ domain: "SCHEDULE", severity: "ERROR", source: `${plan.sheet}!fila ${plan.sourceRow}`, message: `La curva «${plan.label}» suma ${total.toFixed(3)} %. No se aplica una curva incompleta, duplicada o con escala incorrecta.` });
  }
  const seen = new Map<string, string>();
  const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  for (const block of result.importPlan.blocks.filter(b => b.mainProject !== false && b.target === "NON_WORKING_DAYS" && b.weatherRows?.length)) {
    const sheet = workbook.sheets.find(s => s.sheetName === block.sheet);
    if (!sheet) continue;
    const firstRow = Math.min(...block.weatherRows!.map(r => r.row));
    for (const row of block.weatherRows!) {
      const firstColumn = Math.min(...row.dayColumns.map(d => XLSX.utils.decode_col(d.column)+1));
      const left = sheet.cells.filter(c => c.row === row.row && c.column < firstColumn);
      const monthCell = left.find(c => monthNames.some(m => new RegExp(`\\b${m}\\b`).test(normalized(c.raw))));
      const actualMonth = monthCell ? monthNames.findIndex(m => new RegExp(`\\b${m}\\b`).test(normalized(monthCell.raw)))+1 : null;
      const yearCell = sheet.cells.filter(c => c.row <= row.row && c.column < firstColumn && typeof c.raw === "number" && Number.isInteger(c.raw) && c.raw >= 1900 && c.raw <= 2200).sort((a,b) => b.row-a.row)[0];
      if ((actualMonth && actualMonth !== row.month) || (yearCell && Number(yearCell.raw) !== row.year)) report.issues.push({ domain:"WEATHER",severity:"ERROR",source:`${sheet.sheetName}!fila ${row.row}`,message:"El mes o año interpretado no coincide con el encabezado del calendario." });
      for (const day of row.dayColumns) {
        const column = XLSX.utils.decode_col(day.column)+1;
        const cell = sheet.cells.find(c => c.row === row.row && c.column === column);
        if (cell?.raw == null || String(cell.raw).trim() === "") continue;
        const header = sheet.cells.filter(c => c.column === column && c.row < firstRow && c.row >= Math.max(block.headerRowStart, firstRow-4)).sort((a,b)=>b.row-a.row)[0];
        if (!header || Number(header.raw) !== day.day) report.issues.push({ domain:"WEATHER",severity:"ERROR",source:`${sheet.sheetName}!${day.column}${row.row}`,message:"La columna de jornada no coincide con el día de su encabezado." });
        const date = new Date(Date.UTC(row.year,row.month-1,day.day));
        const code = String(cell.raw).trim().toUpperCase();
        if (date.getUTCMonth()+1 !== row.month || !["B","LL","HH","O"].includes(code)) report.issues.push({domain:"WEATHER",severity:"ERROR",source:`${sheet.sheetName}!${cell.address}`,message:"La celda contiene un código desconocido o un día inexistente; no se omite silenciosamente."});
      }
    }
  }
  for (const day of candidate.weatherDays) {
    report.weatherCounts[day.code]++;
    const source = `${day.sheet}!${day.column}${day.row}`;
    if (seen.has(day.date)) report.issues.push({ domain: "WEATHER", severity: "ERROR", source, message: `La jornada ${day.date} aparece más de una vez; no se sobrescribe automáticamente.` });
    seen.set(day.date, day.code);
    if (report.project.startDate && day.date < report.project.startDate.value) report.issues.push({ domain: "WEATHER", severity: "ERROR", source, message: `La jornada ${day.date} es anterior al inicio verificado de obra.` });
  }
  // Reconcile dated codes with COUNTIF/CONTAR.SI summaries. Extra constants
  // (e.g. +1) remain documentary discrepancies, never invented work dates.
  const weatherSheets = new Set(candidate.weatherDays.map(d => d.sheet));
  for (const sheet of workbook.sheets.filter(s => weatherSheets.has(s.sheetName))) {
    for (const cell of sheet.cells) {
      const match = cell.formula?.match(/(?:COUNTIF|CONTAR\.SI)\(\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)[,;]\s*"(B|LL|HH|O)"\s*\)/i);
      if (!match || typeof cell.raw !== "number" || cell.type === "e") continue;
      const [, c1,r1,c2,r2,code] = match;
      const low = XLSX.utils.decode_col(c1), high = XLSX.utils.decode_col(c2);
      const count = candidate.weatherDays.filter(d => d.sheet === sheet.sheetName && d.row >= Number(r1) && d.row <= Number(r2) && XLSX.utils.decode_col(d.column) >= low && XLSX.utils.decode_col(d.column) <= high && d.code === code.toUpperCase()).length;
      if (count !== cell.raw) report.issues.push({ domain: "WEATHER", severity: "REVIEW", source: `${sheet.sheetName}!${cell.address}`, message: `El resumen ${code} declara ${cell.raw} días y las celdas fechadas contienen ${count}. Solo se incorporan los días identificados; la diferencia queda pendiente de conciliación.` });
    }
  }
  return report;
}

export type ImportSelection = { schedule: boolean; weather: boolean; certificate?: boolean; staff?: boolean; execution?: boolean };
/** UI defaults are not a request to import absent sections. Dependents
 * become applicable only with an accepted, importable certificate. */
export function availableImportSelection(candidate: Pick<CanonicalImportCandidate, "certificate" | "staff" | "executionEntries" | "schedulePlans" | "weatherDays">, requested: ImportSelection): Required<ImportSelection> {
  const certificate = Boolean(requested.certificate && ["SAFE_TO_APPLY", "APPLY_WITH_WARNINGS"].includes(candidate.certificate.status));
  return { certificate, staff: Boolean(certificate && requested.staff && candidate.staff.length), execution: Boolean(certificate && requested.execution && candidate.executionEntries.length), schedule: Boolean(requested.schedule && candidate.schedulePlans.length), weather: Boolean(requested.weather && candidate.weatherDays.length) };
}
export function selectedImportIssues(integrity: ImportIntegrity, selection: ImportSelection) {
  return integrity.issues.filter(i => i.domain === "PROJECT" || i.domain === "BUDGET" || i.domain === "COVERAGE"
    || (i.domain === "SCHEDULE" && selection.schedule) || (i.domain === "WEATHER" && selection.weather)
    || (i.domain === "CERTIFICATE" && selection.certificate) || (i.domain === "STAFF" && selection.staff)
    || (i.domain === "EXECUTION" && selection.execution));
}
