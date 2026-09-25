import type { CurrencyCode } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import type { FlujoItem } from "@/lib/flujo-caja";
import { ocurrenciasGastoRecurrente } from "@/lib/flujo-caja";
import type { DomainTone } from "./types";

export interface RawSalesDocForCashflow {
  id: string;
  code?: string | null;
  total: number;
  cobrado_amount: number;
  currency: string;
  due_date: string | null;
  issue_date: string | null;
}

export interface RawCertificateForCashflow {
  id: string;
  numero: string;
  project_id: string;
  monto_liquido: number;
  status: string;
  period_end?: string | null;
  aprobado_at?: string | null;
  facturado_at?: string | null;
  sales_documents?: { id: string; status: string } | { id: string; status: string }[] | null;
}

export interface RawInvoiceForCashflow {
  id: string;
  invoice_number: string;
  total: number;
  currency: string;
  due_date: string | null;
  invoice_date?: string | null;
  status: string;
}

export interface RawGastoRecurrenteForCashflow {
  id: string;
  descripcion: string;
  monto_estimado: number;
  periodicidad: string;
  dia_del_mes: number | null;
  proximo_vencimiento: string | null;
  moneda: CurrencyCode;
  activo: boolean;
  project_id: string | null;
}

function addDays(isoOrDate: string | Date, days: number): string {
  const d = new Date(isoOrDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function localDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Cruza las fuentes financieras existentes (cobros pendientes, certificados de obra,
 * facturas de compra y gastos recurrentes) dentro de la ventana de 30 días,
 * reutilizando la lógica canónica de lib/flujo-caja.ts.
 */
export function build30DayCashflowItems(params: {
  todayIso: string;
  ventaDocs: RawSalesDocForCashflow[];
  certificados: RawCertificateForCashflow[];
  comprasInv: RawInvoiceForCashflow[];
  gastos: RawGastoRecurrenteForCashflow[];
}): FlujoItem[] {
  const { todayIso, ventaDocs, certificados, comprasInv, gastos } = params;
  const ventanaFinIso = addDays(todayIso, 30);
  const items: FlujoItem[] = [];

  // 1. Cobros de facturas y notas de venta pendientes con vencimiento/emisión en la ventana
  for (const d of ventaDocs) {
    const saldo = (d.total ?? 0) - (d.cobrado_amount ?? 0);
    if (saldo <= 0.01) continue;
    const fecha = d.due_date ?? d.issue_date;
    // Si no tiene fecha o si cae dentro de los próximos 30 días (o ya está vencido, que se computa en el horizonte próximo)
    if (fecha && fecha > ventanaFinIso) continue;

    items.push({
      tipo: "cobro_factura",
      descripcion: `Cobro ${d.code || d.id}`,
      fecha: fecha ?? todayIso,
      monto: saldo,
      moneda: (d.currency as CurrencyCode) || "PYG",
      project_id: null,
      ref_id: d.id,
    });
  }

  // 2. Cobros de certificados de obra pendientes (estimado fecha base + 30 días)
  // Solo certificados aprobados/facturados son proyecciones de ingreso.
  // Si existe un documento de venta no anulado, ese documento es la única
  // fuente del cobro para evitar contar certificado + factura dos veces.
  for (const c of certificados) {
    if (c.status !== "APROBADO" && c.status !== "FACTURADO") continue;
    if (!c.monto_liquido || c.monto_liquido <= 0) continue;
    const salesDocuments = Array.isArray(c.sales_documents)
      ? c.sales_documents
      : c.sales_documents
        ? [c.sales_documents]
        : [];
    const hasActiveSalesDoc = salesDocuments.some((d) => d.status !== "ANULADA");
    if (hasActiveSalesDoc) continue;

    const base = c.status === "FACTURADO" ? (c.facturado_at ?? c.period_end) : (c.aprobado_at ?? c.period_end);
    const fechaEstimada = base ? addDays(String(base).slice(0, 10), 30) : todayIso;
    if (fechaEstimada > ventanaFinIso) continue;

    items.push({
      tipo: "cobro_certificado",
      descripcion: `Certificado N° ${c.numero}`,
      fecha: fechaEstimada,
      monto: c.monto_liquido,
      moneda: "PYG",
      project_id: c.project_id,
      ref_id: c.id,
    });
  }

  // 3. Pagos de facturas de compra pendientes
  for (const inv of comprasInv) {
    if (!inv.total || inv.total <= 0) continue;
    const fecha = inv.due_date ?? inv.invoice_date;
    if (fecha && fecha > ventanaFinIso) continue;

    items.push({
      tipo: "pago_factura",
      descripcion: `Pago factura ${inv.invoice_number}`,
      fecha: fecha ?? todayIso,
      monto: -inv.total,
      moneda: (inv.currency as CurrencyCode) || "PYG",
      project_id: null,
      ref_id: inv.id,
    });
  }

  // 4. Gastos recurrentes proyectados para los próximos 30 días
  const finDate = localDate(ventanaFinIso);
  finDate.setDate(finDate.getDate() + 1);
  const desde = localDate(todayIso);
  for (const g of gastos.filter((x) => x.activo)) {
    const ocurrencias = ocurrenciasGastoRecurrente(
      g.monto_estimado,
      g.periodicidad,
      g.dia_del_mes,
      g.proximo_vencimiento,
      finDate,
      desde
    );
    for (const oc of ocurrencias) {
      if (oc.fecha > ventanaFinIso) continue;
      items.push({
        tipo: "gasto_recurrente",
        descripcion: g.descripcion,
        fecha: oc.fecha,
        monto: -oc.monto,
        moneda: g.moneda,
        project_id: g.project_id,
        ref_id: `${g.id}-${oc.fecha}`,
      });
    }
  }

  return items;
}

/**
 * Calcula el flujo neto a 30 días para una moneda específica (por defecto PYG).
 */
export function calculate30DayNetCashflow(
  items: FlujoItem[],
  moneda: CurrencyCode = "PYG"
): {
  neto: number;
  entradas: number;
  salidas: number;
  formattedNeto: string;
  tone: DomainTone;
} {
  let entradas = 0;
  let salidas = 0;

  for (const item of items) {
    if (item.moneda !== moneda) continue;
    if (item.monto >= 0) {
      entradas += item.monto;
    } else {
      salidas += Math.abs(item.monto);
    }
  }

  const neto = Math.round(entradas - salidas);
  const sign = neto > 0 ? "+" : "";
  const formattedNeto = `${sign}${formatMoney(neto, moneda)}`;

  let tone: DomainTone = "ok";
  if (neto < 0) {
    tone = "error";
  } else if (neto === 0 && salidas > 0) {
    tone = "warn";
  }

  return {
    neto,
    entradas: Math.round(entradas),
    salidas: Math.round(salidas),
    formattedNeto,
    tone,
  };
}
