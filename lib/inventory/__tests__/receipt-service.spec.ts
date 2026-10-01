import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInventoryReceipt } from "../service";

describe("canonical receipt creation service", () => {
  it("sends the complete tenant-scoped receipt payload through one atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { receipt_id: "receipt-id", created: true }, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;
    const result = await createInventoryReceipt(supabase, {
      empresaId: "company-id",
      orderId: "order-id",
      fecha: "2026-09-24",
      recibidoPor: "Receptor",
      idempotencyKey: "submit-key",
      createdBy: "actor-id",
      items: [{ orderItemId: "order-line-id", productoId: null, quantity: 2, notes: "servicio" }],
    });

    expect(result).toEqual({ data: { receiptId: "receipt-id", created: true }, error: null });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("inventory_create_receipt", {
      p_empresa_id: "company-id",
      p_order_id: "order-id",
      p_fecha: "2026-09-24",
      p_recibido_por: "Receptor",
      p_delivery_location_id: null,
      p_remision_number: null,
      p_idempotency_key: "submit-key",
      p_created_by: "actor-id",
      p_notes: null,
      p_items: [
        {
          order_item_id: "order-line-id",
          producto_id: null,
          cantidad_recibida: 2,
          notas: "servicio",
        },
      ],
    });
  });
});
