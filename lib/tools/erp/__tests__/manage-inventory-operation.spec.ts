import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { getTool } from "@/lib/agent/registry";
import { manageInventoryOperationTool } from "@/lib/tools/erp/manage-inventory-operation";

vi.mock("@/app/(internal)/inventory/actions", () => ({
  createWarehousePortalLink: vi.fn().mockResolvedValue({
    error: null,
    token: "one-time-bearer-token",
    url: "https://erp.example.test/warehouse/one-time-bearer-token",
  }),
}));

describe("manage_inventory_operation", () => {
  it("requires an administrator for inventory mutations", () => {
    expect(getTool("manage_inventory_operation")?.requiredRoles).toEqual(["administracion", "admin"]);
  });

  it("does not return a warehouse portal bearer token to the agent", async () => {
    const result = await manageInventoryOperationTool.handler(
      { empresaId: "empresa-1", userId: "user-1", role: "admin", actorType: "user", source: "web" } as AgentToolContext,
      { operation: "create_portal_link", location_id: "00000000-0000-4000-a000-000000000001" },
      { db: {} as SupabaseClient }
    );

    const serialized = JSON.stringify(result);
    expect(result).toMatchObject({ portal_link_created: true });
    expect(result.message).toContain("token no se expone");
    expect(serialized).not.toContain("one-time-bearer-token");
    expect(serialized).not.toContain("https://erp.example.test/warehouse/");
  });
});
