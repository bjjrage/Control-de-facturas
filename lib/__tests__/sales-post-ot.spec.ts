import { describe, expect, it } from "vitest";
import type { SalesDocType, SalesQuotationAcceptance, WorkOrderItem } from "../types";
import { SALES_DOC_FORM_TYPES, SALES_DOC_TYPE_LABELS } from "../sales";
import {
  acceptedWorkOrderItemsMatch,
  acceptedWorkOrderSnapshotMatches,
  canLinkSalesDocument,
  salesDocumentsInSourceChain,
} from "../sales-post-ot";

const validSnapshot = () => ({
  workOrder: {
    id: "ot-1",
    empresa_id: "empresa-1",
    sales_document_id: "quote-1",
    client_id: "client-1",
    currency: "PYG" as const,
    subtotal: 90,
    vat_amount: 10,
    total: 100,
  },
  quotation: {
    id: "quote-1",
    empresa_id: "empresa-1",
    client_id: "client-1",
    currency: "PYG" as const,
    subtotal: 90,
    vat_amount: 10,
    total: 100,
    doc_type: "PROFORMA" as const,
    acceptance_status: "ACCEPTED" as const,
    quotation_version: 4,
  },
  acceptance: {
    empresa_id: "empresa-1",
    sales_document_id: "quote-1",
    client_id: "client-1",
    currency_snapshot: "PYG" as const,
    subtotal_snapshot: 90,
    vat_snapshot: 10,
    total_snapshot: 100,
    quotation_version: 4,
    work_order_id: "ot-1",
  },
});

describe("post-OT sales provenance", () => {
  it("verifies the exact accepted quote, tenant, client, currency, version and work order", () => {
    expect(acceptedWorkOrderSnapshotMatches(validSnapshot())).toBe(true);

    const value = validSnapshot();
    expect(
      acceptedWorkOrderSnapshotMatches({
        ...value,
        quotation: { ...value.quotation, quotation_version: 5 },
      })
    ).toBe(false);
    expect(
      acceptedWorkOrderSnapshotMatches({
        ...value,
        acceptance: { ...value.acceptance, work_order_id: "ot-foreign" },
      })
    ).toBe(false);
    expect(
      acceptedWorkOrderSnapshotMatches({
        ...value,
        workOrder: { ...value.workOrder, empresa_id: "empresa-foreign" },
      })
    ).toBe(false);
    expect(
      acceptedWorkOrderSnapshotMatches({
        ...value,
        workOrder: { ...value.workOrder, total: 101 },
      })
    ).toBe(false);
    expect(
      acceptedWorkOrderSnapshotMatches({
        ...value,
        quotation: { ...value.quotation, total: 101 },
      })
    ).toBe(false);
    expect(
      acceptedWorkOrderSnapshotMatches({
        ...value,
        quotation: { ...value.quotation, acceptance_status: "PENDING_ACCEPTANCE" },
      })
    ).toBe(false);
    expect(acceptedWorkOrderSnapshotMatches({ ...value, acceptance: null })).toBe(false);
  });

  it("checks OT items against the immutable acceptance snapshot", () => {
    const acceptedItems: SalesQuotationAcceptance["items_snapshot"] = [
      { description: "Servicio A", quantity: 2, unit_price: 50, vat_rate: 10, line_total: 100 },
      { description: "Servicio B", quantity: 1, unit_price: 30, vat_rate: 0, line_total: 30 },
    ];
    const workOrderItems: WorkOrderItem[] = acceptedItems.map((item, index) => ({
      ...item,
      vat_rate: item.vat_rate as 0 | 5 | 10,
      id: "item-" + index,
      empresa_id: "empresa-1",
      work_order_id: "ot-1",
      created_at: "2026-01-01T00:00:00Z",
    }));

    expect(acceptedWorkOrderItemsMatch(acceptedItems, workOrderItems)).toBe(true);
    expect(acceptedWorkOrderItemsMatch(acceptedItems, [...workOrderItems].reverse())).toBe(true);
    expect(
      acceptedWorkOrderItemsMatch(acceptedItems, [
        { ...workOrderItems[0], quantity: 1 },
        workOrderItems[1],
      ])
    ).toBe(false);
  });

  it("allows only the existing post-OT document chain", () => {
    expect(canLinkSalesDocument("PROFORMA", "REMISION")).toBe(true);
    expect(canLinkSalesDocument("PROFORMA", "FACTURA")).toBe(true);
    expect(canLinkSalesDocument("REMISION", "FACTURA")).toBe(true);
    expect(canLinkSalesDocument("FACTURA", "NOTA_CREDITO")).toBe(true);
    expect(canLinkSalesDocument("NOTA_VENTA", "FACTURA")).toBe(false);
    expect(canLinkSalesDocument("REMISION", "REMISION")).toBe(false);
    expect(canLinkSalesDocument("FACTURA", "REMISION")).toBe(false);
    expect(canLinkSalesDocument("PROFORMA", "NOTA_CREDITO")).toBe(false);
  });

  it("retains multiple partial branches and follows exact IDs through invoices and credits", () => {
    const descendants = salesDocumentsInSourceChain("quote-1", [
      { id: "rem-1", source_document_id: "quote-1" },
      { id: "rem-2", source_document_id: "quote-1" },
      { id: "invoice-1", source_document_id: "rem-1" },
      { id: "credit-1", source_document_id: "invoice-1" },
      { id: "cycle", source_document_id: "credit-1" },
      { id: "quote-1", source_document_id: "cycle" },
      { id: "unrelated", source_document_id: "other-quote" },
    ]);

    expect(descendants.map((document) => document.id)).toEqual([
      "rem-1",
      "rem-2",
      "invoice-1",
      "credit-1",
      "cycle",
    ]);
  });

  it("keeps legacy NOTA_VENTA readable without making it creatable in the current form", () => {
    expect(SALES_DOC_TYPE_LABELS.NOTA_VENTA).toBe("Nota de Venta");
    expect(SALES_DOC_FORM_TYPES).not.toContain("NOTA_VENTA" satisfies SalesDocType);
  });
});
