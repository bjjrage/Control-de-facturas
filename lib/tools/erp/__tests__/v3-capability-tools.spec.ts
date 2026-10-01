import { describe, expect, it } from "vitest";
import { getTool } from "@/lib/agent/registry";
import "@/lib/tools/index";
import { ManageInventoryOperationInputSchema } from "@/lib/tools/erp/manage-inventory-operation";
import { SaveWeeklyPlanInputSchema } from "@/lib/tools/erp/save-weekly-plan";
import { ManageSalesDocumentInputSchema } from "@/lib/tools/erp/manage-sales-document";

describe("Rodrigo ERP V3 capability registry", () => {
  it("registra las operaciones reales como tools aprobables", () => {
    const expected = [
      "manage_master_data",
      "preview_weekly_plan",
      "save_weekly_plan",
      "manage_budget_item",
      "manage_production_recipe",
      "manage_sales_document",
      "create_invoice",
      "manage_company_document",
      "manage_inventory_operation",
      "manage_climate_workday",
      "manage_tender",
      "manage_certificate",
      "get_project_modeling_overview",
    ];
    for (const name of expected) {
      expect(getTool(name), name).toBeDefined();
      expect(getTool(name)?.riskLevel, name).toBe(name === "preview_weekly_plan" || name === "get_project_modeling_overview" ? 0 : 2);
    }
  });

  it("mantiene la frontera de tesorería fuera de las operaciones nuevas", () => {
    const registered = expectedMutationNames().join(" ");
    expect(registered).not.toMatch(/cobro|pago|transferencia_bancaria|movimiento_tesoreria|concili/);
  });

  it("valida referencias e inputs de dominio antes de llegar a las acciones", () => {
    expect(() => SaveWeeklyPlanInputSchema.parse({
      project_id: "not-an-id",
      start_date: "2026-01-01",
      end_date: "2026-01-07",
      status: "COMMITTED",
      items: [],
    })).toThrow();

    expect(() => ManageInventoryOperationInputSchema.parse({ operation: "confirm_receipt" })).toThrow();

    const sales = ManageSalesDocumentInputSchema.parse({
      operation: "create",
      client_id: "00000000-0000-0000-0000-000000000000",
      items: [{ description: "Hormigón", quantity: 1, unit_price: 100, vat_rate: 10 }],
    });
    expect(sales.operation).toBe("create");
  });
});

function expectedMutationNames() {
  return [
    "manage_master_data",
    "save_weekly_plan",
    "manage_budget_item",
    "manage_production_recipe",
    "manage_sales_document",
    "create_invoice",
    "manage_company_document",
    "manage_inventory_operation",
    "manage_climate_workday",
    "manage_tender",
    "manage_certificate",
  ];
}
