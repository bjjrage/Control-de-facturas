import type { WorkbookCell } from "./types";

export function numericCellRaw(cell: WorkbookCell | undefined): WorkbookCell["raw"] {
  return cell && !["e", "b", "d"].includes(cell.type ?? "") ? cell.raw : null;
}

export function rawNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  // Never manufacture a number by deleting arbitrary text. Single groups
  // of three digits are ambiguous unless the integer part is zero.
  let normalized = value.trim();
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+$/.test(normalized)) {
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  normalized = normalized.replace(/^(?:Gs\.?|PYG|USD|\$)\s*/i, "").trim();
  if (!/^[+-]?[\d.,]+$/.test(normalized)) return null;
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const grouped = decimal === "," ? /^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/ : /^[+-]?\d{1,3}(?:,\d{3})+\.\d+$/;
    if (!grouped.test(normalized)) return null;
    normalized = decimal === "," ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
  } else if (lastComma >= 0) {
    if (/^[+-]?\d{1,3}(?:,\d{3}){2,}$/.test(normalized)) normalized = normalized.replace(/,/g, "");
    else {
      if (!/^[+-]?\d+,\d+$/.test(normalized)) return null;
      if (/^[+-]?[1-9]\d*,\d{3}$/.test(normalized)) return null;
      normalized = normalized.replace(",", ".");
    }
  } else {
    if (/^[+-]?\d{1,3}(?:\.\d{3}){2,}$/.test(normalized)) normalized = normalized.replace(/\./g, "");
    else if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized) || /^[+-]?[1-9]\d*\.\d{3}$/.test(normalized)) return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

