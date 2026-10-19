export type SpreadsheetNumberFormat = "strict" | "py";

/** Explicit Paraguay locale only. Numeric workbook cells keep their value. */
export function parseParaguayNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/^(?:gs\.?|pyg)\s*|\s*(?:gs\.?|pyg)$/gi, "");
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(text)) return null;
  const value = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
}
