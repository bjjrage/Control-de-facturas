import { requireProfile, type CurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DashboardIconKey } from "./icon-map";
import type { AttentionAlert, MetricCardData } from "@/lib/dashboard/types";
import {
  computeAdminKpis,
  computeAdminSecondaryKpis,
  type RawCuentaFinancieraForKpi,
  type RawInvoiceForKpi,
  type RawOrderForKpi,
  type RawReceiptForKpi,
  type RawSalesDocForKpi,
} from "@/lib/dashboard/admin-kpis";
import { generateAttentionAlerts } from "@/lib/dashboard/attention-alerts";
import { planMeetsMinimum } from "@/lib/plans";
import type { AlertSourcesInput } from "@/lib/dashboard/attention-alerts";
import { loadCanonicalCashflow, readAll } from "@/lib/cashflow/load";
import { addCashDays, businessToday, financialWindow } from "@/lib/cashflow/dates";
import { cashflowOrders, summarizeCashflow } from "@/lib/cashflow/model";
import { formatMoney } from "@/lib/format";
import type { CurrencyCode } from "@/lib/types";

type ReceiptQueryRow = {
  id: string;
  amount: number;
  receipt_date: string;
  sales_document_id: string;
  sales_documents?: { currency?: string | null } | { currency?: string | null }[] | null;
};

type InvoiceJobRow = { id: string; status: string };
type ProductAlertRow = AlertSourcesInput["productos"][number];
type ProductQueryRow = Omit<ProductAlertRow, "stock_actual"> & { id: string };
type CanonicalStockRow = { producto_id: string; quantity: number };
type WorkOrderRow = { id: string; status: string };

function todayIso(): string {
  return businessToday();
}

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Últimos 6 meses en formato "YYYY-MM" hasta el mes de today (para gráficos, solo visual).
function last6Months(todayIso: string): string[] {
  const [y, m] = todayIso.split("-").map(Number);
  const out: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export type MetricChip = {
  key: string;
  value: string;
  label: string;
  href: string;
  iconKey: DashboardIconKey;
  tone: "ok" | "warn" | "error";
};

export type SalesTrendPoint = {
  month: string;
  label: string;
  facturado: number;
  cobrado: number;
};

export type CashflowTrendPoint = {
  label: string;
  cobros: number;
  pagos: number;
};

export type DashboardViewData = {
  firstName: string;
  adminCards: MetricCardData[];
  secondaryAdminCards: MetricCardData[];
  // Series para gráficos (solo PYG, como las sparklines de los KPIs). Solo visual.
  salesTrend: SalesTrendPoint[];
  cashflowTrend: CashflowTrendPoint[];
  // Compatibilidad con la navegación keep-alive existente del shell.
  adminKpis: MetricChip[];
  attentionAlerts: AttentionAlert[];
  cashflowSummary: string[];
};

/**
 * Loader exclusivo del workspace Administración.
 *
 * No consulta licitaciones ni agregados del portfolio operativo.
 * El flujo de caja usa el read model financiero, incluidas necesidades operativas y
 * administrativas; el detalle de obras queda en el workspace Operativo.
 */
export async function getDashboardViewData(profile?: CurrentProfile): Promise<DashboardViewData> {
  const p = profile ?? (await requireProfile());
  const supabase = await createClient();
  const empresaId = p.empresa_id;
  const today = todayIso();
  const isAdminRole = p.role === "administracion" || p.role === "admin";
  const showInvoiceKpis = isAdminRole && (p.modulo_compras || p.is_super_admin);
  const showSalesKpis = isAdminRole && (p.modulo_ventas || p.is_super_admin);
  const canUseStock = showInvoiceKpis && planMeetsMinimum(p.plan, "pro", p.is_super_admin);
  const until=addCashDays(today,30);
  const cash = isAdminRole ? await loadCanonicalCashflow(supabase,empresaId,today,until) : null;
  const rows=async(table:string,select:string,filters:(q:any)=>any=(q)=>q)=>readAll<any>((from,to)=>filters(supabase.from(table).select(select,{count:"exact"}).eq("empresa_id",empresaId)).order("id").range(from,to));
  const [salesDocsData,receiptsData,productosData,canonicalStockData,invoiceJobsData,workOrdersData] = await Promise.all([
    showSalesKpis ? rows("sales_documents","id, code, total, cobrado_amount, currency, due_date, issue_date, status, doc_type, acceptance_status",q=>q.neq("status","ANULADA")) : [],
    showSalesKpis ? rows("sales_receipts","id, amount, receipt_date, sales_document_id, sales_documents!sales_document_id(currency)",q=>q.is("reversed_at",null)) : [],
    canUseStock ? rows("productos","id, nombre, stock_minimo, activo",q=>q.eq("activo",true)) : [],
    canUseStock ? readAll<CanonicalStockRow>((from,to)=>supabase.from("inventory_stock_global_quantity").select("producto_id, quantity",{count:"exact"}).eq("empresa_id",empresaId).order("producto_id").range(from,to)) : [],
    showInvoiceKpis ? rows("invoice_jobs","id, status",q=>q.in("status",["needs_review","failed"])) : [],
    showSalesKpis ? rows("work_orders","id, status",q=>q.in("status",["PENDIENTE","EN_CURSO"])) : [],
  ]);
  const invoices = (cash?.sources.invoices ?? []) as unknown as RawInvoiceForKpi[];
  const salesDocs = salesDocsData as RawSalesDocForKpi[];
  const receipts = (receiptsData as ReceiptQueryRow[]).map(row=>{
    const document=Array.isArray(row.sales_documents)?row.sales_documents[0]:row.sales_documents;
    if(!document?.currency) throw new Error("Moneda del cobro no disponible");
    return {id:row.id,amount:row.amount,receipt_date:row.receipt_date,sales_document_id:row.sales_document_id,currency:document.currency};
  }) as RawReceiptForKpi[];
  const cuentas = (cash?.sources.accounts ?? []) as RawCuentaFinancieraForKpi[];
  const orders = (cash ? cashflowOrders(cash.sources) : []) as unknown as RawOrderForKpi[];
  const stockByProduct = new Map<string, number>();
  for (const row of (canonicalStockData ?? []) as CanonicalStockRow[]) {
    stockByProduct.set(row.producto_id, (stockByProduct.get(row.producto_id) ?? 0) + row.quantity);
  }
  // Stock mínimo is compared against the canonical global balance (sum of
  // inventory_balances across all locations), never productos.stock_actual.
  const productos = ((productosData ?? []) as ProductQueryRow[]).map((product): ProductAlertRow => ({
    activo: product.activo,
    stock_minimo: product.stock_minimo,
    stock_actual: stockByProduct.get(product.id) ?? 0,
  }));
  const invoiceJobs = (invoiceJobsData ?? []) as InvoiceJobRow[];
  const workOrders = (workOrdersData ?? []) as WorkOrderRow[];
  const cashflowItems = financialWindow(cash?.items ?? [],today,until);
  const cashSummary=summarizeCashflow(cash?.items ?? [],today,until);
  const cashflowSummary=Object.entries(cashSummary.totals).map(([moneda,t])=>moneda+": planificado "+formatMoney(Math.abs(t.planned),moneda as CurrencyCode)+" \u00b7 comprometido neto "+formatMoney(t.committed,moneda as CurrencyCode)+" \u00b7 actual "+formatMoney(t.actual,moneda as CurrencyCode));
  if(cashSummary.undated.length) cashflowSummary.push(cashSummary.undated.length+" registros sin fecha factual; excluidos del total fechado.");
  // Serie ventas 6 meses en PYG (misma lógica/filtros que las sparklines de los KPIs).
  const salesTrend: SalesTrendPoint[] = last6Months(today).map((mm) => ({
    month: mm,
    label: MES_CORTO[Number(mm.slice(5, 7)) - 1] ?? mm,
    facturado: Math.round(
      salesDocs
        .filter(
          (d) =>
            d.doc_type === "FACTURA" &&
            d.status !== "BORRADOR" &&
            d.status !== "ANULADA" &&
            d.currency === "PYG" &&
            d.issue_date.startsWith(mm)
        )
        .reduce((acc, d) => acc + d.total, 0)
    ),
    cobrado: Math.round(
      receipts
        .filter((r) => (r.currency === "PYG" || !r.currency) && r.receipt_date.startsWith(mm))
        .reduce((acc, r) => acc + r.amount, 0)
    ),
  }));

  // Serie caja 30 días en PYG por semana (cobros = monto ≥ 0, pagos = |monto < 0|).
  const cashflowTrend: CashflowTrendPoint[] = [
    { label: "Sem 1", cobros: 0, pagos: 0 },
    { label: "Sem 2", cobros: 0, pagos: 0 },
    { label: "Sem 3", cobros: 0, pagos: 0 },
    { label: "Sem 4", cobros: 0, pagos: 0 },
  ];
  const todayDate = parseLocalDate(today);
  for (const item of cashflowItems) {
    if(!item.fecha) continue;
    if (item.moneda !== "PYG") continue;
    const diffDays = Math.floor((parseLocalDate(item.fecha).getTime() - todayDate.getTime()) / 86400000);
    const idx = Math.min(3, Math.max(0, Math.floor(diffDays / 7)));
    if (item.monto >= 0) cashflowTrend[idx].cobros += item.monto;
    else cashflowTrend[idx].pagos += Math.abs(item.monto);
  }
  for (const bucket of cashflowTrend) {
    bucket.cobros = Math.round(bucket.cobros);
    bucket.pagos = Math.round(bucket.pagos);
  }

  const adminCards = computeAdminKpis({
    todayIso: today,
    salesDocs,
    receipts,
    invoices,
    cuentas,
    orders,
    cashflowItems,
    showSalesKpis,
    showInvoiceKpis,
  }).filter(card => isAdminRole || card.key !== "flujo-neto-30d");

  const secondaryAdminCards = computeAdminSecondaryKpis({
    todayIso: today,
    salesDocs,
    invoices,
    cashflowItems,
    showSalesKpis,
    showInvoiceKpis,
  });

  const adminKpis: MetricChip[] = adminCards.map((card) => ({
    key: card.key,
    value: card.value,
    label: card.secondaryText ? `${card.title} · ${card.secondaryText}` : card.title,
    href: card.href,
    iconKey: card.iconKey,
    tone: card.tone === "neutral" ? "ok" : card.tone,
  }));

  const attentionAlerts = generateAttentionAlerts({
    todayIso: today,
    invoices,
    invoiceJobs,
    salesDocs,
    productos,
    stockSourceUnavailable: false,
    orders,
    workOrders,
    cuentas,
  });

  return {
    firstName: p.full_name.split(" ")[0],
    adminCards,
    secondaryAdminCards,
    salesTrend,
    cashflowTrend,
    adminKpis,
    attentionAlerts,
    cashflowSummary,
  };
}
