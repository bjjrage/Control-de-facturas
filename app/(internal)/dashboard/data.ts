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
import type { AlertSourcesInput } from "@/lib/dashboard/attention-alerts";
import {
  build30DayCashflowItems,
  type RawCertificateForCashflow,
  type RawGastoRecurrenteForCashflow,
} from "@/lib/dashboard/cashflow";

const PLAN_RANK = { basico: 0, pro: 1, caterpillar: 2 } as const;

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
  return new Date().toISOString().slice(0, 10);
}

export type MetricChip = {
  key: string;
  value: string;
  label: string;
  href: string;
  iconKey: DashboardIconKey;
  tone: "ok" | "warn" | "error";
};

export type DashboardViewData = {
  firstName: string;
  adminCards: MetricCardData[];
  secondaryAdminCards: MetricCardData[];
  // Compatibilidad con la navegación keep-alive existente del shell.
  adminKpis: MetricChip[];
  attentionAlerts: AttentionAlert[];
};

/**
 * Loader exclusivo del workspace Administración.
 *
 * No consulta licitaciones, proyectos ni agregados del portfolio operativo.
 * El flujo de caja del dashboard usa únicamente fuentes financieras y
 * administrativas; el detalle de obras queda en el workspace Operativo.
 */
export async function getDashboardViewData(profile?: CurrentProfile): Promise<DashboardViewData> {
  const p = profile ?? (await requireProfile());
  const supabase = await createClient();
  const empresaId = p.empresa_id;
  const today = todayIso();
  const isAdminRole = p.role === "administracion" || p.role === "admin";
  const showInvoiceKpis = isAdminRole && p.modulo_compras;
  const showSalesKpis = isAdminRole && p.modulo_ventas;
  const canUseStock = showInvoiceKpis && PLAN_RANK[p.plan] >= PLAN_RANK.pro;
  const noopRows = Promise.resolve({ data: [] as unknown[], error: null });

  const [
    { data: invoicesData },
    { data: salesDocsData },
    { data: receiptsData },
    { data: cuentasData },
    { data: ordersData },
    { data: gastosData },
    { data: productosData, error: productosError },
    { data: canonicalStockData, error: canonicalStockError },
    { data: invoiceJobsData },
    { data: workOrdersData },
    { data: certificadosData },
  ] = await Promise.all([
    showInvoiceKpis
      ? supabase
          .from("invoices")
          .select("id, invoice_number, total, currency, due_date, invoice_date, status, provider_id")
      : noopRows,
    showSalesKpis
      ? supabase
          .from("sales_documents")
          .select("id, code, total, cobrado_amount, currency, due_date, issue_date, status, doc_type, acceptance_status")
          .neq("status", "ANULADA")
      : noopRows,
    showSalesKpis
      ? supabase
          .from("sales_receipts")
          .select("id, amount, receipt_date, sales_document_id, sales_documents!sales_document_id(currency)")
          .is("reversed_at", null)
      : noopRows,
    isAdminRole
      ? supabase
          .from("cuentas_financieras")
          .select("id, nombre, tipo, moneda, saldo, activo")
          .eq("activo", true)
      : noopRows,
    showInvoiceKpis
      ? supabase
          .from("authorized_orders")
          .select("id, code, project_id, total_price, facturado_amount, currency, status")
      : noopRows,
    isAdminRole
      ? supabase
          .from("gastos_recurrentes")
          .select("id, descripcion, monto_estimado, periodicidad, dia_del_mes, proximo_vencimiento, moneda, activo, project_id")
          .eq("activo", true)
      : noopRows,
    canUseStock
      ? supabase
          .from("productos")
          .select("id, nombre, stock_minimo, activo")
          .eq("empresa_id", empresaId)
          .eq("activo", true)
      : noopRows,
    canUseStock
      ? supabase
          .from("inventory_stock_global_quantity")
          .select("producto_id, quantity")
          .eq("empresa_id", empresaId)
      : noopRows,
    showInvoiceKpis
      ? supabase.from("invoice_jobs").select("id, status").in("status", ["needs_review", "failed"])
      : noopRows,
    showSalesKpis
      ? supabase.from("work_orders").select("id, status").in("status", ["PENDIENTE", "EN_CURSO"])
      : noopRows,
    showSalesKpis
      ? supabase
          .from("project_certificates")
          .select("id, numero, project_id, monto_liquido, status, period_end, aprobado_at, facturado_at, sales_documents!certificate_id(id, status)")
          .in("status", ["APROBADO", "FACTURADO"])
      : noopRows,
  ]);

  const invoices = (invoicesData ?? []) as RawInvoiceForKpi[];
  const salesDocs = (salesDocsData ?? []) as RawSalesDocForKpi[];
  const receipts = ((receiptsData ?? []) as ReceiptQueryRow[]).map((row) => {
    const salesDocument = Array.isArray(row.sales_documents) ? row.sales_documents[0] : row.sales_documents;
    return {
    id: row.id,
    amount: row.amount,
    receipt_date: row.receipt_date,
    sales_document_id: row.sales_document_id,
    currency: salesDocument?.currency || "PYG",
    };
  }) as RawReceiptForKpi[];
  const cuentas = (cuentasData ?? []) as RawCuentaFinancieraForKpi[];
  const orders = (ordersData ?? []) as RawOrderForKpi[];
  const gastos = (gastosData ?? []) as RawGastoRecurrenteForCashflow[];
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
  const certificados = (certificadosData ?? []) as RawCertificateForCashflow[];

  const cashflowItems = build30DayCashflowItems({
    todayIso: today,
    ventaDocs: salesDocs.filter((doc) => doc.status === "EMITIDA" || doc.status === "COBRADA_PARCIAL"),
    certificados,
    comprasInv: invoices.filter((invoice) => invoice.status !== "PAGADO"),
    gastos,
  });

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
  });

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
    stockSourceUnavailable: canUseStock && (!!productosError || !!canonicalStockError),
    orders,
    workOrders,
    cuentas,
  });

  return {
    firstName: p.full_name.split(" ")[0],
    adminCards,
    secondaryAdminCards,
    adminKpis,
    attentionAlerts,
  };
}
