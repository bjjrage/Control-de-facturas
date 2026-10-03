import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  profile: vi.fn(),
  client: vi.fn(),
  admin: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireProfile: m.profile }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
import {
  saveAllocationAction,
  authorizeAllocationAction,
  previewOrdersAction,
  confirmOrdersAction,
} from "@/app/(internal)/rfqs/[id]/workflow-actions";
import { resolveSupplierInvitation } from "../offer-submission";
import { createCanonicalRfq, submitCanonicalOffer } from "../service";
const id = "10000000-0000-4000-8000-000000000001";
describe("RFQ server actions and service boundaries", () => {
  let db: { rpc: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.clearAllMocks();
    db = {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: { id, revision: 1 }, error: null }),
    };
    m.profile.mockResolvedValue({
      id,
      empresa_id: id,
      active: true,
      role: "admin",
    });
    m.client.mockResolvedValue(db);
  });
  it("save allocation authenticates, sends only IDs/qty and never creates OC", async () => {
    const r = await saveAllocationAction(
      id,
      [{ quote_version_item_id: id, quantity: 2, unit_price: 1 }],
      "Human selected supplier",
      0,
    );
    expect(r.error).toBeNull();
    expect(m.profile).toHaveBeenCalledWith([
      "comercial",
      "administracion",
      "admin",
    ]);
    expect(db.rpc).toHaveBeenCalledWith("rfq_save_allocation", {
      p_rfq_id: id,
      p_lines: [{ quote_version_item_id: id, quantity: 2 }],
      p_justification: "Human selected supplier",
      p_expected_revision: 0,
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("authorization is separate from preview and confirmation", async () => {
    await authorizeAllocationAction(id, true);
    expect(db.rpc).toHaveBeenLastCalledWith("rfq_authorize_allocation", {
      p_allocation_id: id,
      p_confirm: true,
    });
    await previewOrdersAction(id);
    expect(db.rpc).toHaveBeenLastCalledWith("rfq_preview_orders", {
      p_allocation_id: id,
    });
    await confirmOrdersAction(id, "hash", true);
    expect(db.rpc).toHaveBeenLastCalledWith("rfq_confirm_orders", {
      p_allocation_id: id,
      p_preview_hash: "hash",
      p_confirm: true,
    });
  });
  it.each([
    saveAllocationAction,
    authorizeAllocationAction,
    previewOrdersAction,
    confirmOrdersAction,
  ])("inactive profile rejected before DB", async (action) => {
    m.profile.mockResolvedValue({ active: false });
    const r = await (action as any)(id, [], "reason", 0);
    expect(r.error).toMatch(/inactiva/);
    expect(m.client).not.toHaveBeenCalled();
  });
  it("RPC error fails closed without fallback", async () => {
    db.rpc.mockResolvedValue({
      data: null,
      error: { message: "schema cache unavailable" },
    });
    expect((await confirmOrdersAction(id, "hash", true)).error).toBe(
      "schema cache unavailable",
    );
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("purpose must be explicit before any create RPC", async () => {
    await expect(
      createCanonicalRfq(db as any, { product: "A" }, [
        { descripcion: "A", cantidad: 1, unidad: "un" },
      ]),
    ).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("supplier price/terms require complete finite structured facts", async () => {
    await expect(
      submitCanonicalOffer(db as any, "token", {}, [], id),
    ).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("invalid magic token rejected without DB query", async () => {
    const fake = { from: vi.fn() };
    await expect(resolveSupplierInvitation(fake as any, "x")).rejects.toThrow(
      /inválido/,
    );
    expect(fake.from).not.toHaveBeenCalled();
  });
  it.each(["tenant", "revoked", "expired"])(
    "magic-link %s rejection",
    async (reason) => {
      const rp = {
        empresa_id: id,
        providers: {
          active: true,
          empresa_id: reason === "tenant" ? "other" : id,
        },
        rfqs: { empresa_id: id, status: "COTIZANDO", expires_at: "2099-01-01" },
        token_revoked_at: reason === "revoked" ? "2026-01-01" : null,
        token_expires_at: reason === "expired" ? "2000-01-01" : null,
      };
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: rp, error: null }),
      };
      await expect(
        resolveSupplierInvitation({ from: () => chain } as any, "a".repeat(64)),
      ).rejects.toThrow(/inválido/);
    },
  );
});
