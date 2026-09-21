import { describe, expect, it } from "vitest";
import { getTool } from "@/lib/agent/registry";
import "@/lib/tools/index";
import { ResolveErpEntityInputSchema } from "@/lib/tools/erp/resolve-erp-entity";

describe("Rodrigo ERP V4 capability registry", () => {
  it("expone lecturas V4 y separa las mutaciones aprobables", () => {
    const reads = [
      "get_labor_subcontractor_overview",
      "get_apu_overview",
      "get_scanner_session_overview",
      "get_auction_overview",
      "get_project_operational_overview",
      "get_inventory_overview",
      "get_billing_overview",
    ];
    const mutations = ["manage_labor_subcontractor", "manage_apu_material", "manage_auction_lab"];
    for (const name of reads) expect(getTool(name)?.riskLevel, name).toBe(0);
    for (const name of mutations) expect(getTool(name)?.riskLevel, name).toBe(2);
  });

  it("mantiene la frontera monetaria fuera de las nuevas capacidades", () => {
    const names = ["get_labor_subcontractor_overview", "get_apu_overview", "get_scanner_session_overview", "get_auction_overview", "get_project_operational_overview", "get_inventory_overview", "get_billing_overview", "manage_labor_subcontractor", "manage_apu_material"];
    expect(names.join(" ")).not.toMatch(/payment|cobro|pago|transferencia|concili|settlement|disbursement/i);
    expect(getTool("get_finance_overview")?.riskLevel).toBe(0);
  });

  it("permite resolver referencias humanas de los dominios V4 sin UUID visible", () => {
    for (const entity_type of ["subcontractor", "budget_item", "certificate", "sales_document", "work_order", "auction_room"] as const) {
      expect(ResolveErpEntityInputSchema.parse({ entity_type, query: "Algarrobos" }).entity_type).toBe(entity_type);
    }
  });
});
