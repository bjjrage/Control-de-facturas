import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTool } from "@/lib/agent/registry";
import { sendRfqTool, SendRfqInputSchema } from "@/lib/tools/procurement/send-rfq";
import { sendRfqDomainService } from "@/lib/procurement/send-rfq-service";
import "@/lib/tools"; // registrar tools
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";

describe("BATCH 3: send_rfq Tool & Domain Service", () => {
  const actor: AgentToolContext = {
    empresaId: "empresa-1",
    userId: "user-1",
    role: "comercial",
    actorType: "user",
    source: "web",
  };

  it("send_rfq registrado como LEVEL 2 EXTERNAL_ACTION con roles comercial/admin", () => {
    const tool = getTool("send_rfq");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe(2);
    expect(tool?.requiredRoles).toContain("comercial");
    expect(tool?.requiredRoles).toContain("admin");
  });

  it("Zod Schema valida rfq_id y supplier_ids como UUIDs", () => {
    expect(() =>
      SendRfqInputSchema.parse({
        rfq_id: "not-a-uuid",
        supplier_ids: ["00000000-0000-0000-0000-000000000001"],
      })
    ).toThrow();

    expect(() =>
      SendRfqInputSchema.parse({
        rfq_id: "00000000-0000-0000-0000-000000000001",
        supplier_ids: [],
      })
    ).toThrow();

    expect(() =>
      SendRfqInputSchema.parse({
        rfq_id: "a0000000-0000-4000-8000-000000000001",
        supplier_ids: ["b0000000-0000-4000-8000-000000000002"],
        notes: "Envio urgente",
      })
    ).not.toThrow();
  });

  it("sendRfqDomainService: transiciona RFQ de BORRADOR a COTIZANDO y genera rfq_providers", async () => {
    let rfqStatus = "BORRADOR";
    let insertedProviders: any[] = [];
    let updatedRfq: any = null;

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === "rfqs") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn(function (this: any, col: string, val: string) {
              this.filters = this.filters || {};
              this.filters[col] = val;
              return this;
            }),
            single: vi.fn(async function (this: any) {
              if (this.filters?.empresa_id !== "empresa-1") {
                return { data: null, error: { message: "Not found" } };
              }
              return {
                data: {
                  id: "rfq-1",
                  code: "RFQ-2026-0001",
                  status: rfqStatus,
                  empresa_id: "empresa-1",
                  product: "Cemento Portland",
                  quantity: 100,
                  unit: "bolsas",
                },
                error: null,
              };
            }),
            update: vi.fn((patch: any) => {
              updatedRfq = patch;
              rfqStatus = patch.status || rfqStatus;
              return {
                eq: vi.fn().mockReturnThis(),
              };
            }),
          };
        }

        if (table === "rfq_providers") {
          return {
            upsert: vi.fn((rows: any[]) => {
              insertedProviders = rows;
              return { error: null };
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as unknown as SupabaseClient;

    const result = await sendRfqDomainService({
      db: mockDb,
      empresaId: "empresa-1",
      userId: "user-1",
      rfqId: "rfq-1",
      providerIds: ["prov-1", "prov-2"],
      notes: "Por favor enviar antes del viernes",
    });

    expect(result.rfqId).toBe("rfq-1");
    expect(result.status).toBe("COTIZANDO");
    expect(result.providersInvitedCount).toBe(2);
    expect(rfqStatus).toBe("COTIZANDO");
    expect(insertedProviders.length).toBe(2);
    expect(insertedProviders[0].provider_id).toBe("prov-1");
    expect(insertedProviders[1].provider_id).toBe("prov-2");
  });

  it("sendRfqDomainService State Revalidation: rechaza si la RFQ ya está CANCELADO o AUTORIZADO", async () => {
    const mockDbFactory = (status: string) =>
      ({
        from: vi.fn((table: string) => {
          if (table === "rfqs") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "rfq-1",
                  code: "RFQ-2026-0001",
                  status,
                  empresa_id: "empresa-1",
                },
                error: null,
              }),
            };
          }
          return {};
        }),
      } as unknown as SupabaseClient);

    // Si está cancelado
    await expect(
      sendRfqDomainService({
        db: mockDbFactory("CANCELADO"),
        empresaId: "empresa-1",
        userId: "user-1",
        rfqId: "rfq-1",
        providerIds: ["prov-1"],
      })
    ).rejects.toThrow(/CANCELADO/);

    // Si ya está autorizado con OC
    await expect(
      sendRfqDomainService({
        db: mockDbFactory("AUTORIZADO"),
        empresaId: "empresa-1",
        userId: "user-1",
        rfqId: "rfq-1",
        providerIds: ["prov-1"],
      })
    ).rejects.toThrow(/orden de compra autorizada/);
  });
});
