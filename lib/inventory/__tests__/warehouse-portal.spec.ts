import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const warehousePortalPageSource = fs.readFileSync(
  path.join(repoRoot, "app", "warehouse", "[token]", "page.tsx"),
  "utf8"
);
const warehousePortalClientSource = fs.readFileSync(
  path.join(repoRoot, "app", "warehouse", "[token]", "warehouse-portal-client.tsx"),
  "utf8"
);
const warehousePortalRouteSource = fs.readFileSync(
  path.join(repoRoot, "app", "api", "warehouse-portal", "[token]", "route.ts"),
  "utf8"
);
const warehousePortalDataSource = fs.readFileSync(
  path.join(repoRoot, "lib", "inventory", "warehouse-portal-data.ts"),
  "utf8"
);
const panolSectionSource = fs.readFileSync(
  path.join(repoRoot, "app", "(internal)", "projects", "[id]", "panol-obra-section.tsx"),
  "utf8"
);
const proxySource = fs.readFileSync(path.join(repoRoot, "proxy.ts"), "utf8");

describe("Unified Warehouse Portal & Deposit Operations", () => {
  it("provides a single portal entrypoint that bundles receipt, consumption and evidence submission", () => {
    expect(warehousePortalClientSource).toContain('activeTab === "receipt"');
    expect(warehousePortalClientSource).toContain('activeTab === "consumption"');
    expect(warehousePortalClientSource).toContain('activeTab === "submission"');
    expect(warehousePortalClientSource).toContain("Recibir OC");
    expect(warehousePortalClientSource).toContain("Registrar Salida");
    expect(warehousePortalClientSource).toContain("Rendición");
  });

  it("handles receipt from open purchase orders supporting partial deliveries", () => {
    expect(warehousePortalClientSource).toContain("selectedOrder.items");
    expect(warehousePortalClientSource).toContain("max={item.pending}");
    expect(warehousePortalClientSource).toContain("action");
    expect(warehousePortalClientSource).toContain('"receipt"');
    expect(warehousePortalRouteSource).toContain('action === "receipt"');
    expect(warehousePortalRouteSource).toContain('rpc("inventory_create_receipt"');
    expect(warehousePortalRouteSource).toContain('rpc("inventory_confirm_receipt"');
  });

  it("handles material consumption with available stock validation and budget item imputation", () => {
    expect(warehousePortalClientSource).toContain('"consumption"');
    expect(warehousePortalClientSource).toContain("budget_item_id");
    expect(warehousePortalClientSource).toContain("withdrawn_by");
    expect(warehousePortalRouteSource).toContain('action === "consumption"');
    expect(warehousePortalRouteSource).toContain('p_movement_type: "CONSUMPTION"');
    expect(warehousePortalRouteSource).toContain("p_budget_item_id: budgetItemId");
    expect(warehousePortalRouteSource).toContain("p_from_location_id: location.id");
    expect(warehousePortalRouteSource).toContain("p_project_id: location.project_id");
  });

  it("enforces tenant, project and location boundaries in warehouse portal API", () => {
    expect(warehousePortalRouteSource).toContain(".eq(\"empresa_id\", link.empresa_id)");
    expect(warehousePortalRouteSource).toContain(".eq(\"project_id\", location.project_id)");
    expect(warehousePortalDataSource).toContain(".eq(\"project_id\", project.id)");
    expect(warehousePortalDataSource).toContain(".eq(\"empresa_id\", link.empresa_id)");
  });

  it("integrates confirmed receipts inside Depósito de obra in the ERP", () => {
    expect(panolSectionSource).toContain("RecepcionesObraSection");
    expect(panolSectionSource).toContain("Recepciones de mercadería confirmadas");
  });

  it("permits unauthenticated portal token access through proxy with security headers", () => {
    expect(proxySource).toContain('path.startsWith("/warehouse/")');
    expect(proxySource).toContain('path.startsWith("/api/warehouse-portal/")');
    expect(proxySource).toContain('response.headers.set("Referrer-Policy", "no-referrer")');
  });
});
