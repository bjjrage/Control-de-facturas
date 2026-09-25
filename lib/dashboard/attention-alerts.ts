import type { AttentionAlert } from "./types";
import { docSaldo } from "@/lib/sales";
import { orderRemaining } from "@/lib/reconciliation";

export interface AlertSourcesInput {
  todayIso: string;
  invoices: { status: string; due_date: string | null }[];
  invoiceJobs: { status: string }[];
  salesDocs: { status: string; total: number; cobrado_amount: number; due_date: string | null; doc_type: string; acceptance_status?: string | null }[];
  productos: { stock_actual: number; stock_minimo: number; activo: boolean }[];
  stockSourceUnavailable?: boolean;
  orders: { total_price: number; facturado_amount: number; status?: string }[];
  workOrders: { status: string }[];
  cuentas: { saldo: number; activo: boolean }[];
}

/**
 * Genera la lista priorizada de alertas para la franja "REQUIERE ATENCIÓN".
 * - Solo devuelve alertas con count > 0.
 * - Prioriza las alertas de mayor urgencia operativa y financiera.
 * - Limita a un máximo visual de 7 alertas.
 */
export function generateAttentionAlerts(data: AlertSourcesInput, maxAlerts = 7): AttentionAlert[] {
  const { todayIso, invoices, invoiceJobs, salesDocs, productos, orders, workOrders, cuentas } = data;
  const candidates: AttentionAlert[] = [];

  // 1. Facturas de compra que requieren revisión (humana o por desvío)
  const facturasRevision = invoices.filter((i) => i.status === "REQUIERE_REVISION").length;
  if (facturasRevision > 0) {
    candidates.push({
      id: "alert-facturas-revision",
      label: `${facturasRevision} factura${facturasRevision !== 1 ? "s" : ""} de compra requiere${facturasRevision !== 1 ? "n" : ""} revisión`,
      count: facturasRevision,
      href: "/invoices",
      tone: "error",
      category: "compras",
    });
  }

  // 2. Facturas por pagar vencidas
  const facturasVencidas = invoices.filter((i) => i.status !== "PAGADO" && i.due_date && i.due_date < todayIso).length;
  if (facturasVencidas > 0) {
    candidates.push({
      id: "alert-pagos-vencidos",
      label: `${facturasVencidas} factura${facturasVencidas !== 1 ? "s" : ""} por pagar vencida${facturasVencidas !== 1 ? "s" : ""}`,
      count: facturasVencidas,
      href: "/pagos",
      tone: "error",
      category: "compras",
    });
  }

  // 3. Cobros vencidos
  const cobrosVencidos = salesDocs.filter(
    (d) =>
      (d.status === "EMITIDA" || d.status === "COBRADA_PARCIAL") &&
      docSaldo(d.total, d.cobrado_amount) > 0 &&
      d.due_date &&
      d.due_date < todayIso
  ).length;
  if (cobrosVencidos > 0) {
    candidates.push({
      id: "alert-cobros-vencidos",
      label: `${cobrosVencidos} cobro${cobrosVencidos !== 1 ? "s" : ""} de venta vencido${cobrosVencidos !== 1 ? "s" : ""}`,
      count: cobrosVencidos,
      href: "/cobros",
      tone: "error",
      category: "ventas",
    });
  }

  // 4. Ingesta de facturas fallidas o con dudas (scanner/OCR worker)
  const jobsReview = invoiceJobs.filter((j) => j.status === "needs_review" || j.status === "failed").length;
  if (jobsReview > 0) {
    candidates.push({
      id: "alert-invoice-jobs",
      label: `${jobsReview} subida${jobsReview !== 1 ? "s" : ""} de factura con observación`,
      count: jobsReview,
      href: "/invoices/bulk",
      tone: "warn",
      category: "compras",
    });
  }

  // 5. Cuentas financieras con saldo negativo
  const cuentasNegativas = cuentas.filter((c) => c.activo && c.saldo < 0).length;
  if (cuentasNegativas > 0) {
    candidates.push({
      id: "alert-cuentas-negativas",
      label: `${cuentasNegativas} cuenta${cuentasNegativas !== 1 ? "s" : ""} financiera${cuentasNegativas !== 1 ? "s" : ""} en negativo`,
      count: cuentasNegativas,
      href: "/tesoreria",
      tone: "error",
      category: "finanzas",
    });
  }

  // 6. El error de lectura canónica debe ser visible y no parecer stock cero.
  if (data.stockSourceUnavailable) {
    candidates.push({
      id: "alert-stock-source-unavailable",
      label: "No se pudo verificar el stock canónico global",
      count: 1,
      href: "/inventario",
      tone: "error",
      category: "stock",
    });
  }

  // 7. Productos bajo stock mínimo global (cantidad canónica agregada por ubicación).
  const bajoStock = productos.filter(
    (p) => p.activo && (p.stock_actual <= 0 || (p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo))
  ).length;
  if (bajoStock > 0) {
    candidates.push({
      id: "alert-bajo-stock",
      label: `${bajoStock} material${bajoStock !== 1 ? "es" : ""} con stock global crítico`,
      count: bajoStock,
      href: "/stock",
      tone: "warn",
      category: "stock",
    });
  }

  // 8. Órdenes de compra abiertas con saldo pendiente por facturar
  const ocsAbiertas = orders.filter((o) => {
    const rem = orderRemaining(o.total_price, o.facturado_amount);
    return rem > 0 && o.status !== "CANCELADA" && o.status !== "RECHAZADA";
  }).length;
  if (ocsAbiertas > 0) {
    candidates.push({
      id: "alert-ocs-abiertas",
      label: `${ocsAbiertas} orden${ocsAbiertas !== 1 ? "es" : ""} de compra abierta${ocsAbiertas !== 1 ? "s" : ""}`,
      count: ocsAbiertas,
      href: "/orders",
      tone: "warn",
      category: "compras",
    });
  }

  // 9. Cotizaciones pendientes de aceptación
  const cotizacionesPendientes = salesDocs.filter(
    (d) => d.doc_type === "PROFORMA" && d.acceptance_status === "PENDING_ACCEPTANCE"
  ).length;
  if (cotizacionesPendientes > 0) {
    candidates.push({
      id: "alert-cotizaciones-pendientes",
      label: `${cotizacionesPendientes} cotización${cotizacionesPendientes !== 1 ? "es" : ""} pendiente${cotizacionesPendientes !== 1 ? "s" : ""} de aceptación`,
      count: cotizacionesPendientes,
      href: "/proformas",
      tone: "warn",
      category: "ventas",
    });
  }

  // 10. Órdenes de trabajo pendientes o en curso
  const otsPendientes = workOrders.filter(
    (w) => w.status === "PENDIENTE" || w.status === "EN_CURSO"
  ).length;
  if (otsPendientes > 0) {
    candidates.push({
      id: "alert-ots-pendientes",
      label: `${otsPendientes} orden${otsPendientes !== 1 ? "es" : ""} de trabajo en curso`,
      count: otsPendientes,
      href: "/ordenes-trabajo",
      tone: "warn",
      category: "obras",
    });
  }

  return candidates.slice(0, maxAlerts);
}
