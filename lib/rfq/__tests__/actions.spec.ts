import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  profile: vi.fn(),
  client: vi.fn(),
  admin: vi.fn(),
  refresh: vi.fn(),
  workspace: vi.fn(),
  analyze: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireProfile: m.profile }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
vi.mock("../document-analysis", () => ({ analyzeQuoteDocument: m.analyze }));
vi.mock("../service", async (original) => ({
  ...await original<typeof import("../service")>(), loadRfqWorkspace: m.workspace,
}));
import {
  saveAllocationAction,
  authorizeAllocationAction,
  previewOrdersAction,
  confirmOrdersAction,
  reviewQuoteAction,
} from "@/app/(internal)/rfqs/[id]/workflow-actions";
import { resolveSupplierInvitation } from "../offer-submission";
import { createCanonicalRfq, submitCanonicalOffer } from "../service";
const id = "10000000-0000-4000-8000-000000000001";
describe("RFQ server actions and service boundaries", () => {
  let db: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.clearAllMocks();
    db = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { rfq_id: id, lines: [{ quote_version_item_id: id, quantity: 2 }] }, error: null }),
      }),
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
    m.workspace.mockResolvedValue({ rfq: { purpose: "COST_DISCOVERY" } });
  });
  it("blocks unresolved Procurement reviews before save, authorize, preview and confirmation RPCs", async () => {
    m.workspace.mockResolvedValue({ rfq: { purpose: "PROCUREMENT" }, items: [], offers: [] });
    expect((await saveAllocationAction(id, [{ quote_version_item_id: id, quantity: 2 }], "Precio conveniente", 0)).error).toMatch(/sin revisión/);
    expect((await authorizeAllocationAction(id, true)).error).toMatch(/sin revisión/);
    expect((await previewOrdersAction(id)).error).toMatch(/sin revisión/);
    expect((await confirmOrdersAction(id, "hash", true)).error).toMatch(/sin revisión/);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("rechecks real extraction server-side and rejects a fabricated matching client transcription", async () => {
    const offer = { id, rfq_item_id: id, quote_version_id: id, precio_unitario: 1000, currency: "PYG", tax_rate: 10, vat_included: true, available_quantity: 100, lead_time_days: 5, freight: 0, payment_terms: "Contado", valid_until: "2099-01-01" };
    const actual = { ...offer, precio_unitario: 1200 };
    m.workspace.mockResolvedValue({ rfq: { purpose: "PROCUREMENT" }, items: [], offers: [offer] });
    m.analyze.mockResolvedValue({ facts: [actual], extraction: { text: "Price 1200" }, comparison: [] });
    expect((await reviewQuoteAction(id, id, [offer], "Acepto todo")).error).toMatch(/cada diferencia/);
    expect(db.rpc).not.toHaveBeenCalled();
    const result = await reviewQuoteAction(id, id, [], "unused", [{ itemId: id, field: "precio_unitario", structured: 1000, document: 1200, decision: "verified_original" }]);
    expect(result.error).toBeNull();
    expect(db.rpc).toHaveBeenCalledWith("rfq_review_quote", expect.objectContaining({
      p_extraction: expect.objectContaining({ reviewPolicy: "field-review-v1", automaticFacts: [actual], humanTranscription: [offer] }),
      p_comparison: expect.objectContaining({ human: [] }),
    }));
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
