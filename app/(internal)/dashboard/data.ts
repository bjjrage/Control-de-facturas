import { requireProfile, CurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Project, InvoiceStatus, SalesDocStatus, CurrencyCode } from "@/lib/types";
import type { PortfolioRow, PortfolioEstado } from "./portfolio-table";
import type { DashboardIconKey } from "./icon-map";
import type { MetricCardData, AttentionAlert } from "@/lib/dashboard/types";
import { computeAdminKpis, RawSalesDocForKpi, RawReceiptForKpi, RawInvoiceForKpi, RawCuentaFinancieraForKpi, RawOrderForKpi } from "@/lib/dashboard/admin-kpis";
import { generateAttentionAlerts } from "@/lib/dashboard/attention-alerts";
import { build30DayCashflowItems } from "@/lib/dashboard/cashflow";
import { computeTenderKpis, RawLicitacionForTenderKpi } from "@/lib/dashboard/tender-kpis";
import { assessTendersReadiness, RawEmpresaDocumento, RawLicitacionForReadiness, RawLicitacionDocumento } from "@/lib/dashboard/document-readiness";

const PLAN_RANK = { basico: 0, pro: 1, caterpillar: 2 } as const;

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export type DomainTone = "ok" | "warn" | "error";

export type MetricChip = {
  key: string;
  value: string;
  label: string;
  href: string;
  iconKey: DashboardIconKey;
  tone: DomainTone;
};

export type PanoramaObras = {
  obrasActivas: number;
  carteraActivaPyg: number;
  comprasRealizadasPyg: number;
  productosStockMinimo: number | null;
  desviosCosto: number;
  desviosPlazo: number;
  avanceFisicoPonderado: number;
  estadoBreakdown: { normal: number; atencion: number; riesgo: number };
};

const PORTFOLIO_TABLE_LIMIT = 5;
const ESTADO_PRIORITY: Record<PortfolioEstado, number> = { Riesgo: 0, Atención: 1, Normal: 2 };

export type DashboardViewData = {
  firstName: string;
  canUseOperativo: boolean;
  adminCards: MetricCardData[];
  adminKpis: MetricChip[];
  attentionAlerts: AttentionAlert[];
  licitacionesCards: MetricCardData[];
  licitacionesKpis: MetricChip[];
  portfolioRows: PortfolioRow[];
  portfolioTotalCount: number;
  panorama: PanoramaObras | null;
};

/**
 * Toda la data del Dashboard V2, centralizada y orquestada con agregaciones
 * eficientes y queries en paralelo vía Promise.all.
 */
export async function getDashboardViewData(profile?: CurrentProfile): Promise<DashboardViewData> {
  const p = profile ?? (await requireProfile());
  const supabase = await createClient();
  const empresaId = p.empresa_id;
  const today = addDays(0);

  const isAdminOrAdministracion = p.role === "administracion" || p.role === "admin";
  const showInvoiceKpis = isAdminOrAdministracion && p.modulo_compras;
  const showSalesKpis = isAdminOrAdministracion && p.modulo_ventas;
  const canUseOperativo = PLAN_RANK[p.plan] >= PLAN_RANK.pro && isAdminOrAdministracion;
  const canUseLicitaciones = PLAN_RANK[p.plan] >= PLAN_RANK.pro && (p.role === "comercial" || isAdminOrAdministracion);
  const canUseStock = showInvoiceKpis && PLAN_RANK[p.plan] >= PLAN_RANK.pro;

  const noopRows = Promise.resolve({ data: [] as unknown[] });

  // Ejecución en paralelo de todas las consultas de agregación del ERP
  const [
    { data: invoicesData },
    { data: salesDocsData },
    { data: receiptsData },
    { data: cuentasData },
    { data: ordersData },
    { data: certificatesData },
    { data: gastosData },
    { data: productosData },
    { data: invoiceJobsData },
    { data: workOrdersData },
    { data: licitacionesData },
    { data: licDocsData },
    { data: empresaDocsData },
    { data: projectsData },
  ] = await Promise.all([
    // 1. Facturas de proveedor
    showInvoiceKpis
      ? supabase
          .from("invoices")
          .select("id, invoice_number, total, currency, due_date, invoice_date, status, provider_id")
          .neq("status", "ANULADA")
      : noopRows,

    // 2. Documentos de venta
    showSalesKpis
      ? supabase
          .from("sales_documents")
          .select("id, code, total, cobrado_amount, currency, due_date, issue_date, status, doc_type, acceptance_status")
          .neq("status", "ANULADA")
      : noopRows,

    // 3. Cobros de venta registrados
    showSalesKpis
      ? supabase
          .from("sales_receipts")
          .select("id, amount, receipt_date, sales_document_id, sales_documents!sales_document_id(currency)")
      : noopRows,

    // 4. Cuentas financieras activas
    isAdminOrAdministracion
      ? supabase
          .from("cuentas_financieras")
          .select("id, nombre, tipo, moneda, saldo, activo")
          .eq("activo", true)
      : noopRows,

    // 5. Órdenes de compra autorizadas
    showInvoiceKpis
      ? supabase
          .from("authorized_orders")
          .select("id, code, project_id, total_price, facturado_amount, currency, status")
      : noopRows,

    // 6. Certificados de obra para proyección de flujo de caja
    canUseOperativo || isAdminOrAdministracion
      ? supabase
          .from("project_certificates")
          .select("id, numero, project_id, monto_liquido, status, period_end, aprobado_at, facturado_at, sales_documents!certificate_id(id, status)")
          .in("status", ["APROBADO", "FACTURADO"])
      : noopRows,

    // 7. Gastos recurrentes proyectados
    isAdminOrAdministracion
      ? supabase
          .from("gastos_recurrentes")
          .select("id, descripcion, monto_estimado, periodicidad, dia_del_mes, proximo_vencimiento, moneda, activo, project_id")
          .eq("activo", true)
      : noopRows,

    // 8. Productos en catálogo
    canUseStock
      ? supabase
          .from("productos")
          .select("id, nombre, stock_actual, stock_minimo, activo")
          .eq("empresa_id", empresaId)
          .eq("activo", true)
      : noopRows,

    // 9. Jobs de ingesta de facturas observadas
    showInvoiceKpis
      ? supabase
          .from("invoice_jobs")
          .select("id, status")
          .in("status", ["needs_review", "failed"])
      : noopRows,

    // 10. Órdenes de trabajo
    showSalesKpis || canUseOperativo
      ? supabase
          .from("work_orders")
          .select("id, status")
          .in("status", ["PENDIENTE", "EN_CURSO"])
      : noopRows,

    // 11. Licitaciones
    canUseLicitaciones
      ? supabase
          .from("licitaciones")
          .select("id, titulo, dncp_nro, fecha_entrega_ofertas, decision, synced_at, monto_referencial, moneda, raw_json")
          .order("synced_at", { ascending: false })
      : noopRows,

    // 12. Documentos de licitaciones (PBC / Pliegos)
    canUseLicitaciones
      ? supabase
          .from("licitacion_documentos")
          .select("id, licitacion_id, tipo, tipo_detalle, titulo, url_dncp, storage_path")
      : noopRows,

    // 13. Bóveda documental de la empresa
    canUseLicitaciones
      ? supabase
          .from("empresa_documentos")
          .select("id, tipo, descripcion, fecha_emision, fecha_vencimiento")
      : noopRows,

    // 14. Obras activas
    canUseOperativo
      ? supabase
          .from("projects")
          .select("*")
          .eq("empresa_id", empresaId)
          .eq("status", "ACTIVO")
          .order("created_at", { ascending: false })
          .returns<Project[]>()
      : noopRows,
  ]);

  // Tipado y normalización de filas
  const allInvoices = (invoicesData ?? []) as RawInvoiceForKpi[];
  const allSalesDocs = (salesDocsData ?? []) as RawSalesDocForKpi[];
  const allReceipts = (receiptsData ?? []).map((r: any) => ({
    id: r.id,
    amount: r.amount,
    receipt_date: r.receipt_date,
    sales_document_id: r.sales_document_id,
    currency: r.sales_documents?.currency || "PYG",
  })) as RawReceiptForKpi[];
  const allCuentas = (cuentasData ?? []) as RawCuentaFinancieraForKpi[];
  const allOrders = (ordersData ?? []) as RawOrderForKpi[];
  const allCertificates = (certificatesData ?? []) as any[];
  const allGastos = (gastosData ?? []) as any[];
  const allProductos = (productosData ?? []) as any[];
  const allInvoiceJobs = (invoiceJobsData ?? []) as any[];
  const allWorkOrders = (workOrdersData ?? []) as any[];
  const allLicitaciones = (licitacionesData ?? []) as RawLicitacionForTenderKpi[];
  const allLicDocs = (licDocsData ?? []) as RawLicitacionDocumento[];
  const allEmpresaDocs = (empresaDocsData ?? []) as RawEmpresaDocumento[];
  const projectList = (projectsData ?? []) as Project[];

  // =========================================================================
  // Flujo de Caja a 30 días
  // =========================================================================
  const cashflowItems = build30DayCashflowItems({
    todayIso: today,
    ventaDocs: allSalesDocs.filter((d) => d.status === "EMITIDA" || d.status === "COBRADA_PARCIAL"),
    certificados: allCertificates,
    comprasInv: allInvoices.filter((i) => i.status !== "PAGADO"),
    gastos: allGastos,
  });

  // =========================================================================
  // PARTE 1 — 8 KPIs de Administración
  // =========================================================================
  const adminCards = computeAdminKpis({
    todayIso: today,
    salesDocs: allSalesDocs,
    receipts: allReceipts,
    invoices: allInvoices,
    cuentas: allCuentas,
    orders: allOrders,
    cashflowItems,
    showSalesKpis,
    showInvoiceKpis,
  });

  // Mapeo legacy a MetricChip[] para componentes que consuman el formato anterior
  const adminKpis: MetricChip[] = adminCards.map((c) => ({
    key: c.key,
    value: c.value,
    label: c.secondaryText ? `${c.title} · ${c.secondaryText}` : c.title,
    href: c.href,
    iconKey: c.iconKey,
    tone: c.tone === "neutral" ? "ok" : c.tone,
  }));

  // =========================================================================
  // PARTE 2 — Alertas Administrativas ("REQUIERE ATENCIÓN")
  // =========================================================================
  const attentionAlerts = generateAttentionAlerts({
    todayIso: today,
    invoices: allInvoices,
    invoiceJobs: allInvoiceJobs,
    salesDocs: allSalesDocs,
    productos: allProductos,
    orders: allOrders,
    workOrders: allWorkOrders,
    cuentas: allCuentas,
  });

  // =========================================================================
  // PARTE 4 & 5 & 6 — Document Readiness Engine V1
  // =========================================================================
  const readinessAssessments = assessTendersReadiness({
    licitaciones: allLicitaciones as unknown as RawLicitacionForReadiness[],
    docs: allLicDocs,
    empresaDocs: allEmpresaDocs,
    todayIso: today,
  });

  // =========================================================================
  // PARTE 3 — 8 KPIs de Licitaciones
  // =========================================================================
  const licitacionesCards = computeTenderKpis({
    todayIso: today,
    licitaciones: allLicitaciones,
    empresaDocs: allEmpresaDocs,
    readinessAssessments,
    canUseLicitaciones,
  });

  const licitacionesKpis: MetricChip[] = licitacionesCards.map((c) => ({
    key: c.key,
    value: c.value,
    label: c.secondaryText ? `${c.title} · ${c.secondaryText}` : c.title,
    href: c.href,
    iconKey: c.iconKey,
    tone: c.tone === "neutral" ? "ok" : c.tone,
  }));

  // =========================================================================
  // PARTE 9 — Bloque Obras (Preservado 100% fiel al diseño original)
  // =========================================================================
  const projectIds = projectList.map((pr) => pr.id);
  const [{ data: budgetItems }, { data: projectOrders }, { data: execEntries }] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("budget_items").select("project_id, quantity, subtotal").in("project_id", projectIds)
      : noopRows,
    projectIds.length > 0
      ? supabase
          .from("authorized_orders")
          .select("project_id, total_price, currency")
          .in("project_id", projectIds)
          .eq("currency", "PYG")
      : noopRows,
    projectIds.length > 0
      ? supabase.from("execution_entries").select("project_id, quantity_executed").in("project_id", projectIds)
      : noopRows,
  ]);

  const subtotalByProject = new Map<string, number>();
  const budgetQtyByProject = new Map<string, number>();
  for (const b of (budgetItems ?? []) as { project_id: string; quantity: number | null; subtotal: number }[]) {
    subtotalByProject.set(b.project_id, (subtotalByProject.get(b.project_id) ?? 0) + b.subtotal);
    if (b.quantity != null) budgetQtyByProject.set(b.project_id, (budgetQtyByProject.get(b.project_id) ?? 0) + b.quantity);
  }

  const comprasByProject = new Map<string, number>();
  for (const o of (projectOrders ?? []) as { project_id: string | null; total_price: number }[]) {
    if (!o.project_id) continue;
    comprasByProject.set(o.project_id, (comprasByProject.get(o.project_id) ?? 0) + o.total_price);
  }

  const execQtyByProject = new Map<string, number>();
  for (const e of (execEntries ?? []) as { project_id: string; quantity_executed: number }[]) {
    execQtyByProject.set(e.project_id, (execQtyByProject.get(e.project_id) ?? 0) + e.quantity_executed);
  }

  const portfolioRows: PortfolioRow[] = projectList.map((pr) => {
    const presupuesto = Math.max(pr.budget_total, subtotalByProject.get(pr.id) ?? 0);
    const compras = comprasByProject.get(pr.id) ?? 0;
    const budgetQty = budgetQtyByProject.get(pr.id) ?? 0;
    const execQty = execQtyByProject.get(pr.id) ?? 0;
    const avancePct = budgetQty > 0 ? Math.min(100, Math.round((execQty / budgetQty) * 100)) : 0;
    const comprasPct = presupuesto > 0 && compras > 0 ? Math.round((compras / presupuesto) * 1000) / 10 : null;
    const atrasoBruto =
      pr.end_date && avancePct < 100
        ? Math.round((Date.parse(today) - Date.parse(pr.end_date)) / 86400000)
        : null;
    const atrasoDias = atrasoBruto && atrasoBruto > 0 ? atrasoBruto : null;

    let estado: PortfolioEstado = "Normal";
    if ((atrasoDias && atrasoDias > 15) || (comprasPct !== null && comprasPct > 115)) estado = "Riesgo";
    else if (atrasoDias || (comprasPct !== null && comprasPct > 100)) estado = "Atención";

    return { id: pr.id, code: pr.code, name: pr.name, avancePct, comprasPct, atrasoDias, estado, presupuesto };
  });

  const productosStockBajo = allProductos.filter(
    (r) => r.stock_actual <= 0 || (r.stock_minimo > 0 && r.stock_actual <= r.stock_minimo)
  );

  const panorama: PanoramaObras | null = canUseOperativo
    ? (() => {
        const carteraActivaPyg = portfolioRows.reduce((s, r) => s + r.presupuesto, 0);
        const comprasRealizadasPyg = [...comprasByProject.values()].reduce((s, v) => s + v, 0);
        const pesoTotal = carteraActivaPyg;
        const avanceFisicoPonderado =
          pesoTotal > 0
            ? Math.round(portfolioRows.reduce((s, r) => s + r.avancePct * r.presupuesto, 0) / pesoTotal)
            : portfolioRows.length > 0
              ? Math.round(portfolioRows.reduce((s, r) => s + r.avancePct, 0) / portfolioRows.length)
              : 0;
        return {
          obrasActivas: portfolioRows.length,
          carteraActivaPyg,
          comprasRealizadasPyg,
          productosStockMinimo: canUseStock ? productosStockBajo.length : null,
          desviosCosto: portfolioRows.filter((r) => r.comprasPct !== null && r.comprasPct > 100).length,
          desviosPlazo: portfolioRows.filter((r) => r.atrasoDias !== null && r.atrasoDias > 0).length,
          avanceFisicoPonderado,
          estadoBreakdown: {
            normal: portfolioRows.filter((r) => r.estado === "Normal").length,
            atencion: portfolioRows.filter((r) => r.estado === "Atención").length,
            riesgo: portfolioRows.filter((r) => r.estado === "Riesgo").length,
          },
        };
      })()
    : null;

  const portfolioRowsTop = [...portfolioRows]
    .sort((a, b) => ESTADO_PRIORITY[a.estado] - ESTADO_PRIORITY[b.estado])
    .slice(0, PORTFOLIO_TABLE_LIMIT);

  return {
    firstName: p.full_name.split(" ")[0],
    canUseOperativo,
    adminCards,
    adminKpis,
    attentionAlerts,
    licitacionesCards,
    licitacionesKpis,
    portfolioRows: portfolioRowsTop,
    portfolioTotalCount: portfolioRows.length,
    panorama,
  };
}
