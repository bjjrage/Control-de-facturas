import type { CurrencyCode } from "@/lib/types";
import type { FlujoItem } from "@/lib/flujo-caja";
import { ocurrenciasGastoRecurrente } from "@/lib/flujo-caja";
import { orderRemaining } from "@/lib/reconciliation";
import { addCashDays, businessToday, dateOnly, financialWindow } from "./dates";
import { derivePlanningCash } from "./planning";
import { money, nonnegative, type CashflowSources, type SourceRow } from "./types";
export function validateSources(s: CashflowSources, empresaId: string) {
    if (!s || s.empresa_id !== empresaId || !s.read_at)
        throw new Error("Fuentes financieras de otra empresa o no disponibles");
    dateOnly(s.from);
    dateOnly(s.until);
    if (s.until < s.from)
        throw new Error("Ventana financiera invertida");
    for (const key of ["accounts", "expenses", "projects", "sales", "receipts", "certificates", "orders", "invoices", "invoice_links", "payments", "payment_links", "movements", "labor_payments", "subcontracts", "planning"] as const)
        if (!Array.isArray(s[key]))
            throw new Error(`Fuente financiera ausente: ${key}`);
    const projects = new Set(s.projects.map(p => p.id));
    for (const a of s.accounts) {
        currency(a.moneda);
        money(a.saldo);
    }
    for (const row of [...s.certificates, ...s.subcontracts])
        if (!row.project_id || !projects.has(row.project_id))
            throw new Error("Fuente contractual fuera de la empresa");
    for (const o of s.orders) {
        currency(o.currency);
        if (!Array.isArray(o.items))
            throw new Error("Detalle de compromiso no disponible");
        for (const i of o.items)
            if (i.empresa_id !== empresaId || i.order_id !== o.id)
                throw new Error("Detalle de OC fuera de contexto");
    }
    for (const l of s.invoice_links) {
        const invoice = s.invoices.find(i => i.id === l.invoice_id), order = s.orders.find(o => o.id === l.authorized_order_id);
        if (!invoice || !order || invoice.currency !== order.currency)
            throw new Error("Provenance o moneda de factura/OC incompatible");
    }
    for (const key of ["accounts", "expenses", "projects", "sales", "receipts", "orders", "invoices", "invoice_links", "payments", "payment_links", "movements", "labor_payments"] as const) {
        for (const row of s[key]) {
            if (row.empresa_id !== empresaId)
                throw new Error("Fila financiera fuera de la empresa");
            if ("project_id" in row && row.project_id && !projects.has(String(row.project_id)))
                throw new Error("Proyecto financiero fuera de la empresa");
        }
    }
    for (const p of s.planning) {
        if (!projects.has(p.project_id))
            throw new Error("Plan de otra obra");
        for (const { plan } of p.plans)
            if (plan.empresa_id !== empresaId || plan.project_id !== p.project_id)
                throw new Error("Contexto del plan inválido");
        for (const key of ["budget", "bom", "labor", "equipment", "subcontracts", "execution", "certificates", "certificate_items", "project_stock", "central_stock", "reservations", "orders", "products", "adopted_prices", "observations"] as const) {
            if (!Array.isArray(p.facts[key]))
                throw new Error(`Fuente de planificación ausente: ${key}`);
            for (const r of p.facts[key]) {
                if ("empresa_id" in r && r.empresa_id !== empresaId)
                    throw new Error("Fuente de otra empresa");
                if ("project_id" in r && r.project_id && r.project_id !== p.project_id && key !== "reservations")
                    throw new Error("Fuente de otra obra");
            }
        }
        const budgetIds = new Set(p.facts.budget.map(b => b.id));
        for (const entry of p.plans)
            for (const target of entry.targets)
                if (!budgetIds.has(target.budget_item_id))
                    throw new Error("Partida de presupuesto fuera del contexto");
    }
}
export function currency(value: unknown): CurrencyCode {
    if (!["PYG", "USD", "EUR", "BRL", "ARS"].includes(String(value)))
        throw new Error("Moneda financiera desconocida");
    return value as CurrencyCode;
}
function factualDate(value: unknown): string | null {
    if (value == null) return null;
    const raw = String(value);
    if (raw.includes("T")) {
        const timestamp = new Date(raw);
        if (!Number.isFinite(timestamp.getTime())) throw new Error("Fecha financiera inválida");
        return businessToday(timestamp);
    }
    return dateOnly(raw);
}
/** Same accumulation as recompute_order_status, derived in this statement
 * snapshot so an outdated cached facturado_amount cannot duplicate a payable. */
export function cashflowOrders(s: CashflowSources): SourceRow[] {
    return s.orders.map(o => ({ ...o, facturado_amount: s.invoice_links.filter(l => l.authorized_order_id === o.id)
            .reduce((n, l) => n + nonnegative(s.invoices.find(i => i.id === l.invoice_id)!.total), 0) }));
}
/** Pure, auditable read model: only remaining OC amounts + invoices once,
 * receipts never add cash, RFQs are not obligations. Actuals stay separate. */
export function buildCanonicalCashflow(s: CashflowSources, empresaId: string): FlujoItem[] {
    validateSources(s, empresaId);
    const items: FlujoItem[] = [];
    const add = (r: SourceRow, tipo: FlujoItem["tipo"], amount: number, moneda: unknown, date: string | null, certainty: NonNullable<FlujoItem["certainty"]>, source: string, projectId: string | null = r.project_id ?? null, basis: FlujoItem["date_basis"] = "FACTUAL", suffix = "") => {
        if (!Number.isFinite(amount))
            throw new Error("Importe de caja inválido");
        if (amount === 0)
            return;
        items.push({ tipo, descripcion: `${source}: ${r.code ?? r.invoice_number ?? r.descripcion ?? r.numero ?? r.crew_name ?? r.id}${suffix}`, fecha: date, monto: amount, moneda: currency(moneda), project_id: projectId, ref_id: `${source}:${r.id}${suffix}`, empresa_id: empresaId, certainty, source_type: source, source_id: r.id, source_at: s.read_at, date_basis: date === null ? "UNKNOWN" : basis });
    };
    const orders = new Map(s.orders.map(o => [o.id, o]));
    // Current domain enforces invoice→one order. Ambiguous legacy links stay
    // company-scoped rather than charging an entire invoice to multiple projects.
    const invoiceProject = (id: string) => {
        const links = s.invoice_links.filter(l => l.invoice_id === id);
        const ids = new Set(links.map(l => orders.get(l.authorized_order_id)?.project_id ?? null));
        return ids.size === 1 ? [...ids][0] as string | null : null;
    };
    const executed = new Map(s.payments.filter(p => p.status === "EJECUTADA").map(p => [p.id, p]));
    const opMovements = new Set(s.movements.filter(m => m.payment_order_id).map(m => m.payment_order_id));
    for (const d of s.sales) {
        if (!["EMITIDA", "COBRADA_PARCIAL"].includes(d.status))
            continue;
        const remaining = Math.max(0, nonnegative(d.total) - nonnegative(d.cobrado_amount));
        // Attribution only from an existing certificate FK, never provider/client.
        const certificate = s.certificates.find(c => c.id === d.certificate_id);
        add(d, "cobro_factura", remaining, d.currency, factualDate(d.due_date), "COMMITTED", "SALES_DOCUMENT", certificate?.project_id ?? null);
    }
    for (const c of s.certificates) {
        if (!["APROBADO", "FACTURADO"].includes(c.status) || (c.sales_documents ?? []).some((d: SourceRow) => d.status !== "ANULADA"))
            continue;
        const base = factualDate(c.status === "FACTURADO" ? (c.facturado_at ?? c.period_end) : (c.aprobado_at ?? c.period_end));
        add(c, "cobro_certificado", nonnegative(c.monto_liquido), "PYG", base ? addCashDays(base, 30) : null, "COMMITTED", "CERTIFICATE", c.project_id, "PLANNING_FALLBACK");
    }
    for (const inv of s.invoices) {
        const link = s.payment_links.find(l => l.invoice_id === inv.id && executed.has(l.payment_order_id));
        const op = link ? executed.get(link.payment_order_id) : null;
        if (inv.status === "PAGADO" || op) {
            // If treasury exists it is the actual cash event; no second paid-invoice
            // event. OP without account still proves settlement, with executed_at.
            if (!op || !opMovements.has(op.id))
                add(inv, "pago_factura", -nonnegative(inv.total), inv.currency, factualDate(op?.executed_at), "ACTUAL", "SETTLED_INVOICE", invoiceProject(inv.id));
        }
        else
            add(inv, "pago_factura", -nonnegative(inv.total), inv.currency, factualDate(inv.due_date), "COMMITTED", "INVOICE", invoiceProject(inv.id));
    }
    for (const o of cashflowOrders(s)) {
        const remaining = Math.max(0, orderRemaining(nonnegative(o.total_price), nonnegative(o.facturado_amount)));
        // Terms are free text; no due date can safely be parsed from them. Receiving
        // material or issuing an OP cannot create another committed cash line.
        add(o, "salida_proyectada_material", -remaining, o.currency, null, "COMMITTED", "AUTHORIZED_ORDER");
    }
    for (const m of s.movements) {
        if (m.transferencia_id)
            continue; // internal transfer isn't operational cash-out.
        const links = m.payment_order_id ? s.payment_links.filter(l => l.payment_order_id === m.payment_order_id) : [];
        const projects = new Set(links.map(l => invoiceProject(l.invoice_id)));
        const receiptProject = m.sales_receipt_id ? s.receipts.find(r=>r.id===m.sales_receipt_id)?.project_id : null;
        const project = m.project_id ?? receiptProject ?? (projects.size === 1 ? [...projects][0] : null);
        add(m, money(m.monto) >= 0 ? "cobro_factura" : "pago_factura", money(m.monto), m.currency, factualDate(m.fecha), "ACTUAL", "TREASURY", project as string | null);
    }
    const bankReceipts = new Set(s.movements.filter(m => m.sales_receipt_id).map(m => m.sales_receipt_id));
    for (const r of s.receipts)
        if (!r.reversed_at && !bankReceipts.has(r.id))
            add(r, "cobro_factura", nonnegative(r.amount), r.currency, factualDate(r.receipt_date), "ACTUAL", "SALES_RECEIPT");
    for (const p of s.labor_payments)
        add(p, "salida_plan_mano_de_obra", -nonnegative(p.amount), "PYG", null, "ACTUAL", "LABOR_PAYMENT");
    for (const c of s.subcontracts) {
        if (c.status === "CANCELADO")
            continue;
        const approved = (c.certificates ?? []).filter((x: SourceRow) => ["APROBADO", "PAGADO"].includes(x.status));
        const certified = approved.reduce((n: number, x: SourceRow) => n + nonnegative(x.approved_amount), 0);
        const retention = approved.reduce((n: number, x: SourceRow) => n + nonnegative(x.retention_amount), 0);
        add(c, "salida_plan_subcontrato", -Math.max(0, nonnegative(c.contracted_amount) - certified + retention), "PYG", null, "COMMITTED", "SUBCONTRACT");
        for (const cert of approved)
            add(cert, "salida_plan_subcontrato", -nonnegative(cert.net_payable), "PYG", null, cert.status === "PAGADO" ? "ACTUAL" : "COMMITTED", "SUBCONTRACT_CERTIFICATE", c.project_id);
    }
    const recurringUntil = new Date(`${addCashDays(s.until, 1)}T00:00:00Z`);
    for (const g of s.expenses.filter(g => g.activo)) {
        // No invented "today" when both scheduling fields are unknown.
        if (!g.proximo_vencimiento && !g.dia_del_mes) {
            add(g as unknown as SourceRow, "gasto_recurrente", -nonnegative(g.monto_estimado), g.moneda, null, "PLANNED", "RECURRING_EXPENSE");
            continue;
        }
        for (const occurrence of ocurrenciasGastoRecurrente(nonnegative(g.monto_estimado), g.periodicidad, g.dia_del_mes, g.proximo_vencimiento, recurringUntil, new Date(`${s.from}T00:00:00Z`)))
            add(g as unknown as SourceRow, "gasto_recurrente", -occurrence.monto, g.moneda, occurrence.fecha, "PLANNED", "RECURRING_EXPENSE", g.project_id, "PLANNING_FALLBACK", `:${occurrence.fecha}`);
    }
    items.push(...derivePlanningCash(s));
    return items;
}
export function summarizeCashflow(items: FlujoItem[], from: string, until: string, projectId: string | null = null) {
    const scoped = items.filter(i => projectId === null || i.project_id === projectId);
    const window = financialWindow(scoped, from, until);
    const totals: Partial<Record<CurrencyCode, {
        planned: number;
        committed: number;
        actual: number;
        inflow: number;
        outflow: number;
    }>> = {};
    for (const i of scoped) {
        const t = totals[i.moneda] ??= { planned: 0, committed: 0, actual: 0, inflow: 0, outflow: 0 };
        if (i.certainty === "ACTUAL") {
            if (i.fecha && i.fecha >= from && i.fecha <= until)
                t.actual += i.monto;
            continue;
        }
        if (!window.includes(i))
            continue;
        if (i.certainty === "PLANNED")
            t.planned += i.monto;
        else
            t.committed += i.monto;
        if (i.monto >= 0)
            t.inflow += i.monto;
        else
            t.outflow -= i.monto;
    }
    return { totals, items: window, undated: scoped.filter(i => !i.fecha), actual: scoped.filter(i => i.certainty === "ACTUAL") };
}
