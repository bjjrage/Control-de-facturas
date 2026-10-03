import { normalizeUnit } from "@/lib/bim/matching";
import { isValidIsoDay } from "@/lib/projects/schedule";

/** Quantities with no factual representation must never turn into zero demand. */
export function physicalNumber(value: unknown, label: string, minimum = 0): number {
  if (value === null || value === undefined || value === "" || typeof value === "boolean")
    throw new Error(`${label}: cantidad no definida.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < minimum || n >= 1e16)
    throw new Error(`${label}: cantidad inválida.`);
  return n;
}

/** Exact named units are allowed; aliases reuse the existing BIM unit vocabulary.
 * This compares units, never converts kg into bags, metres into area, or invents ratios. */
export function samePhysicalUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return (normalizeUnit(a) ?? a.trim().toLowerCase()) ===
    (normalizeUnit(b) ?? b.trim().toLowerCase());
}

export function assertWeeklyPeriod(start: string, end: string): void {
  if (!isValidIsoDay(start) || !isValidIsoDay(end) || end < start)
    throw new Error("Período de planificación inválido.");
}

export function assertWeeklyTargets(items: Array<{ inputMode: string; inputValue: number; budgetItemId: string }>): void {
  if (!Array.isArray(items) || items.length > 50000) throw new Error("Metas inválidas.");
  for (const item of items) {
    if (!item?.budgetItemId || !["QUANTITY", "CONTRACT_PERCENTAGE_POINTS"].includes(item.inputMode))
      throw new Error("Meta o modo de planificación inválido.");
    physicalNumber(item.inputValue, "Meta");
  }
}
