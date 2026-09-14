import { InvoiceStatus, SalesDocStatus } from "./types";
import { docSaldo } from "./sales";

export type PayableBucket = "proxima" | "vencida" | null;

/**
 * CxP (facturas de proveedor — nosotros debemos): el esquema de `invoices`
 * no tiene un campo de saldo parcial — pagar una orden de pago marca la
 * factura ENTERA como PAGADO (ver markPaymentOrderExecuted en
 * app/(internal)/pagos/actions.ts), no hay pagos parciales. `status` es
 * entonces la única señal fiable de "saldo pendiente": cualquier estado
 * distinto de PAGADO es una obligación todavía sin cubrir.
 */
export function classifyPayable(
  invoice: { status: InvoiceStatus; due_date: string | null },
  today: string,
  windowEnd: string
): PayableBucket {
  if (invoice.status === "PAGADO") return null;
  if (!invoice.due_date) return null;
  if (invoice.due_date < today) return "vencida";
  if (invoice.due_date <= windowEnd) return "proxima";
  return null;
}

export type ReceivableBucket = "esperado" | "vencido" | null;

/**
 * CxC (documentos de venta — nos deben): a diferencia de invoices, acá el
 * esquema sí tiene saldo real (`total - cobrado_amount`, ver docSaldo en
 * lib/sales.ts) — se usa ese en vez de inferir todo del status. BORRADOR
 * (todavía no es una cuenta por cobrar real) y ANULADA (no se debe) se
 * excluyen aunque por algún dato inconsistente su saldo diera positivo.
 */
export function classifyReceivable(
  doc: { status: SalesDocStatus; due_date: string | null; total: number; cobrado_amount: number },
  today: string,
  windowEnd: string
): ReceivableBucket {
  if (doc.status === "BORRADOR" || doc.status === "ANULADA") return null;
  if (docSaldo(doc.total, doc.cobrado_amount) <= 0) return null;
  if (!doc.due_date) return null;
  if (doc.due_date < today) return "vencido";
  if (doc.due_date <= windowEnd) return "esperado";
  return null;
}
