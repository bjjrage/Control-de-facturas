import { InvoiceStatus } from "./types";

/**
 * Pure reconciliation logic, mirrored by supabase/migrations/0003_functions.sql
 * (public.recompute_invoice_status). Kept here as a plain function so the core
 * business rule can be unit tested without a live database.
 */
export function computeInvoiceStatus(params: {
  invoiceTotal: number;
  authorizedSum: number;
  hasApprovedException: boolean;
}): InvoiceStatus {
  const { invoiceTotal, authorizedSum, hasApprovedException } = params;
  if (authorizedSum === 0) return "PENDIENTE";
  if (roundCents(authorizedSum) === roundCents(invoiceTotal)) return "MATCH";
  if (hasApprovedException) return "APROBADO_EXCEPCION";
  return "REQUIERE_REVISION";
}

export function roundCents(value: number) {
  return Math.round(value * 100) / 100;
}

export function differenceAmount(invoiceTotal: number, authorizedSum: number) {
  return roundCents(invoiceTotal - authorizedSum);
}

export function differencePct(invoiceTotal: number, authorizedSum: number) {
  if (authorizedSum === 0) return invoiceTotal === 0 ? 0 : 100;
  return roundCents(((invoiceTotal - authorizedSum) / authorizedSum) * 10000) / 100;
}

export function canMarkAptoParaPago(status: InvoiceStatus) {
  return status === "MATCH" || status === "APROBADO_EXCEPCION";
}

export function canMarkPagado(status: InvoiceStatus) {
  return status === "APTO_PARA_PAGO";
}
