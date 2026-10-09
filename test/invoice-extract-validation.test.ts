import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireProfile: vi.fn(), findProvider: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireProfile: mocks.requireProfile }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/provider-lookup", () => ({ findProviderByTaxId: mocks.findProvider }));

import { extractInvoiceFromPhoto } from "@/app/(internal)/invoices/extract-actions";

function extraction(over: Record<string, unknown> = {}) {
  return {
    provider_name: "Cementos Paraguay QA S.A.",
    provider_tax_id: "800111112",
    invoice_number: "001-001-0000001",
    invoice_date: "2026-10-08",
    subtotal: 3709091,
    vat: 370909,
    total: 4080000,
    timbrado: null,
    order_reference: null,
    product_description: "Cemento",
    items: [{ description: "Cemento", quantity: 60, unit: "bolsa", unit_price: 68000, subtotal: 4080000 }],
    ...over,
  };
}

function mockOpenAI(parsed: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(parsed) } }] }),
  })));
}

function photoForm(): FormData {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array([1, 2, 3])], "factura.jpg", { type: "image/jpeg" }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "test-key";
  mocks.requireProfile.mockResolvedValue({ id: "user-1", empresa_id: "emp-1" });
  mocks.findProvider.mockResolvedValue({ id: "prov-1" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
});

describe("extractInvoiceFromPhoto con validación aritmética", () => {
  it("adjunta validación VALIDA en extracción consistente", async () => {
    mockOpenAI(extraction());
    const result = await extractInvoiceFromPhoto(photoForm());
    expect(result.error).toBeNull();
    expect(result.data?.validation?.status).toBe("VALIDA");
    expect(result.data?.provider_id).toBe("prov-1");
  });

  it("adjunta validación REVISION ante total inconsistente (INV-12)", async () => {
    mockOpenAI(extraction({ total: 4800000 }));
    const result = await extractInvoiceFromPhoto(photoForm());
    expect(result.error).toBeNull();
    expect(result.data?.validation?.status).toBe("REVISION");
    expect(result.data?.validation?.issues.join(" ")).toContain("4800000");
    // El diálogo puede mostrar el aviso pero los datos siguen disponibles para revisión humana.
    expect(result.data?.total).toBe(4800000);
  });

  it("total ilegible llega como null con REVISION (nunca estimado)", async () => {
    mockOpenAI(extraction({ total: null, subtotal: null, vat: null }));
    const result = await extractInvoiceFromPhoto(photoForm());
    expect(result.error).toBeNull();
    expect(result.data?.total).toBeNull();
    expect(result.data?.validation?.status).toBe("REVISION");
  });

  it("errores de lectura siguen siendo error (NO_PARSEABLE a nivel archivo)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, text: async () => "límite" })));
    const result = await extractInvoiceFromPhoto(photoForm());
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/OpenAI|leer/i);
  });
});
