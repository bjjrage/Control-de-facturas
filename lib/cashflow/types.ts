import type { BudgetItem, CuentaFinanciera, GastoRecurrente } from "@/lib/types";
import type { WeeklyPlanItemTargetInput } from "@/lib/procurement/weekly-plan-engine";
// DB JSON is checked for tenant, context, dates and numeric validity before derivation.
// Remaining columns preserve the existing source snapshot, never a client decision.
export interface SourceRow {
    id: string;
    empresa_id?: string;
    project_id?: string | null;
    [key: string]: any;
}
export interface PlanningSources {
    project_id: string;
    facts: {
        budget: BudgetItem[];
        bom: SourceRow[];
        labor: SourceRow[];
        equipment: SourceRow[];
        subcontracts: SourceRow[];
        execution: (SourceRow & {
            budget_item_id: string;
            quantity_executed?: number | null;
            entry_date?: string | null;
        })[];
        certificates: SourceRow[];
        certificate_items: (SourceRow & {
            certificate_id?: string;
            budget_item_id?: string | null;
            codigo?: string | null;
            qty_acumulada?: number | null;
        })[];
        project_stock: SourceRow[];
        central: SourceRow | null;
        central_stock: SourceRow[];
        reservations: SourceRow[];
        orders: SourceRow[];
        products: SourceRow[];
        adopted_prices: SourceRow[];
        observations: SourceRow[];
    };
    plans: {
        plan: SourceRow;
        targets: WeeklyPlanItemTargetInput[];
    }[];
}
export interface CashflowSources {
    empresa_id: string;
    read_at: string;
    from: string;
    until: string;
    accounts: CuentaFinanciera[];
    expenses: GastoRecurrente[];
    projects: SourceRow[];
    sales: SourceRow[];
    certificates: SourceRow[];
    orders: SourceRow[];
    invoices: SourceRow[];
    receipts: SourceRow[];
    invoice_links: SourceRow[];
    payments: SourceRow[];
    payment_links: SourceRow[];
    movements: SourceRow[];
    labor_payments: SourceRow[];
    subcontracts: SourceRow[];
    planning: PlanningSources[];
}
export function money(value: unknown): number {
    if (value === null || value === undefined || value === "" || typeof value === "boolean")
        throw new Error("Monto financiero no disponible");
    const n = Number(value);
    if (!Number.isFinite(n) || Math.abs(n) >= 1e16)
        throw new Error("Monto financiero inválido");
    return n;
}
export function nonnegative(value: unknown): number {
    const n = money(value);
    if (n < 0)
        throw new Error("Monto o cantidad negativa en la fuente financiera");
    return n;
}
