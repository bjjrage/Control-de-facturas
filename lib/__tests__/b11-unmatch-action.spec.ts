import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProfile: vi.fn(), logAudit: vi.fn(), revalidatePath: vi.fn(),
  result: { data: [{ id: "match" }], error: null } as {
    data: { id: string }[] | null; error: { message: string; code?: string } | null;
  },
  filters: [] as [string, string, string][],
}));
vi.mock("@/lib/auth", () => ({ requireProfile: mocks.requireProfile, requireEmpresaId: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    // Allowlist estricta: solo las tablas del vínculo de cabecera y de la
    // limpieza de conciliación por ítem (Remediation 3). Cualquier otra tabla
    // rompe el test: la acción no debe tocar nada más.
    expect([
      "invoice_order_matches",
      "invoice_items",
      "authorized_order_items",
      "invoice_item_matches",
    ]).toContain(table);
    const query: Record<string, (...args: never[]) => unknown> = {};
    query.delete = () => query;
    query.eq = ((key: string, value: string) => {
      mocks.filters.push([table, key, value]); return query;
    }) as never;
    query.in = ((key: string, values: string[]) => {
      mocks.filters.push([table, key, `in:${values.join(",")}`]); return query;
    }) as never;
    query.select = (() => query) as never;
    query.maybeSingle = (async () => mocks.result) as never;
    query.single = (async () => mocks.result) as never;
    (query as { then: unknown }).then = (
      onF: (v: unknown) => unknown,
      onR?: (e: unknown) => unknown
    ) => Promise.resolve(mocks.result).then(onF, onR);
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
    // Borrado del vínculo de cabecera con las tres identidades…
    expect(mocks.filters.slice(0, 3)).toEqual([
      ["invoice_order_matches", "id", "match"],
      ["invoice_order_matches", "invoice_id", "invoice"],
      ["invoice_order_matches", "authorized_order_id", "order"],
    ]);
    // …más la limpieza de conciliación por ítem, siempre acotada por empresa
    // y por las identidades del vínculo (sin esto quedarían cantidades fantasma).
    expect(mocks.filters.slice(3)).toEqual([
      ["invoice_items", "invoice_id", "invoice"],
      ["invoice_items", "empresa_id", "local"],
      ["authorized_order_items", "order_id", "order"],
      ["authorized_order_items", "empresa_id", "local"],
      ["invoice_item_matches", "empresa_id", "local"],
      ["invoice_item_matches", "invoice_item_id", "in:match"],
    ]);
    expect(mocks.logAudit).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/orders/order");
  });
  it("does not reach the database when role authority is denied", async () => {
    mocks.requireProfile.mockRejectedValue(new Error("denied"));
    await expect(unmatchOrder("invoice", "match", "order")).rejects.toThrow("denied");
    expect(mocks.filters).toEqual([]); expect(mocks.logAudit).not.toHaveBeenCalled();
  });
});
