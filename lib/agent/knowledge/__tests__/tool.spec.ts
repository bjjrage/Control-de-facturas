import { describe, expect, it, vi } from "vitest";
import { getTool } from "@/lib/agent/registry";
import { getErpKnowledgeTool } from "@/lib/tools/knowledge/get-erp-knowledge";

describe("get_erp_knowledge tool", () => {
  it("se registra como lectura y no toca la base", async () => {
    const tool = getTool("get_erp_knowledge");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe(0);

    const db = { from: vi.fn(), rpc: vi.fn() } as unknown as import("@supabase/supabase-js").SupabaseClient;
    const output = await getErpKnowledgeTool.handler(
      { empresaId: "empresa-1", userId: "user-1", role: "admin", actorType: "user", source: "test" },
      { topic: "tesorería" },
      { db }
    );

    expect(output.static_only).toBe(true);
    expect(output.matches[0]?.id).toBe("finance-and-treasury");
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
