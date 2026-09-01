import { InvoiceStatus } from "./types";

/**
 * Pure reconciliation logic, mirrored by supabase/migrations/0013_partial_deliveries.sql
 * (public.recompute_invoice_status). Kept here as a plain function so the core
 * business rule can be reasoned about / tested without a live database.
 *
 * Modelo (entregas parciales): 1 factura -> 1 OC. Una OC acumula el total de sus
 * facturas en `facturado_amount`. Si el acumulado supera el monto de la OC por
 * más de OVERBILL_TOLERANCE_PCT, la factura queda REQUIERE_REVISION.
 */

/** Tolerancia de sobrefacturación por OC. Espejo del valor en la migración 0013.
 *  A futuro puede pasar a config por empresa. */
export const OVERBILL_TOLERANCE_PCT = 5;

export function roundCents(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeInvoiceStatus(params: {
  linkedToOrder: boolean;
  orderTotal: number;
  orderFacturadoAmount: number;
  hasApprovedException: boolean;
}): InvoiceStatus {
  const { linkedToOrder, orderTotal, orderFacturadoAmount, hasApprovedException } = params;
  if (!linkedToOrder) return "PENDIENTE";
  if (!isOverbilled(orderTotal, orderFacturadoAmount)) return "MATCH";
  return hasApprovedException ? "APROBADO_EXCEPCION" : "REQUIERE_REVISION";
}

/** Saldo sin facturar de una OC (puede ser negativo si está sobrefacturada). */
export function orderRemaining(orderTotal: number, facturadoAmount: number) {
  return roundCents(orderTotal - facturadoAmount);
}

/** true si lo facturado supera el monto de la OC más la tolerancia. */
export function isOverbilled(orderTotal: number, facturadoAmount: number) {
  return roundCents(facturadoAmount) > roundCents(orderTotal * (1 + OVERBILL_TOLERANCE_PCT / 100));
}

export type OrderFulfillment = "pendiente" | "parcial" | "completa";

export function orderFulfillmentStatus(orderTotal: number, facturadoAmount: number): OrderFulfillment {
  const facturado = roundCents(facturadoAmount);
  if (facturado <= 0) return "pendiente";
  if (facturado < roundCents(orderTotal)) return "parcial";
  return "completa";
}

/** Diferencia (monto y %) de lo facturado en la OC contra su saldo previo. */
export function differenceAmount(invoiceTotal: number, orderRemainingBefore: number) {
  return roundCents(invoiceTotal - orderRemainingBefore);
}

export function differencePct(invoiceTotal: number, orderRemainingBefore: number) {
  if (orderRemainingBefore === 0) return invoiceTotal === 0 ? 0 : 100;
  return roundCents(((invoiceTotal - orderRemainingBefore) / orderRemainingBefore) * 10000) / 100;
}

export function canMarkAptoParaPago(status: InvoiceStatus) {
  return status === "MATCH" || status === "APROBADO_EXCEPCION";
}

export function canMarkPagado(status: InvoiceStatus) {
  return status === "APTO_PARA_PAGO";
}
