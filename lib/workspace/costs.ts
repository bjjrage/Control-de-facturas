import { z } from "zod";
import { computePartidaCosts, computeProjectCostTotals, type ResolvedPrice } from "@/lib/costing/cost-budget";
import { resolveProjectPriceSemantics } from "@/lib/costing/project-prices";
import type { CostObservation } from "@/lib/cost-engine/types";

const percent = z.number().finite().min(0).max(100);
export const legacyCostSettingsSchema = z.object({ indirectPct: percent, generalPct: percent,
  financingPct: percent, riskPct: percent, marginPct: percent.max(99) });
const chargeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("PERCENT"), value: percent }).strict(),
  z.object({ mode: z.literal("FIXED"), value: z.number().finite().min(0).max(1e15) }).strict(),
]);
export const costSettingsV2Schema = z.object({ schemaVersion: z.literal(2),
  indirect: chargeSchema, financing: chargeSchema, risk: chargeSchema,
  generalItems: z.array(z.object({ id: z.string().min(1).max(100), concept: z.string().trim().min(1).max(200),
    mode: z.enum(["PERCENT", "FIXED"]), value: z.number().finite().min(0).max(1e15),
  }).strict().refine(row => row.mode !== "PERCENT" || row.value <= 100)).max(100)
    .refine(rows => new Set(rows.map(row => row.id)).size === rows.length, "Identificadores de conceptos duplicados"),
  marginPct: percent.max(99),
}).strict();
export const costSettingsSchema = z.union([costSettingsV2Schema, legacyCostSettingsSchema.strict()]);
export type CostSettings = z.infer<typeof costSettingsSchema>;
export type CostSettingsV2 = z.infer<typeof costSettingsV2Schema>;
export const DEFAULT_COST_SETTINGS: z.infer<typeof legacyCostSettingsSchema> = { indirectPct: 0, generalPct: 0, financingPct: 0, riskPct: 0, marginPct: 0 };
/** Read V1 without mutating its immutable facts or silently changing percentage bases. */
export function normalizeCostSettings(raw: CostSettings): CostSettingsV2 {
  const settings = costSettingsSchema.parse(raw);
  if ("schemaVersion" in settings) return settings;
  return { schemaVersion: 2, indirect: { mode: "PERCENT", value: settings.indirectPct },
    financing: { mode: "PERCENT", value: settings.financingPct }, risk: { mode: "PERCENT", value: settings.riskPct },
    generalItems: [{ id: "legacy-general", concept: "Gastos generales (V1)", mode: "PERCENT", value: settings.generalPct }],
    marginPct: settings.marginPct };
}
export type FactRow = Record<string, any>;
export interface WorkspaceFacts {
  context: { kind: "TENDER"; id: string }; tender: FactRow; settings: CostSettings | null;
  items: FactRow[]; materials: FactRow[]; labor: FactRow[]; equipment: FactRow[]; subcontracts: FactRow[];
  prices: FactRow[]; products: FactRow[]; observations: FactRow[]; rfqs: FactRow[]; rfq_items: FactRow[];
  invitations: FactRow[]; quotes: FactRow[]; quote_versions: FactRow[]; quote_items: FactRow[]; reviews: FactRow[];
  bim_models: FactRow[]; bim_elements: FactRow[]; bim_matches: FactRow[]; competition: FactRow[]; asOf: string;
}
/** Percent bases are explicit: burdens on direct cost; margin on offered revenue. */
export function composeOffer(directCost: number, settings: CostSettings) {
  const normalized = normalizeCostSettings(settings);
  if (!Number.isFinite(directCost) || directCost <= 0) throw new Error("Costo directo positivo requerido.");
  const amount = (charge: { mode: "PERCENT" | "FIXED"; value: number }) => charge.mode === "PERCENT" ? directCost * charge.value / 100 : charge.value;
  const generalItems = normalized.generalItems.map(row => ({ ...row, base: row.mode === "PERCENT" ? directCost : null, result: amount(row) }));
  const indirect = amount(normalized.indirect), general = generalItems.reduce((sum, row) => sum + row.result, 0);
  const financing = amount(normalized.financing), risk = amount(normalized.risk);
  const totalCost = directCost + indirect + general + financing + risk;
  const offerAmount = Math.round(totalCost / (1 - normalized.marginPct / 100) * 100) / 100;
  if (!Number.isFinite(offerAmount) || offerAmount >= 1e16) throw new Error("Oferta fuera de rango.");
  return { directCost, indirect, general, financing, risk, totalCost, margin: offerAmount - totalCost, offerAmount,
    generalItems, marginPct: normalized.marginPct };
}

/** Calculate live and archived offers with the existing APU and pricing engines. */
export function computeWorkspaceCosts(facts: WorkspaceFacts) {
  const parentIds = new Set(facts.items.map(r => r.parent_id).filter(Boolean));
  const leaves = facts.items.filter(r => !parentIds.has(r.id));
  const prices = new Map<string, ResolvedPrice>();
  for (const product of facts.products) {
    const adopted = facts.prices.find(p => p.producto_id === product.id);
    const observations: CostObservation[] = facts.observations.filter(o => o.producto_id === product.id).slice(0,100).map(o => ({
      id: o.id, empresaId: o.empresa_id, productoId: o.producto_id, proveedorId: o.proveedor_id ?? undefined,
      documentoId: o.documento_id ?? undefined, fuente: o.fuente, descripcionItem: o.descripcion_item,
      categoriaInsumo: o.categoria_insumo, cantidad: Number(o.cantidad), unidad: o.unidad,
      precioUnitario: Number(o.precio_unitario), moneda: "PYG", fechaObservacion: o.fecha_observacion,
      esVolatil: o.es_volatil, estadoEvidencia: o.estado_evidencia,
    }));
    const semantics = resolveProjectPriceSemantics({ adoptedPrice: adopted ? { precio: Number(adopted.precio_unitario),
      fuente: adopted.fuente, quoteVersionItemId: adopted.quote_version_item_id, adoptedAt: adopted.updated_at, adoptedBy: adopted.updated_by } : null,
      purchaseObservations: observations, inventoryCpp: Number(product.costo_promedio) || null, today: facts.asOf });
    if (semantics.price) prices.set(product.id, semantics.price);
  }
  const inputs = leaves.map(r => ({ id: r.id, quantity: r.quantity == null ? null : Number(r.quantity), unitPrice: r.unit_price == null ? null : Number(r.unit_price) }));
  const costs = computePartidaCosts(inputs, {
    materials: facts.materials.map(r => ({ budgetItemId: r.budget_item_id, productoId: r.producto_id, cantidadPorUnidad: Number(r.cantidad_por_unidad_ejecutada), desperdicioPct: Number(r.desperdicio_pct) })),
    labor: facts.labor.map(r => ({ budgetItemId: r.budget_item_id, horasPorUnidad: Number(r.horas_por_unidad_ejecutada), costoHora: Number(r.costo_hora) })),
    equipment: facts.equipment.map(r => ({ budgetItemId: r.budget_item_id, horasPorUnidad: Number(r.horas_por_unidad_ejecutada), costoHora: Number(r.costo_hora) })),
    subcontracts: facts.subcontracts.map(r => ({ budgetItemId: r.budget_item_id, precioPorUnidad: Number(r.precio_por_unidad) })),
  }, prices);
  const totals = computeProjectCostTotals(inputs, costs);
  const measured = leaves.length > 0 && leaves.every(r => Number.isFinite(Number(r.quantity)) && Number(r.quantity)>0 && !!r.unit?.trim());
  const complete = measured && totals.completo && totals.costoTotal > 0;
  return { costs, totals, prices: Object.fromEntries(prices), complete,
    offer: complete ? composeOffer(totals.costoTotal, facts.settings ?? DEFAULT_COST_SETTINGS) : null };
}
