import { describe, expect, it } from "vitest";
import { salesReceivables, type ReceivableDocument } from "../sales-receivables";
const doc = (id: string, doc_type = "FACTURA", total = 100, extra = {}): ReceivableDocument => ({ id, empresa_id: "tenant", client_id: "client", currency: "PYG", doc_type, status: "EMITIDA", total, cobrado_amount: 0, source_document_id: null, ...extra });
describe("sales debt, credit and currency", () => {
 it("does not duplicate the remission when its invoice has been paid", () => {
   const account = salesReceivables([doc("rem", "REMISION"), doc("invoice", "FACTURA", 100, {status: "COBRADA", cobrado_amount: 100, source_document_id: "rem"})]);
   expect(account.pendingByCurrency.get("PYG")).toBe(0); expect(account.balances.get("rem")).toBe(0);
 });
 it("NC reduces outstanding invoice and caps positive collection", () => {
   const a = salesReceivables([doc("invoice"), doc("credit", "NOTA_CREDITO", 30, {source_document_id: "invoice"})]);
   expect(a.balances.get("invoice")).toBe(70); expect(a.signedBalances.get("invoice")).toBe(100); expect(a.signedBalances.get("credit")).toBe(-30);
   expect([...a.signedBalances.values()].reduce((sum, n) => sum+n, 0)).toBe(70);
 });
 it("NC on paid invoice generates credit, even with a historical erroneous NC receipt", () => {
   const a = salesReceivables([doc("invoice", "FACTURA", 100, {status:"COBRADA", cobrado_amount:100}), doc("credit", "NOTA_CREDITO", 100, {source_document_id:"invoice", status:"COBRADA_PARCIAL", cobrado_amount:10})]);
   expect(a.pendingByCurrency.get("PYG")).toBe(0); expect(a.creditByCurrency.get("PYG")).toBe(100);
 });
 it.each([{currency:"USD"}, {empresa_id:"other"}, {client_id:"other"}, {status:"BORRADOR"}, {status:"ANULADA"}])("ignores an invalid or nonissued credit %j", extra => {
   const a = salesReceivables([doc("invoice"), doc("credit", "NOTA_CREDITO", 30, {source_document_id:"invoice", ...extra})]);
   expect(a.balances.get("invoice")).toBe(100);
 });
 it("keeps currencies separate and ignores proformas", () => {
   const a=salesReceivables([doc("pyg"),doc("usd","FACTURA",15.5,{currency:"USD"}),doc("quote","PROFORMA",1000)]);
   expect([...a.pendingByCurrency]).toEqual([["PYG",100],["USD",15.5]]);
 });
 it("legacy sale notes remain collectible until replaced by an issued invoice", () => {
   expect(salesReceivables([doc("note","NOTA_VENTA")]).balances.get("note")).toBe(100);
   expect(salesReceivables([doc("note","NOTA_VENTA"),doc("invoice","FACTURA",100,{source_document_id:"note"})]).pendingByCurrency.get("PYG")).toBe(100);
 });
});

it("standalone NC is an unapplied credit separated by customer currency", () => {
 const a=salesReceivables([doc("invoice"),doc("credit","NOTA_CREDITO",30)]);
 expect(a.creditByCurrency.get("PYG")).toBe(30);expect(a.balances.get("invoice")).toBe(100);
 expect(a.signedBalances.get("credit")).toBe(-30);expect(a.netByCurrency.get("PYG")).toBe(70);
});

it("a fully credited unpaid invoice reconciles its row with the NC row to zero", () => {
 const a=salesReceivables([doc("invoice"),doc("credit","NOTA_CREDITO",100,{source_document_id:"invoice"})]);
 expect(a.balances.get("invoice")).toBe(0);expect([...a.signedBalances.values()].reduce((sum,n)=>sum+n,0)).toBe(0);
});
