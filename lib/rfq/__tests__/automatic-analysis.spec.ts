import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import type { ComparativeLine, RfqItem } from "../domain";

const m = vi.hoisted(() => ({ submit: vi.fn(), workspace: vi.fn(), admin: vi.fn(), refresh: vi.fn() }));
vi.mock("../service", async (importOriginal) => ({
  ...await importOriginal<typeof import("../service")>(),
  submitCanonicalOffer: m.submit,
  loadRfqWorkspace: m.workspace,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
import { submitMultiItemQuote } from "@/app/cotizar/[token]/actions";
import { analyzeQuoteDocument, analyzeRfqDocuments } from "../document-analysis";

const id = "10000000-0000-4000-8000-000000000001";
const versionId = "20000000-0000-4000-8000-000000000001";
const token = "a".repeat(64);
const items: RfqItem[] = [{ id, descripcion: "Cemento", cantidad: 5, unidad: "bolsa", producto_id: null }];
const offer: ComparativeLine = {
  id, rfq_item_id: id, quote_version_id: versionId, provider_id: id,
  provider_name: "Ferretería sintética", version_number: 1,
  precio_unitario: 16000, currency: "PYG", tax_rate: 10,
  available_quantity: 5, lead_time_days: 2, freight: 0,
  payment_terms: "Contado", valid_until: "2099-01-01T23:59:59.000Z",
  vat_included: false, attachment_id: id, review_id: null, revoked: false,
};

// Only transport/DB are simulated. No extracted facts are placed in fixtures.
function fixture(rows: Array<Record<string, string>> = [
  { Descripción: "Cemento", "Precio unitario": "15000", Moneda: "PYG" },
]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Presupuesto");
  const bytes: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const file = new File([new Uint8Array(bytes)], "presupuesto-ferreteria.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const invitation = {
    id, rfq_id: id, provider_id: id, empresa_id: id,
    providers: { active: true, empresa_id: id },
    rfqs: { empresa_id: id, status: "COTIZANDO", expires_at: "2099-01-01", project_id: null },
  };
  const filters: Array<[string, string, unknown]> = [];
  const storage = {
    upload: vi.fn().mockResolvedValue({ error: null }),
    download: vi.fn(async () => ({ data: new Blob([new Uint8Array(bytes)]), error: null })),
    remove: vi.fn(),
  };
  const writes = vi.fn();
  const db = {
    from: (table: string) => {
      const chain = {
        select() { return this; },
        eq(field: string, value: unknown) { filters.push([table, field, value]); return this; },
        order: async () => ({ data: items, error: null }),
        insert(value: unknown) { writes(table, value); return this; },
        single: async () => ({ data: { id }, error: null }),
        maybeSingle: async () => ({ data: table === "rfq_providers" ? invitation : {
          id, bucket: "quote-pdfs", path: "synthetic.xlsx", mime_type: file.type,
          original_sha256: createHash("sha256").update(bytes).digest("hex"),
        }, error: null }),
        then(resolve: (value: { error: null }) => unknown) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return chain;
    },
    storage: { from: () => storage },
    rpc: vi.fn(),
  };
  const fd = new FormData();
  for (const [key, value] of Object.entries({
    [`price_${id}`]: "16000", [`available_${id}`]: "5", [`tax_${id}`]: "10", [`lead_${id}`]: "2",
    budget_number: "FER-123", currency: "PYG", valid_until: "2099-01-01", freight: "0", payment_terms: "Contado",
  })) fd.set(key, value);
  fd.set("attachment", file);
  return { db: db as unknown as SupabaseClient, storage, filters, writes, fd, invitation, rpc: db.rpc };
}

describe("automatic Administration supplier document analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.submit.mockResolvedValue({ versionId, versionNumber: 1, totalPrice: 80000 });
    m.workspace.mockResolvedValue({ items, offers: [offer] });
  });
  it("external submit runs the real reader/mapper/comparison after committing; never reviews or purchases", async () => {
    const f = fixture(); m.admin.mockReturnValue(f.db);
    const result = await submitMultiItemQuote(token, f.fd);
    expect(result).toMatchObject({ error: null, versionId, analysis: { status: "REVIEW_REQUIRED", discrepancies: 8 } });
    expect(f.storage.download).toHaveBeenCalledOnce();
    expect(m.submit.mock.invocationCallOrder[0]).toBeLessThan(f.storage.download.mock.invocationCallOrder[0]);
    const data = await analyzeQuoteDocument(f.db, id, items, [offer]);
    expect(data.facts).toEqual([expect.objectContaining({ rfq_item_id: id, precio_unitario: 15000, currency: "PYG" })]);
    expect(data.comparison).toContainEqual(expect.objectContaining({ field: "precio_unitario", structured: 16000, document: 15000 }));
    expect(data.facts[0].tax_rate).toBeUndefined();
    expect(data.facts[0].available_quantity).toBeUndefined();
    expect(data.facts[0].freight).toBeUndefined();
    expect(f.filters).toContainEqual(["attachments", "empresa_id", id]);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.writes.mock.calls.every(([table]) => ["attachments", "cost_observations"].includes(table))).toBe(true);
    expect(result).not.toHaveProperty("facts");
    expect(result).not.toHaveProperty("offers");
    expect(m.refresh).toHaveBeenCalledWith("/rfqs/[id]", "page");
  });
  it("analysis failure after commit reports a saved version, not a failed/duplicate submission", async () => {
    const f = fixture(); m.admin.mockReturnValue(f.db);
    f.storage.download.mockRejectedValue(new Error("Storage unavailable"));
    expect(await submitMultiItemQuote(token, f.fd)).toMatchObject({ error: null, versionId, analysis: { status: "UNAVAILABLE", discrepancies: null } });
    expect(m.submit).toHaveBeenCalledOnce();
    const prepared = await analyzeRfqDocuments(f.db, id, items, [offer]);
    expect(prepared[versionId].error).toMatch(/Storage unavailable/);
    expect(prepared[versionId].data).toBeNull();
  });
  it("server workspace prepares current-version facts without a manual extraction action", async () => {
    const f = fixture();
    const prepared = await analyzeRfqDocuments(f.db, id, items, [offer]);
    expect(prepared[versionId].data?.facts[0].precio_unitario).toBe(15000);
    expect(offer.precio_unitario).toBe(16000);
    expect(offer.review_id).toBeNull();
    expect(f.writes).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("revoked token blocks submit, upload and extraction", async () => {
    const f = fixture(); m.admin.mockReturnValue(f.db);
    Object.assign(f.invitation, { token_revoked_at: "2026-10-01" });
    expect((await submitMultiItemQuote(token, f.fd)).error).toMatch(/revocado/);
    expect(f.storage.upload).not.toHaveBeenCalled();
    expect(f.storage.download).not.toHaveBeenCalled();
    expect(m.submit).not.toHaveBeenCalled();
  });
  it("refuses mixed-version/foreign-item inputs before storage", async () => {
    const f = fixture();
    await expect(analyzeQuoteDocument(f.db, id, items, [offer, { ...offer, quote_version_id: id }])).rejects.toThrow(/Versión/);
    await expect(analyzeQuoteDocument(f.db, id, [], [offer])).rejects.toThrow(/Versión/);
    expect(f.storage.download).not.toHaveBeenCalled();
  });
  it("rejects a checksum mismatch and leaves extraction unavailable", async () => {
    const f = fixture();
    f.storage.download.mockResolvedValue({ data: new Blob(["changed"]), error: null });
    const prepared = await analyzeRfqDocuments(f.db, id, items, [offer]);
    expect(prepared[versionId].error).toMatch(/checksum/);
    expect(prepared[versionId].data).toBeNull();
  });
  it("keeps localized ambiguous prices and unmatched descriptions unknown", async () => {
    const f = fixture([
      { Descripción: "Cemento", "Precio unitario": "15.000,00" },
      { Descripción: "Producto ajeno", "Precio unitario": "999" },
    ]);
    const prepared = await analyzeQuoteDocument(f.db, id, items, [offer]);
    expect(prepared.facts).toHaveLength(1);
    expect(prepared.facts[0].precio_unitario).toBeUndefined();
    expect(prepared.facts[0].currency).toBeUndefined();
    expect(prepared.comparison).toContainEqual(expect.objectContaining({ field: "precio_unitario", reason: "Sin evidencia extraída" }));
  });
});
