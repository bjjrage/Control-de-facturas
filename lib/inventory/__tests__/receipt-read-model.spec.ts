import { describe, expect, it } from "vitest";
import { confirmedReceiptTotals } from "../receipt-read-model";

describe("confirmed receipt read model", () => {
  it("excludes drafts and voided receipts from received quantities", () => {
    expect(
      confirmedReceiptTotals([
        { status: "DRAFT", oc_recepcion_items: [{ order_item_id: "line-a", cantidad_recibida: 3 }] },
        { status: "VOIDED", oc_recepcion_items: [{ order_item_id: "line-a", cantidad_recibida: 4 }] },
        { status: "CONFIRMED", oc_recepcion_items: [{ order_item_id: "line-a", cantidad_recibida: 2 }] },
        { status: "CONFIRMED", oc_recepcion_items: [{ order_item_id: "line-b", cantidad_recibida: 5 }] },
      ]),
    ).toEqual({ "line-a": 2, "line-b": 5 });
  });
});
