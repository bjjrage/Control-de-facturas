import type { CurrencyCode } from "./types";

/** Shared financial read model. Remissions/proformas never create a second debt. */
export type ReceivableDocument = {
  id: string; empresa_id?: string; client_id?: string; currency: string;
  doc_type: string; status: string; total: number; cobrado_amount: number;
  source_document_id?: string | null;
};
const issued = (d: ReceivableDocument) => ["EMITIDA", "COBRADA_PARCIAL", "COBRADA"].includes(d.status);
const round = (n: number) => Math.round(n * 100) / 100;
export function salesReceivables(documents: ReceivableDocument[]) {
  const byId = new Map(documents.map(d => [d.id, d]));
  const credits = new Map<string, number>();
  const signedBalances = new Map<string, number>();
  const standaloneCredits = new Map<CurrencyCode, number>();
  for (const d of documents) {
    if (d.doc_type !== "NOTA_CREDITO" || !issued(d)) continue;
    if (!d.source_document_id) {
      signedBalances.set(d.id, -Number(d.total));
      standaloneCredits.set(d.currency as CurrencyCode, round((standaloneCredits.get(d.currency as CurrencyCode) ?? 0) + Number(d.total)));
      continue;
    }
    const source = byId.get(d.source_document_id);
    if (!source || !issued(source) || source.doc_type !== "FACTURA" ||
      source.currency !== d.currency || source.empresa_id !== d.empresa_id || source.client_id !== d.client_id) continue;
    // Historical erroneous positive NC receipts are not another client debt.
    credits.set(source.id, round((credits.get(source.id) ?? 0) + Number(d.total)));
    signedBalances.set(d.id, -Number(d.total));
  }
  const balances = new Map<string, number>();
  const netByCurrency = new Map<CurrencyCode, number>();
  const creditByCurrency = new Map<CurrencyCode, number>();
  const pendingByCurrency = new Map<CurrencyCode, number>();
  for (const d of documents) {
    let balance = 0;
    let documentDebt = 0;
    if (issued(d) && (d.doc_type === "FACTURA" || d.doc_type === "NOTA_VENTA")) {
      // A legacy note replaced by an issued invoice is documentary history.
      const invoicedLegacy = d.doc_type === "NOTA_VENTA" && documents.some(child =>
        child.source_document_id === d.id && child.doc_type === "FACTURA" && issued(child) &&
        child.currency === d.currency && child.client_id === d.client_id && child.empresa_id === d.empresa_id);
      if (!invoicedLegacy) {
        documentDebt = round(Number(d.total) - Number(d.cobrado_amount));
        balance = round(documentDebt - (credits.get(d.id) ?? 0));
        netByCurrency.set(d.currency as CurrencyCode, round((netByCurrency.get(d.currency as CurrencyCode) ?? 0) + balance));
        pendingByCurrency.set(d.currency as CurrencyCode, round((pendingByCurrency.get(d.currency as CurrencyCode) ?? 0) + Math.max(0, balance)));
        creditByCurrency.set(d.currency as CurrencyCode, round((creditByCurrency.get(d.currency as CurrencyCode) ?? 0) + Math.max(0, -balance)));
      }
    }
    balances.set(d.id, Math.max(0, balance));
    if (d.doc_type !== "NOTA_CREDITO") signedBalances.set(d.id, documentDebt);
  }
  for (const [currency, amount] of standaloneCredits) {
    netByCurrency.set(currency, round((netByCurrency.get(currency) ?? 0) - amount));
    creditByCurrency.set(currency, round((creditByCurrency.get(currency) ?? 0) + amount));
  }
  return { balances, signedBalances, pendingByCurrency, creditByCurrency, netByCurrency };
}
