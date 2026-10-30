import type { PlanillaColumn, PlanillaRow } from "./types";
export function meaningfulDraftRows<T extends PlanillaRow>(rows: T[], columns: PlanillaColumn[]): T[] {
  const editable = columns.filter(c => !c.readOnly && c.type !== "readonly-numeric");
  return rows.filter(r => !r._rowId.startsWith("new:") || r._deleted || editable.some(c =>
    (r[c.key] != null && r[c.key] !== "") || !!r._formulas?.[c.key]));
}
/** Ignores generated totals and spare rows when checking real edits. */
export function draftSignature(rows: PlanillaRow[], columns: PlanillaColumn[]): string {
  const editable = columns.filter(c => !c.readOnly && c.type !== "readonly-numeric");
  return JSON.stringify(rows.filter(r => r._deleted || editable.some(c => r[c.key] != null && r[c.key] !== ""))
    .map(r => [r._rowId, !!r._deleted, r._style ?? null,
      ...editable.map(c => [r[c.key] ?? null, r._formulas?.[c.key] ?? null, (r._cellStyles as Record<string, unknown> | undefined)?.[c.key] ?? null])]));
}
