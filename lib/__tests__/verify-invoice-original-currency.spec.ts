import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProfile: vi.fn(), createClient: vi.fn(), createAdminClient: vi.fn(),
  extractInvoiceFieldsFromFile: vi.fn(), persistInvoiceIdentity: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireProfile: mocks.requireProfile, requireEmpresaId: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/invoice-extraction", () => ({
  extractInvoiceFieldsFromFile: mocks.extractInvoiceFieldsFromFile,
  MAX_INVOICE_FILE_BYTES: 20 * 1024 * 1024,
}));
vi.mock("@/lib/invoice-identity", () => ({
  persistInvoiceIdentity: mocks.persistInvoiceIdentity,
  requireInvoiceIdentity: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { verifyInvoiceOriginal } from "@/app/(internal)/invoices/[id]/actions";

function makeDb() {
  const rows: Record<string, unknown> = {
    invoices: { id: "invoice-1", attachment_id: "attachment-1", provider_id: "provider-1", invoice_number: "001", invoice_date: "2026-10-17", total: 110, currency: "PYG", status: "PENDIENTE" },
    attachments: { bucket: "invoice-files", path: "provider-1/original.pdf", mime_type: "application/pdf", file_name: "original.pdf", size_bytes: 10 },
    providers: { tax_id: "80000000-1" },
  };
  return {
    from(table: string) {
      const query = {
        select: (_columns: string) => query,
        eq: (_column: string, _value: unknown) => query,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return query;
    },
    rpc: vi.fn(async () => ({ error: null })),
    storage: { from: () => ({ download: async () => ({ data: new Blob(["%PDF-test"]), error: null }) }) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const db = makeDb();
  mocks.requireProfile.mockResolvedValue({ id: "actor-1", empresa_id: "tenant-1" });
  mocks.createClient.mockResolvedValue(db);
  mocks.createAdminClient.mockReturnValue(db);
  mocks.extractInvoiceFieldsFromFile.mockResolvedValue({ data: {
    provider_tax_id: "80000000-1", invoice_number: "001", invoice_date: "2026-10-17",
    total: 110, currency: "USD", items: [],
  }, error: null });
  mocks.persistInvoiceIdentity.mockResolvedValue({ error: null });
});

describe("#6 original verification currency", () => {
  it("rejects an original whose printed currency differs from the saved invoice", async () => {
    const result = await verifyInvoiceOriginal("invoice-1");
    expect(result.error).toMatch(/moneda/i);
    expect(mocks.persistInvoiceIdentity).not.toHaveBeenCalled();
  });
});
