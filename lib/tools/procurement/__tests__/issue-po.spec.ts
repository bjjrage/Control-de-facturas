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

  it("issuePurchaseOrderDomainService: emite orden en authorized_orders, inserta items y marca draft como ISSUED", async () => {
    let draftStatus = "DRAFT";
    let insertedOrder: any = null;
    let insertedItems: any[] = [];

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === "purchase_order_drafts") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn((col: string, val: string) => {
              return {
                eq: vi.fn((col2: string, val2: string) => {
                  return {
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: validDraftId,
                        empresa_id: empresaId,
                        rfq_id: validRfqId,
                        supplier_id: validSupplierId,
                        supplier_nombre: "Proveedor Industrial S.A.",
                        status: draftStatus,
                        total_price_pyg: 15000000,
                        currency: "PYG",
                        project_id: "p0000000-0000-4000-8000-000000000001",
                      },
                      error: null,
                    }),
                  };
                }),
              };
            }),
            update: vi.fn((updates: any) => ({
              eq: vi.fn((col: string, val: string) => ({
                eq: vi.fn((col2: string, val2: string) => {
                  draftStatus = updates.status;
                  return Promise.resolve({ error: null });
                }),
              })),
            })),
          };
        }

        if (table === "purchase_order_draft_items") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "item-1",
                  purchase_order_draft_id: validDraftId,
                  description: "Cemento CPN40 x 50kg",
                  quantity: 200,
                  unit: "bolsas",
                  price_pyg: 75000,
                },
              ],
              error: null,
            }),
          };
        }

        if (table === "authorized_orders") {
          return {
            insert: vi.fn((payload: any) => {
              insertedOrder = { ...payload, id: "oc-uuid-001", code: "OC-2026-0042" };
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: { id: "oc-uuid-001", code: "OC-2026-0042", status: "AUTORIZADO" },
                  error: null,
                }),
              };
            }),
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          };
        }

        if (table === "authorized_order_items") {
          return {
            insert: vi.fn((items: any[]) => {
              insertedItems = items;
              return Promise.resolve({ error: null });
            }),
          };
        }

        if (table === "audit_logs") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }

        return {} as any;
      }),
    };

    const result = await issuePurchaseOrderDomainService({
      db: mockDb as any,
      empresaId,
      userId,
      poDraftId: validDraftId,
      confirmIssuance: true,
    });

    expect(result.orderId).toBe("oc-uuid-001");
    expect(result.orderCode).toBe("OC-2026-0042");
    expect(result.status).toBe("AUTORIZADO");
    expect(result.totalPrice).toBe(15000000);
    expect(result.providerName).toBe("Proveedor Industrial S.A.");
    expect(draftStatus).toBe("ISSUED");
    expect(insertedItems.length).toBe(1);
    expect(insertedItems[0].product).toBe("Cemento CPN40 x 50kg");
    expect(insertedItems[0].quantity).toBe(200);
  });

  it("issuePurchaseOrderDomainService State Revalidation: no permite reemitir si el draft ya es ISSUED", async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === "purchase_order_drafts") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: validDraftId,
                    empresa_id: empresaId,
                    status: "ISSUED",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {} as any;
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

  it("issuePurchaseOrderDomainService: rechaza si el borrador pertenece a otro tenant", async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === "purchase_order_drafts") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "No rows found" },
                }),
              }),
            }),
          };
        }
        return {} as any;
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
