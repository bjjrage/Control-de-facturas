import { describe, it, expect, vi } from "vitest";
import { IssuePurchaseOrderInputSchema } from "../issue-purchase-order";
import { issuePurchaseOrderDomainService } from "@/lib/procurement/issue-po-service";
import { toolRegistry } from "@/lib/agent/registry";

describe("BATCH 3: issue_purchase_order Tool & Domain Service", () => {
  const empresaId = "e0000000-0000-4000-8000-000000000001";
  const userId = "u0000000-0000-4000-8000-000000000001";
  const validDraftId = "d0000000-0000-4000-8000-000000000001";
  const validRfqId = "r0000000-0000-4000-8000-000000000001";
  const validSupplierId = "s0000000-0000-4000-8000-000000000001";

  it("issue_purchase_order registrado como LEVEL 3 BUSINESS_COMMITMENT con roles comercial/admin", () => {
    const tool = toolRegistry.get("issue_purchase_order");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe(3);
    expect(tool?.requiredRoles).toContain("comercial");
    expect(tool?.requiredRoles).toContain("admin");
  });

  it("Zod Schema valida po_draft_id UUID y confirm_issuance true", () => {
    expect(() =>
      IssuePurchaseOrderInputSchema.parse({
        po_draft_id: "invalid-uuid",
        confirm_issuance: true,
      })
    ).toThrow();

    expect(() =>
      IssuePurchaseOrderInputSchema.parse({
        po_draft_id: validDraftId,
        confirm_issuance: false,
      })
    ).toThrow();

    expect(() =>
      IssuePurchaseOrderInputSchema.parse({
        po_draft_id: validDraftId,
        confirm_issuance: true,
      })
    ).not.toThrow();
  });

  it("issuePurchaseOrderDomainService: emite orden via issue_purchase_order_atomic RPC de forma 100% atomica", async () => {
    let rpcCalledWith: any = null;

    const mockDb = {
      rpc: vi.fn((fnName: string, args: any) => {
        if (fnName === "issue_purchase_order_atomic") {
          rpcCalledWith = args;
          return Promise.resolve({
            data: {
              orderId: "oc-uuid-001",
              orderCode: "OC-2026-0042",
              poDraftId: args.p_po_draft_id,
              rfqId: validRfqId,
              providerId: validSupplierId,
              providerName: "Proveedor Industrial S.A.",
              totalPrice: 15000000,
              currency: "PYG",
              itemsCount: 2,
              status: "AUTORIZADO",
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      from: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue({ error: null }),
      })),
    };

    const result = await issuePurchaseOrderDomainService({
      db: mockDb as any,
      empresaId,
      userId,
      poDraftId: validDraftId,
      confirmIssuance: true,
    });

    expect(mockDb.rpc).toHaveBeenCalledWith("issue_purchase_order_atomic", {
      p_empresa_id: empresaId,
      p_user_id: userId,
      p_po_draft_id: validDraftId,
      p_confirm_issuance: true,
    });

    expect(result.orderId).toBe("oc-uuid-001");
    expect(result.orderCode).toBe("OC-2026-0042");
    expect(result.status).toBe("AUTORIZADO");
    expect(result.totalPrice).toBe(15000000);
    expect(result.itemsCount).toBe(2);
  });

  it("PO item insert failure -> RPC atomic rollback total en PostgreSQL", async () => {
    // Si falla la inserción de ítems (ej. constraint check quantity > 0 o error FK),
    // el RPC de PostgreSQL aborta la transacción completa. El domain service propaga el error.
    const mockDb = {
      rpc: vi.fn((fnName: string) => {
        if (fnName === "issue_purchase_order_atomic") {
          return Promise.resolve({
            data: null,
            error: {
              message: "new row for relation \"authorized_order_items\" violates check constraint \"authorized_order_items_quantity_check\"",
              code: "23514",
            },
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    await expect(
      issuePurchaseOrderDomainService({
        db: mockDb as any,
        empresaId,
        userId,
        poDraftId: validDraftId,
        confirmIssuance: true,
      })
    ).rejects.toThrow(/Error en emision atomica de Orden de Compra:.*violates check constraint/);
  });

  it("PO draft status update failure -> RPC atomic rollback total en PostgreSQL", async () => {
    // Si el draft no se encuentra en estado DRAFT (o falla la actualización a ISSUED por concurrencia),
    // el RPC aborta y lanza excepción garantizando 0 filas creadas en authorized_orders o authorized_order_items.
    const mockDb = {
      rpc: vi.fn((fnName: string) => {
        if (fnName === "issue_purchase_order_atomic") {
          return Promise.resolve({
            data: null,
            error: {
              message: "La Orden de Compra ya fue emitida previamente para este borrador (id=" + validDraftId + ")",
            },
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    await expect(
      issuePurchaseOrderDomainService({
        db: mockDb as any,
        empresaId,
        userId,
        poDraftId: validDraftId,
        confirmIssuance: true,
      })
    ).rejects.toThrow("ya fue emitida previamente");
  });

  it("Tenant isolation failure -> RPC atomic rollback", async () => {
    const mockDb = {
      rpc: vi.fn((fnName: string) => {
        if (fnName === "issue_purchase_order_atomic") {
          return Promise.resolve({
            data: null,
            error: {
              message: "Borrador de Orden de Compra no encontrado o no pertenece a tu empresa (id=" + validDraftId + ")",
            },
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    await expect(
      issuePurchaseOrderDomainService({
        db: mockDb as any,
        empresaId: "empresa-intrusa",
        userId,
        poDraftId: validDraftId,
        confirmIssuance: true,
      })
    ).rejects.toThrow("Borrador de Orden de Compra no encontrado o no pertenece a tu empresa");
  });
});
