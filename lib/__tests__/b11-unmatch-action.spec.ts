import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProfile: vi.fn(), logAudit: vi.fn(), revalidatePath: vi.fn(),
  result: { data: [{ id: "match" }], error: null } as {
    data: { id: string }[] | null; error: { message: string; code?: string } | null;
  },
  filters: [] as [string, string][],
}));
vi.mock("@/lib/auth", () => ({ requireProfile: mocks.requireProfile, requireEmpresaId: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    expect(table).toBe("invoice_order_matches");
    const query = { delete: () => query, eq: (key: string, value: string) => {
      mocks.filters.push([key, value]); return query;
    }, select: async () => mocks.result };
    return query;
  },
}) }));
import { unmatchOrder } from "@/app/(internal)/invoices/[id]/actions";

beforeEach(() => {
  vi.clearAllMocks(); mocks.filters = [];
  mocks.result = { data: [{ id: "match" }], error: null };
  mocks.requireProfile.mockResolvedValue({ id: "authorized-local", empresa_id: "local" });
});
describe("B11 unmatch action — canonical DB rejection", () => {
  it("returns the business denial without audit or success revalidation", async () => {
    mocks.result = { data: null, error: { code: "55000", message: "No se puede modificar el vínculo OC de una factura apta para pago o pagada." } };
    expect(await unmatchOrder("invoice", "match", "order")).toEqual({ error: mocks.result.error!.message });
    expect(mocks.logAudit).not.toHaveBeenCalled(); expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it("does not report success for a missing/inaccessible or stale relationship", async () => {
    mocks.result.data = [];
    expect((await unmatchOrder("invoice", "match", "order")).error).toMatch(/no existe o no tenés permiso/);
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });
  it("scopes deletion to all supplied identities and audits only successful deletion", async () => {
    expect(await unmatchOrder("invoice", "match", "order")).toEqual({ error: null });
    expect(mocks.requireProfile).toHaveBeenCalledWith(["administracion", "admin"]);
    expect(mocks.filters).toEqual([["id", "match"], ["invoice_id", "invoice"], ["authorized_order_id", "order"]]);
    expect(mocks.logAudit).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/orders/order");
  });
  it("does not reach the database when role authority is denied", async () => {
    mocks.requireProfile.mockRejectedValue(new Error("denied"));
    await expect(unmatchOrder("invoice", "match", "order")).rejects.toThrow("denied");
    expect(mocks.filters).toEqual([]); expect(mocks.logAudit).not.toHaveBeenCalled();
  });
});
