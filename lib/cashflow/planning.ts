import type { FlujoItem } from "@/lib/flujo-caja";
import type { CostObservation } from "@/lib/cost-engine/types";
import { resolveProjectPriceSemantics } from "@/lib/costing/project-prices";
import { calculateWeeklyPlanRequirements, type PlanHourLineInput, type PlanSubcontractLineInput } from "@/lib/procurement/weekly-plan-engine";
import { selectBaselineCertificate, computeBaselineWithDeltas } from "@/lib/procurement/weekly-plan-shared";
import { allocateMaterialCoverage, isTimelyInbound } from "@/lib/procurement/mrp-coverage";
import { samePhysicalUnit } from "@/lib/procurement/weekly-plan-validation";
import { addCashDays } from "./dates";
import { nonnegative, type CashflowSources } from "./types";
import type { BudgetItemMaterialInput } from "@/lib/procurement/progress-forecast-engine";
/** Reuses B07/B08 quantities and physical coverage. Late/undated OC remain
 * separate financial commitments and cannot erase a plan's physical shortage. */
export function derivePlanningCash(s: CashflowSources): FlujoItem[] {
    const out: FlujoItem[] = [];
    const centralUsed: Record<string, number> = {};
    // All projects share one tenant central pool; order by period before project.
    const ordered = s.planning.flatMap(p => p.plans.map(w => ({ ...w, context: p })))
        .sort((a, b) => String(a.plan.start_date).localeCompare(String(b.plan.start_date)) || a.plan.id.localeCompare(b.plan.id));
    const contexts = new Map(s.planning.map(context => {
        const f = context.facts;
        const base = selectBaselineCertificate(f.certificates);
        const executed = computeBaselineWithDeltas({ budgetItems: f.budget, baselineCertificate: base as Parameters<typeof computeBaselineWithDeltas>[0]["baselineCertificate"], certificateItems: f.certificate_items, executionEntries: f.execution as Parameters<typeof computeBaselineWithDeltas>[0]["executionEntries"] }).executedQuantities;
        const stock: Record<string, number> = {};
        for (const r of f.project_stock)
            stock[r.producto_id] = (stock[r.producto_id] ?? 0) + nonnegative(r.quantity);
        const supply: { producto_id: string; remaining: number; expected_delivery_date: string | null }[] = [];
        for (const o of s.orders.filter(o => o.project_id === context.project_id && o.status === "AUTORIZADO")) {
            for (const i of o.items ?? [])
                if (i.producto_id)
                    supply.push({ producto_id: i.producto_id, remaining: Math.max(0, nonnegative(i.quantity) - nonnegative(i.received)), expected_delivery_date: i.expected_delivery_date == null ? null : String(i.expected_delivery_date) });
        }
        return [context.project_id, { executed, stock, supply }] as const;
    }));
    const paidLaborUsed = new Map<string, number>();
    const contractedUsed = new Map<string, number>();
    for (const { plan, targets, context } of ordered) {
        const f = context.facts, state = contexts.get(context.project_id)!;
        const materials: Record<string, BudgetItemMaterialInput[]> = {};
        for (const b of f.bom) {
            const product = f.products.find(p => p.id === b.producto_id);
            if (!product?.unidad)
                throw new Error("BOM sin producto o unidad factual");
            for (const row of [...f.project_stock, ...f.central_stock])
                if (row.producto_id === product.id && !samePhysicalUnit(row.unidad, product.unidad))
                    throw new Error("Unidad de stock incompatible con BOM");
            for (const o of s.orders.filter(o => o.project_id === context.project_id))
                for (const i of o.items ?? [])
                    if (i.producto_id === product.id && !samePhysicalUnit(i.unit, product.unidad))
                        throw new Error("Unidad de suministro incompatible con BOM");
            const adopted = f.adopted_prices.find(p => p.producto_id === b.producto_id);
            const observations: CostObservation[] = f.observations.filter(o => o.producto_id === b.producto_id && o.fecha_observacion <= s.from).map(o => ({
                id: o.id, empresaId: s.empresa_id, productoId: b.producto_id, fuente: o.fuente, descripcionItem: o.descripcion_item,
                categoriaInsumo: o.categoria_insumo, cantidad: nonnegative(o.cantidad), unidad: o.unidad, precioUnitario: o.precio_unitario == null ? null : nonnegative(o.precio_unitario),
                moneda: "PYG", fechaObservacion: o.fecha_observacion, estadoEvidencia: o.estado_evidencia, esVolatil: o.es_volatil,
            }));
            const price = resolveProjectPriceSemantics({ adoptedPrice: adopted ? { precio: nonnegative(adopted.precio_unitario), fuente: adopted.fuente, adopted: true, quoteVersionItemId: adopted.quote_version_item_id, adoptedAt: adopted.updated_at, adoptedBy: adopted.updated_by } : null,
                purchaseObservations: observations, inventoryCpp: product.costo_promedio == null ? null : nonnegative(product.costo_promedio), today: s.from }).price;
            (materials[b.budget_item_id] ??= []).push({ budget_item_id: b.budget_item_id, producto_id: product.id, producto_nombre: product.nombre, unidad_medida: product.unidad,
                cantidad_por_unidad_ejecutada: nonnegative(b.cantidad_por_unidad_ejecutada), desperdicio_pct: nonnegative(b.desperdicio_pct), costo_unitario: price?.precio ?? null });
        }
        const hours = (rows: typeof f.labor, label: string): Record<string, PlanHourLineInput[]> => {
            const result: Record<string, PlanHourLineInput[]> = {};
            for (const r of rows)
                (result[r.budget_item_id] ??= []).push({ label: String(r[label]), horas_por_unidad: nonnegative(r.horas_por_unidad_ejecutada), costo_hora: nonnegative(r.costo_hora) });
            return result;
        };
        const sub: Record<string, PlanSubcontractLineInput[]> = {};
        for (const r of f.subcontracts)
            (sub[r.budget_item_id] ??= []).push({ label: r.descripcion, precio_por_unidad: nonnegative(r.precio_por_unidad) });
        const calc = calculateWeeklyPlanRequirements({ plan_id: plan.id, project_id: context.project_id, start_date: plan.start_date, end_date: plan.end_date, status: plan.status,
            budget_items: f.budget, targets, executed_quantities_by_item: state.executed, materials_by_item: materials,
            labor_by_item: hours(f.labor, "rol"), equipment_by_item: hours(f.equipment, "tipo_equipo"), subcontracts_by_item: sub,
            stock_and_inbound: Object.fromEntries(Object.entries(state.stock).map(([id, q]) => [id, { producto_id: id, stock_disponible: q, oc_inbound: 0 }])) });
        if (calc.unconfigured_materials_count > 0)
            throw new Error(`Plan ${plan.id}: BOM incompleto; caja no disponible`);
        const central: Record<string, number> = {};
        for (const row of f.central_stock)
            central[row.producto_id] = (central[row.producto_id] ?? 0) + nonnegative(row.quantity);
        for (const r of f.reservations) {
            // Only this plan's reservations become assignable to this plan.
            if (r.weekly_plan_id !== plan.id)
                central[r.producto_id] = Math.max(0, (central[r.producto_id] ?? 0) - nonnegative(r.quantity));
        }
        for (const id of Object.keys(central))
            central[id] = Math.max(0, central[id] - (centralUsed[id] ?? 0));
        // B08's saved-plan default need date is END (not the cash fallback START+7).
        // Keep dated line balances so later plans can use supply ineligible now.
        const eligibleSupply = state.supply.filter(i => isTimelyInbound(i.expected_delivery_date, plan.end_date));
        const validInbound: Record<string, number> = {};
        for (const i of eligibleSupply)
            validInbound[i.producto_id] = (validInbound[i.producto_id] ?? 0) + i.remaining;
        const coverage = allocateMaterialCoverage({ gross: calc.items.flatMap(i => i.materials.map(m => ({ producto_id: m.producto_id, producto_nombre: m.producto_nombre, unidad_medida: m.unidad_medida, costo_unitario: m.costo_unitario, requerido: m.demanda_bruta, cubierto_obra: m.cubierto_por_stock }))), centralAvailableByProduct: central, validInboundByProduct: validInbound });
        const emit = (tipo: FlujoItem["tipo"], amount: number, date: string, ref: string, quantity?: number) => {
            if (amount <= 0)
                return;
            out.push({ tipo, descripcion: `Plan ${plan.start_date} (${plan.status}) · ${ref}`, fecha: date, monto: -amount, moneda: "PYG", project_id: context.project_id, ref_id: `plan:${plan.id}:${ref}`, empresa_id: s.empresa_id, certainty: "PLANNED", source_type: "WEEKLY_PLAN", source_id: plan.id, quantity, source_at: s.read_at, date_basis: "PLANNING_FALLBACK" });
        };
        for (const line of coverage.lines) {
            state.stock[line.producto_id] = Math.max(0, (state.stock[line.producto_id] ?? 0) - line.cubierto_obra);
            let inboundUsed = line.cubierto_inbound;
            for (const i of eligibleSupply.filter(i => i.producto_id === line.producto_id)) {
                const used = Math.min(inboundUsed, i.remaining);
                i.remaining -= used;
                inboundUsed -= used;
            }
            // Reservations already reduce the free pool for other plans: consuming a
            // plan's own reservation must not also reduce that same free pool.
            const own = f.reservations.filter(r => r.weekly_plan_id === plan.id && r.producto_id === line.producto_id).reduce((n, r) => n + nonnegative(r.quantity), 0);
            centralUsed[line.producto_id] = (centralUsed[line.producto_id] ?? 0) + Math.max(0, line.cubierto_central - own);
            if (line.comprar > 0 && line.caja === null)
                throw new Error(`Precio no disponible: ${line.producto_nombre}`);
            emit("salida_proyectada_material", line.caja ?? 0, addCashDays(plan.start_date, 7), `${line.producto_id}: ${line.producto_nombre}`, line.comprar);
        }
        // Resource facts supersede only proven budget/period links. Never match by
        // provider name, description or amount alone.
        for (const item of calc.items) {
            const bid = item.budget_item_id, q = item.target_quantity;
            state.executed[bid] = (state.executed[bid] ?? 0) + q;
            const labor = (hours(f.labor, "rol")[bid] ?? []).reduce((n, r) => n + q * r.horas_por_unidad * r.costo_hora, 0);
            const factual = s.labor_payments.filter(r => r.project_id === context.project_id && r.budget_item_id === bid && r.period_from <= plan.end_date && r.period_to >= plan.start_date);
            let laborResidual = labor;
            for (const r of factual) {
                const available = Math.max(0, nonnegative(r.amount) - (paidLaborUsed.get(r.id) ?? 0));
                const used = Math.min(laborResidual, available);
                laborResidual -= used;
                paidLaborUsed.set(r.id, (paidLaborUsed.get(r.id) ?? 0) + used);
            }
            emit("salida_plan_mano_de_obra", laborResidual, plan.end_date, `${bid}:mano de obra`);
            emit("salida_plan_equipo", (hours(f.equipment, "tipo_equipo")[bid] ?? []).reduce((n, r) => n + q * r.horas_por_unidad * r.costo_hora, 0), plan.end_date, `${bid}:equipos`);
            let subcontract = (sub[bid] ?? []).reduce((n, r) => n + q * r.precio_por_unidad, 0);
            for (const c of s.subcontracts.filter(c => c.project_id === context.project_id && c.budget_item_id === bid && c.status !== "CANCELADO")) {
                const available = Math.max(0, nonnegative(c.contracted_amount) - (contractedUsed.get(c.id) ?? 0));
                const used = Math.min(subcontract, available);
                subcontract -= used;
                contractedUsed.set(c.id, (contractedUsed.get(c.id) ?? 0) + used);
            }
            emit("salida_plan_subcontrato", subcontract, addCashDays(plan.end_date, 30), `${bid}:subcontratos`);
        }
    }
    return out;
}
