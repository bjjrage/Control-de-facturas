import type { CanonicalSchedulePlan } from "./canonical-import";
import type { LinkedRecipes } from "./linked-recipes";
import type { WorkbookBudgetItem } from "./types";

/** Aggregate the verified monetary item distribution, rather than selecting
 * an arbitrary stage percentage row proposed by the model. */
export function aggregateLinkedSchedule(items: WorkbookBudgetItem[], linked: LinkedRecipes): CanonicalSchedulePlan | null {
  if (!items.length || linked.relativeSchedule.length !== items.length) return null;
  const byCode = new Map(items.map(item => [item.code, item]));
  const months = new Map<number, number>();
  let total = 0;
  for (const schedule of linked.relativeSchedule) {
    const item = byCode.get(schedule.budgetCode);
    if (!item || item.quantity === null || item.unitPrice === null || !schedule.monthlyValues.length) return null;
    const expected = item.quantity * item.unitPrice;
    const sum = schedule.monthlyValues.reduce((n, month) => n + month.value, 0);
    const tolerance = Math.max(1e-6, Math.abs(expected) * Number.EPSILON * 100);
    if (schedule.monthlyValues.some(month => month.value < 0) || Math.abs(sum - expected) > tolerance) {
      linked.issues.push(`Cronograma ${schedule.budgetCode}: la distribución mensual no reproduce el importe documental de la partida.`);
      return null;
    }
    total += expected;
    for (const month of schedule.monthlyValues) months.set(month.month, (months.get(month.month) ?? 0) + month.value);
  }
  if (total <= 0) return null;
  const source = linked.relativeSchedule[0].source;
  return { planVersion: `Partidas · ${source.sheet}`, label: "Cronograma físico documentado · resumen de partidas", sheet: source.sheet, sourceRow: source.row,
    months: [...months].sort(([a], [b]) => a - b).map(([monthIndex, value]) => ({ monthIndex, programadoPct: value / total * 100 })), documentedExecuted: [] };
}
