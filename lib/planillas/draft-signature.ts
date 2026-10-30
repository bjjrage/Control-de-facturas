import type { PlanillaColumn, PlanillaRow } from "./types";
function normalizedStyle(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return value;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalizedStyle(v)] as const).filter(([, v]) => v !== null);
  return entries.length ? Object.fromEntries(entries) : null;
}
export function meaningfulDraftRows<T extends PlanillaRow>(rows: T[], columns: PlanillaColumn[]): T[] {
  const editable = columns.filter(c => !c.readOnly && c.type !== "readonly-numeric");
  return rows.filter(r => !r._rowId.startsWith("new:") || r._deleted || editable.some(c =>
    (r[c.key] != null && r[c.key] !== "") || !!r._formulas?.[c.key]));
}
/** Ignores generated totals and spare rows when checking real edits. */
export function draftSignature(rows: PlanillaRow[], columns: PlanillaColumn[]): string {
  const editable = columns.filter(c => !c.readOnly && c.type !== "readonly-numeric");
  return JSON.stringify(rows.filter(r => r._deleted || editable.some(c => r[c.key] != null && r[c.key] !== ""))
    .map(r => [r._rowId, !!r._deleted, normalizedStyle(r._style),
      ...editable.map(c => [r[c.key] ?? null, r._formulas?.[c.key] ?? null, normalizedStyle((r._cellStyles as Record<string, unknown> | undefined)?.[c.key])])]));
}
