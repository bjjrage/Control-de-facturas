import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProfile: vi.fn(), insert: vi.fn(), update: vi.fn(), refresh: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireProfile: mocks.requireProfile }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/refresh-after-save", () => ({ refreshAfterSave: mocks.refresh }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => table === "providers" ? {
      insert: mocks.insert, update: mocks.update,
    } : { delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) },
  }),
}));

import { createProvider, updateProvider } from "@/app/(internal)/providers/actions";

function form(terms?: string) {
  const data = new FormData();
  data.set("name", "Proveedor QA");
  if (terms !== undefined) data.set("payment_terms", terms);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireProfile.mockResolvedValue({ empresa_id: "tenant-qa" });
  mocks.insert.mockImplementation(() => ({ select: () => ({ single: async () => ({ data: { id: "provider-qa" }, error: null }) }) }));
  mocks.update.mockImplementation(() => ({ eq: async () => ({ error: null }) }));
});

describe("supplier master payment terms", () => {
  it.each(["30 días", "15 días", "Contado / transferencia"])("creates and edits terms without document fields: %s", async terms => {
    expect(await createProvider(form(`  ${terms}  `))).toEqual({ error: null });
    expect(mocks.insert).toHaveBeenCalledWith({ name: "Proveedor QA", contact_name: null, email: null, phone: null, tax_id: null, payment_terms: terms });
    expect(await updateProvider("provider-qa", form(terms))).toEqual({ error: null });
    expect(mocks.update).toHaveBeenCalledWith({ name: "Proveedor QA", contact_name: null, email: null, phone: null, tax_id: null, payment_terms: terms });
    expect(mocks.requireProfile).toHaveBeenCalledWith(["admin"]);
  });

  it("preserves existing terms when an older edit form omits the field", async () => {
    await updateProvider("provider-qa", form());
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty("payment_terms");
  });

  it("allows creating a provider without terms and explicitly clearing them", async () => {
    expect(await createProvider(form())).toEqual({ error: null });
    expect(mocks.insert.mock.calls[0][0]).not.toHaveProperty("payment_terms");
    expect(await updateProvider("provider-qa", form("  "))).toEqual({ error: null });
    expect(mocks.update.mock.calls[0][0].payment_terms).toBeNull();
  });

  it("rejects oversized or file values before any write", async () => {
    const file = form();
    file.set("payment_terms", new Blob(["30 días"]), "terms.txt");
    for (const data of [form("x".repeat(501)), file]) {
      expect((await createProvider(data)).error).toBeTruthy();
      expect((await updateProvider("provider-qa", data)).error).toBeTruthy();
    }
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("retains the existing admin authorization boundary", async () => {
    mocks.requireProfile.mockRejectedValue(new Error("unauthorized"));
    await expect(createProvider(form("30 días"))).rejects.toThrow("unauthorized");
    await expect(updateProvider("provider-qa", form("30 días"))).rejects.toThrow("unauthorized");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
