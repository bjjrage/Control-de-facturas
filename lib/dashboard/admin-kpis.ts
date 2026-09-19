import type { CurrencyCode, InvoiceStatus, SalesDocStatus } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { docSaldo } from "@/lib/sales";
import { orderRemaining } from "@/lib/reconciliation";
import type { MetricCardData, SparklinePoint, DomainTone } from "./types";
import { formatMultiCurrencyBalances, sumByCurrency } from "./currency-helper";
import type { FlujoItem } from "@/lib/flujo-caja";
import { calculate30DayNetCashflow } from "./cashflow";

export interface RawSalesDocForKpi {
  id: string;
  code?: string | null;
  doc_type: string;
  status: SalesDocStatus;
  total: number;
  cobrado_amount: number;
  currency: string;
  issue_date: string;
  due_date: string | null;
}

export interface RawReceiptForKpi {
  id: string;
  amount: number;
  receipt_date: string;
  sales_document_id: string;
  currency?: string | null;
}

export interface RawInvoiceForKpi {
  id: string;
  invoice_number: string;
  total: number;
  currency: string;
  due_date: string | null;
  invoice_date?: string | null;
  status: InvoiceStatus;
}

export interface RawCuentaFinancieraForKpi {
  id: string;
  nombre: string;
  moneda: CurrencyCode;
  saldo: number;
  activo: boolean;
}

export interface RawOrderForKpi {
  id: string;
  code: string;
  total_price: number;
  facturado_amount: number;
  currency: string;
  status?: string;
}

/**
 * Genera una lista de claves de mes en formato "YYYY-MM" para los últimos N meses hasta today.
 */
export function getLastNMonths(todayDate: Date, count = 6): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(todayDate.getFullYear(), todayDate.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    months.push(`${yyyy}-${mm}`);
  }
  return months;
}

/**
 * Genera los 8 KPIs de Administración ejecutivos y reales.
 */
export function computeAdminKpis(params: {
  todayIso: string;
  salesDocs: RawSalesDocForKpi[];
  receipts: RawReceiptForKpi[];
  invoices: RawInvoiceForKpi[];
  cuentas: RawCuentaFinancieraForKpi[];
  orders: RawOrderForKpi[];
  cashflowItems: FlujoItem[];
  showSalesKpis: boolean;
  showInvoiceKpis: boolean;
}): MetricCardData[] {
  const {
    todayIso,
    salesDocs,
    receipts,
    invoices,
    cuentas,
    orders,
    cashflowItems,
    showSalesKpis,
    showInvoiceKpis,
  } = params;

  const todayDate = new Date(todayIso);
  const currentYear = todayDate.getFullYear();
  const currentMonthStr = `${currentYear}-${String(todayDate.getMonth() + 1).padStart(2, "0")}`;

  const prevMonthDate = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1);
  const prevMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;

  const last6Months = getLastNMonths(todayDate, 6);

  const kpis: MetricCardData[] = [];

  // =========================================================================
  // 1. FACTURACIÓN DEL MES
  // =========================================================================
  if (showSalesKpis) {
    const validSalesFacturas = salesDocs.filter(
      (d) =>
        d.doc_type === "FACTURA" &&
        d.status !== "BORRADOR" &&
        d.status !== "ANULADA"
    );

    const facturasMesActual = validSalesFacturas.filter((d) =>
      d.issue_date.startsWith(currentMonthStr)
    );
    const facturasMesAnterior = validSalesFacturas.filter((d) =>
      d.issue_date.startsWith(prevMonthStr)
    );

    const facturacionMesMap = sumByCurrency(facturasMesActual, (d) => d.total);
    const { primaryFormatted: facturacionMesFormatted, extraFormatted: facturacionMesExtra, primaryValue: facturadoMesPyg } =
      formatMultiCurrencyBalances(facturacionMesMap, "PYG");

    const facturacionPrevMap = sumByCurrency(facturasMesAnterior, (d) => d.total);
    const facturadoPrevPyg = facturacionPrevMap.get("PYG") ?? 0;

    let trendText: string | null = null;
    let trendTone: "up" | "down" | "neutral" = "neutral";
    if (facturadoPrevPyg > 0) {
      const diffPct = ((facturadoMesPyg - facturadoPrevPyg) / facturadoPrevPyg) * 100;
      const rounded = Math.round(diffPct * 10) / 10;
      const arrow = rounded >= 0 ? "↑" : "↓";
      trendText = `${arrow} ${Math.abs(rounded).toLocaleString("es-PY")}% vs mes anterior`;
      trendTone = rounded >= 0 ? "up" : "down";
    } else if (facturadoMesPyg > 0 && facturadoPrevPyg === 0) {
      trendText = "Sin facturación mes anterior";
      trendTone = "neutral";
    }

    // Sparkline de facturación últimos 6 meses en PYG
    const facturacionSparkline: SparklinePoint[] = last6Months.map((m) => {
      const docsInMonth = validSalesFacturas.filter(
        (d) => d.currency === "PYG" && d.issue_date.startsWith(m)
      );
      const sum = docsInMonth.reduce((acc, d) => acc + d.total, 0);
      return { date: m, value: sum };
    });

    kpis.push({
      key: "facturacion-mes",
      title: "Facturación del mes",
      value: facturacionMesFormatted,
      multiCurrencyExtra: facturacionMesExtra,
      secondaryText: `${facturasMesActual.length} factura${facturasMesActual.length !== 1 ? "s" : ""}`,
      trendText,
      trendTone,
      href: "/facturas-venta",
      iconKey: "receipt",
      tone: "ok",
      sparkline: facturacionSparkline,
    });

    // =========================================================================
    // 2. FACTURACIÓN YTD (Acumulada del año)
    // =========================================================================
    const startOfYearIso = `${currentYear}-01-01`;
    const facturasYtd = validSalesFacturas.filter(
      (d) => d.issue_date >= startOfYearIso && d.issue_date <= todayIso
    );
    const facturacionYtdMap = sumByCurrency(facturasYtd, (d) => d.total);
    const { primaryFormatted: facturacionYtdFormatted, extraFormatted: facturacionYtdExtra } =
      formatMultiCurrencyBalances(facturacionYtdMap, "PYG");

    kpis.push({
      key: "facturacion-ytd",
      title: "Facturación YTD",
      value: facturacionYtdFormatted,
      multiCurrencyExtra: facturacionYtdExtra,
      secondaryText: `${facturasYtd.length} factura${facturasYtd.length !== 1 ? "s" : ""} en ${currentYear}`,
      trendText: `Acumulado ${currentYear}`,
      trendTone: "neutral",
      href: "/facturas-venta",
      iconKey: "calendar-range",
      tone: "ok",
    });

    // =========================================================================
    // 3. COBRADO ESTE MES
    // =========================================================================
    const cobrosMesActual = receipts.filter((r) =>
      r.receipt_date.startsWith(currentMonthStr)
    );
    const cobrosMesMap = sumByCurrency(cobrosMesActual, (r) => r.amount);
    const { primaryFormatted: cobradoMesFormatted, extraFormatted: cobradoMesExtra, primaryValue: cobradoMesPyg } =
      formatMultiCurrencyBalances(cobrosMesMap, "PYG");

    let secondaryCobrado = `${cobrosMesActual.length} cobro${cobrosMesActual.length !== 1 ? "s" : ""}`;
    if (facturadoMesPyg > 0 && cobradoMesPyg > 0) {
      const pctDeFacturado = Math.round((cobradoMesPyg / facturadoMesPyg) * 100);
      secondaryCobrado = `${pctDeFacturado}% de facturado · ${cobrosMesActual.length} cobros`;
    }

    const cobrosSparkline: SparklinePoint[] = last6Months.map((m) => {
      const rInMonth = receipts.filter(
        (r) => (r.currency === "PYG" || !r.currency) && r.receipt_date.startsWith(m)
      );
      const sum = rInMonth.reduce((acc, r) => acc + r.amount, 0);
      return { date: m, value: sum };
    });

    kpis.push({
      key: "cobrado-mes",
      title: "Cobrado este mes",
      value: cobradoMesFormatted,
      multiCurrencyExtra: cobradoMesExtra,
      secondaryText: secondaryCobrado,
      trendText: "Cobro efectivo registrado",
      trendTone: "neutral",
      href: "/cobros",
      iconKey: "wallet",
      tone: "ok",
      sparkline: cobrosSparkline,
    });

    // =========================================================================
    // 4. CUENTAS POR COBRAR (CxC)
    // =========================================================================
    const cxcDocs = salesDocs.filter(
      (d) =>
        (d.status === "EMITIDA" || d.status === "COBRADA_PARCIAL") &&
        docSaldo(d.total, d.cobrado_amount) > 0
    );

    const cxcTotalMap = sumByCurrency(cxcDocs, (d) => docSaldo(d.total, d.cobrado_amount));
    const { primaryFormatted: cxcTotalFormatted, extraFormatted: cxcTotalExtra, primaryValue: cxcTotalPyg } =
      formatMultiCurrencyBalances(cxcTotalMap, "PYG");

    const cxcVencidosDocs = cxcDocs.filter((d) => d.due_date && d.due_date < todayIso);
    const cxcVencidoMap = sumByCurrency(cxcVencidosDocs, (d) => docSaldo(d.total, d.cobrado_amount));
    const { primaryFormatted: cxcVencidoFormatted, primaryValue: cxcVencidoPyg } =
      formatMultiCurrencyBalances(cxcVencidoMap, "PYG");

    let toneCxC: DomainTone = "ok";
    if (cxcVencidoPyg > 0) toneCxC = "error";
    else if (cxcTotalPyg > 0) toneCxC = "warn";

    kpis.push({
      key: "cuentas-por-cobrar",
      title: "Cuentas por cobrar",
      value: cxcTotalFormatted,
      multiCurrencyExtra: cxcTotalExtra,
      secondaryText:
        cxcVencidosDocs.length > 0
          ? `Vencido: ${cxcVencidoFormatted} · ${cxcVencidosDocs.length} docs`
          : `${cxcDocs.length} docs al día`,
      trendText: cxcVencidosDocs.length > 0 ? "Requiere gestión de cobro" : "Sin documentos vencidos",
      trendTone: cxcVencidosDocs.length > 0 ? "down" : "up",
      href: "/cobros",
      iconKey: "clock",
      tone: toneCxC,
    });
  }

  // =========================================================================
  // 5. LIQUIDEZ DISPONIBLE
  // =========================================================================
  const cuentasActivas = cuentas.filter((c) => c.activo);
  const liquidezMap = sumByCurrency(cuentasActivas, (c) => c.saldo);
  const { primaryFormatted: liquidezFormatted, extraFormatted: liquidezExtra, primaryValue: liquidezPyg } =
    formatMultiCurrencyBalances(liquidezMap, "PYG");

  kpis.push({
    key: "liquidez-disponible",
    title: "Liquidez disponible",
    value: liquidezFormatted,
    multiCurrencyExtra: liquidezExtra,
    secondaryText: `${cuentasActivas.length} cuenta${cuentasActivas.length !== 1 ? "s" : ""} activa${cuentasActivas.length !== 1 ? "s" : ""}`,
    trendText: "Bancos y cajas disponibles",
    trendTone: "neutral",
    href: "/tesoreria",
    iconKey: "landmark",
    tone: liquidezPyg < 0 ? "error" : "ok",
  });

  // =========================================================================
  // 6. FLUJO NETO 30 DÍAS
  // =========================================================================
  const { formattedNeto, tone: toneFlujo, neto } = calculate30DayNetCashflow(cashflowItems, "PYG");
  kpis.push({
    key: "flujo-neto-30d",
    title: "Flujo neto 30 días",
    value: formattedNeto,
    multiCurrencyExtra: null,
    secondaryText: "Próximos 30 días de caja",
    trendText: neto >= 0 ? "Superávit proyectado" : "Déficit proyectado",
    trendTone: neto >= 0 ? "up" : "down",
    href: "/flujo-caja",
    iconKey: "trending-up",
    tone: toneFlujo,
  });

  // =========================================================================
  // 7. CUENTAS POR PAGAR (CxP)
  // =========================================================================
  if (showInvoiceKpis) {
    const unpaidInvoices = invoices.filter((inv) => inv.status !== "PAGADO");
    const cxpTotalMap = sumByCurrency(unpaidInvoices, (inv) => inv.total);
    const { primaryFormatted: cxpTotalFormatted, extraFormatted: cxpTotalExtra, primaryValue: cxpTotalPyg } =
      formatMultiCurrencyBalances(cxpTotalMap, "PYG");

    const cxpVencidas = unpaidInvoices.filter((inv) => inv.due_date && inv.due_date < todayIso);
    const cxpVencidoMap = sumByCurrency(cxpVencidas, (inv) => inv.total);
    const { primaryFormatted: cxpVencidoFormatted, primaryValue: cxpVencidoPyg } =
      formatMultiCurrencyBalances(cxpVencidoMap, "PYG");

    let toneCxP: DomainTone = "ok";
    if (cxpVencidoPyg > 0) toneCxP = "error";
    else if (cxpTotalPyg > 0) toneCxP = "warn";

    kpis.push({
      key: "cuentas-por-pagar",
      title: "Cuentas por pagar",
      value: cxpTotalFormatted,
      multiCurrencyExtra: cxpTotalExtra,
      secondaryText:
        cxpVencidas.length > 0
          ? `Vencido: ${cxpVencidoFormatted} · ${cxpVencidas.length} facturas`
          : `${unpaidInvoices.length} facturas al día`,
      trendText: cxpVencidas.length > 0 ? "Facturas impagas vencidas" : "Obligaciones al día",
      trendTone: cxpVencidas.length > 0 ? "down" : "up",
      href: "/pagos",
      iconKey: "alert-octagon",
      tone: toneCxP,
    });

    // =========================================================================
    // 8. COMPRAS COMPROMETIDAS (Órdenes de compra abiertas)
    // =========================================================================
    const openOrders = orders.filter((o) => {
      const remaining = orderRemaining(o.total_price, o.facturado_amount);
      return remaining > 0 && o.status !== "CANCELADA" && o.status !== "RECHAZADA";
    });

    const compromisoMap = sumByCurrency(openOrders, (o) =>
      orderRemaining(o.total_price, o.facturado_amount)
    );
    const { primaryFormatted: compromisoFormatted, extraFormatted: compromisoExtra } =
      formatMultiCurrencyBalances(compromisoMap, "PYG");

    kpis.push({
      key: "compras-comprometidas",
      title: "Compras comprometidas",
      value: compromisoFormatted,
      multiCurrencyExtra: compromisoExtra,
      secondaryText: `${openOrders.length} orden${openOrders.length !== 1 ? "es" : ""} de compra abierta${openOrders.length !== 1 ? "s" : ""}`,
      trendText: "Saldo comprometido por facturar",
      trendTone: "neutral",
      href: "/orders",
      iconKey: "shopping-cart",
      tone: "ok",
    });
  }

  return kpis;
}
