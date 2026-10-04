import { SalesDocStatus, SalesDocType, ReceiptMethod } from "./types";

/** IVA incluido en el precio (régimen paraguayo). */
export function lineTotal(quantity: number, unitPrice: number) {
  return Math.round(quantity * unitPrice * 100) / 100;
}

/** Descompone un importe IVA-incluido en neto gravado + IVA. */
export function splitVat(amountInclVat: number, rate: 0 | 5 | 10) {
  if (rate === 0) return { neto: amountInclVat, iva: 0 };
  const neto = Math.round((amountInclVat / (1 + rate / 100)) * 100) / 100;
  return { neto, iva: Math.round((amountInclVat - neto) * 100) / 100 };
}

export function docSaldo(total: number, cobrado: number) {
  return Math.round((total - cobrado) * 100) / 100;
}

export const SALES_DOC_TYPE_LABELS: Record<SalesDocType, string> = {
  PROFORMA:      "Proforma",
  NOTA_VENTA:    "Nota de Venta",
  REMISION:      "Remisión",
  FACTURA:       "Factura",
  NOTA_CREDITO:  "Nota de Crédito",
};

/** Document types available in the existing Sales editor. NOTA_VENTA remains a legacy/read-model type. */
export const SALES_DOC_FORM_TYPES: SalesDocType[] = ["PROFORMA", "REMISION", "FACTURA", "NOTA_CREDITO"];

export function isSalesEditorType(value: string): value is SalesDocType {
  return SALES_DOC_FORM_TYPES.includes(value as SalesDocType);
}

/** Fiscal issuance follows the explicit human internal issuance boundary. */
export function canIssueSalesFiscalDocument(docType: SalesDocType, status: SalesDocStatus): boolean {
  return (docType === "FACTURA" || docType === "NOTA_CREDITO") &&
    ["EMITIDA", "COBRADA_PARCIAL", "COBRADA"].includes(status);
}

export const SALES_DOC_PANEL_PATH: Record<SalesDocType, string> = {
  PROFORMA:     "/proformas",
  NOTA_VENTA:   "/cobros",
  REMISION:     "/remisiones",
  FACTURA:      "/facturas-venta",
  NOTA_CREDITO: "/notas-credito",
};

export const SALES_DOC_PANEL_TITLE: Record<SalesDocType, string> = {
  PROFORMA:     "Proformas",
  NOTA_VENTA:   "Cobros",
  REMISION:     "Remisiones",
  FACTURA:      "Facturas de Venta",
  NOTA_CREDITO: "Notas de Crédito",
};

export const SALES_DOC_STATUS_LABELS: Record<SalesDocStatus, string> = {
  BORRADOR: "Borrador",
  EMITIDA: "Emitida (por cobrar)",
  COBRADA_PARCIAL: "Cobro parcial",
  COBRADA: "Cobrada",
  ANULADA: "Anulada",
};

export const RECEIPT_METHOD_LABELS: Record<ReceiptMethod, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
  TARJETA: "Tarjeta",
  OTRO: "Otro",
};

/** Orden de prioridad para la vista de gestión de ventas. */
export const SALES_STATUS_ORDER: SalesDocStatus[] = [
  "EMITIDA",
  "COBRADA_PARCIAL",
  "BORRADOR",
  "COBRADA",
  "ANULADA",
];

export function isOverdue(dueDate: string | null, status: SalesDocStatus) {
  if (!dueDate) return false;
  if (status !== "EMITIDA" && status !== "COBRADA_PARCIAL") return false;
  return new Date(dueDate).getTime() < Date.now();
}
