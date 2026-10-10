import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProfile: vi.fn(), logAudit: vi.fn(), revalidatePath: vi.fn(), rpc: vi.fn(),
  from: vi.fn(() => { throw new Error("unmatch must be one transactional RPC"); }),
}));
vi.mock("@/lib/auth", () => ({ requireProfile: mocks.requireProfile, requireEmpresaId: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
import { unmatchOrder } from "@/app/(internal)/invoices/[id]/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  mocks.requireProfile.mockResolvedValue({ id: "authorized-local", empresa_id: "local" });
});

describe("B11 unmatch action - canonical transactional boundary", () => {
  it("returns the DB denial without audit or success revalidation", async () => {
    const error = { code: "55000", message: "No se puede modificar el vinculo OC de una factura apta para pago o pagada." };
    mocks.rpc.mockResolvedValue({ data: null, error });
    expect(await unmatchOrder("invoice", "match", "order")).toEqual({ error: error.message });
    expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("fails closed for a missing or malformed RPC result", async () => {
    for (const data of [null, {}, { ok: false }]) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect((await unmatchOrder("invoice", "match", "order")).error).toBeTruthy();
    }
    expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("passes every identity and tenant in one RPC and revalidates only after success", async () => {
    expect(await unmatchOrder("invoice", "match", "order")).toEqual({ error: null });
    expect(mocks.requireProfile).toHaveBeenCalledWith(["administracion", "admin"]);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("unmatch_invoice_order", {
      p_empresa_id: "local", p_invoice_id: "invoice",
      p_expected_match_id: "match", p_expected_order_id: "order",
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.logAudit).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/orders/order");
  });

  it("does not reach the database when role authority is denied", async () => {
    mocks.requireProfile.mockRejectedValue(new Error("denied"));
    await expect(unmatchOrder("invoice", "match", "order")).rejects.toThrow("denied");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });
});
