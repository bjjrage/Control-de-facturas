import type { PlanillaRow } from "./types";
import type { LinkedRecipes } from "@/lib/workbook-interpretation/linked-recipes";
import type { WorkspaceMaterial } from "@/lib/workbook-interpretation/import-workspace";
import { calcLineSubtotal } from "@/lib/format";

export type RelativeSchedule = LinkedRecipes["relativeSchedule"][number];
export type OperationalInputs = {
  schedules: Record<string, RelativeSchedule>;
  unitCosts: Record<string, number | null>;
  materials: WorkspaceMaterial[];
};
export type ProjectedMonth = { month: number; quantity: number | null; sale: number | null; cost: number | null };
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Reuse each item's verified distribution as weights. Dates and the source
 * workbook are a baseline; revised quantities and APU costs are live inputs. */
export function projectOperations(rows: PlanillaRow[], inputs: OperationalInputs) {
  const issues: string[] = [];
  const items = rows.filter(row => !row._deleted && String(row.description ?? "").trim()).map(row => {
    const quantity = number(row.quantity), price = number(row.unit_price), unitCost = number(inputs.unitCosts[row._rowId]);
    const sale = quantity === null || price === null ? null : calcLineSubtotal(quantity, price);
    const cost = quantity === null || unitCost === null ? null : quantity * unitCost;
    const schedule = inputs.schedules[row._rowId];
    const source = schedule?.monthlyValues ?? [];
    const sum = source.reduce((total, month) => total + month.value, 0);
    const valid = source.length > 0 && sum > 0 && source.every(month => Number.isInteger(month.month) && month.month > 0 && number(month.value) !== null) && new Set(source.map(month => month.month)).size === source.length;
    if (!valid && quantity !== 0) issues.push(`${String(row.code)}: falta una distribución mensual verificable.`);
    const months: ProjectedMonth[] = valid ? source.map(month => ({ month: month.month,
      quantity: quantity === null ? null : quantity * month.value / sum,
      sale: sale === null ? null : sale * month.value / sum,
      cost: cost === null ? null : cost * month.value / sum,
    })) : [];
    return { rowId: row._rowId, code: String(row.code ?? ""), description: String(row.description ?? ""), quantity, sale, cost, schedule, months };
  });
  const byId = new Map(items.map(item => [item.rowId, item]));
  const monthIds = [...new Set(items.flatMap(item => item.months.map(month => month.month)))].sort((a, b) => a - b);
  const months = monthIds.map(month => {
    const lines = items.flatMap(item => item.months.filter(line => line.month === month));
    const materials = inputs.materials.map(material => {
      let quantity: number | null = 0;
      for (const link of material.links) {
        const item = byId.get(link.rowId);
        if (!item) continue;
        const line = item.months.find(line => line.month === month);
        if (line && line.quantity === null) { quantity = null; break; }
        quantity += (line?.quantity ?? 0) * link.consumption;
      }
      return { key: material.key, description: material.description, unit: material.unit, quantity };
    }).filter(material => material.quantity === null || material.quantity > 0);
    return { month, sale: lines.some(line => line.sale === null) ? null : lines.reduce((total, line) => total + line.sale!, 0),
      cost: lines.some(line => line.cost === null) ? null : lines.reduce((total, line) => total + line.cost!, 0), materials };
  });
  return { items, months, issues,
    sale: items.some(item => item.sale === null) ? null : items.reduce((total, item) => total + item.sale!, 0),
    cost: items.some(item => item.cost === null) ? null : items.reduce((total, item) => total + item.cost!, 0),
  };
}
export type OperationalProjection = ReturnType<typeof projectOperations>;

export function projectMonthlyCurve(projection: OperationalProjection, executed: number[]) {
  if (projection.issues.length || projection.months.some(month => month.sale === null)) return [];
  let planned = 0, actual = 0;
  const series: { date: string; planificado: number; real: number | null }[] = [];
  for (const [index, month] of projection.months.entries()) {
    planned += month.sale!;
    if (executed[index] !== undefined) actual += executed[index];
    series.push({ date: `M${month.month}`, planificado: Math.round(planned), real: executed[index] !== undefined ? Math.round(actual) : null });
  }
  return series;
}
