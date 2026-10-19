import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireModule: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    const filters: Array<[string, unknown[]]> = [];
    const query = {
      select: () => query,
      in: (column: string, values: unknown[]) => { filters.push([column, values]); return query; },
      eq: () => query,
      order: () => query,
      returns: async () => {
        const rows = table === "sales_documents" ? [
          { id: "invoice", doc_type: "FACTURA", status: "EMITIDA", total: 100, cobrado_amount: 0 },
          { id: "credit", doc_type: "NOTA_CREDITO", status: "EMITIDA", source_document_id: "invoice", total: 30 },
        ] : [];
        return { data: rows.filter(row => filters.every(([column, values]) => values.includes(row[column as keyof typeof row]))), error: null };
      },
    };
    return query;
  },
}) }));

import { getCobrosData } from "@/app/(internal)/cobros/section-action";

describe("#23 Cobros data", () => {
  it("loads credit notes so receivable balances can deduct them", async () => {
    const data = await getCobrosData();
    expect(data.docs.map(doc => doc.id)).toEqual(["invoice", "credit"]);
  });
});
