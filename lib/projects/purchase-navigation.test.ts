import { describe, expect, it } from "vitest";
import { belongsToPurchaseContext, projectTabForPath, purchaseDetailPath } from "./purchase-navigation";

describe("project purchasing context", () => {
  it("keeps Administration links global and worksite links inside the worksite", () => {
    expect(purchaseDetailPath("orders", "oc")).toBe("/orders/oc");
    expect(purchaseDetailPath("orders", "oc", "obra")).toBe("/projects/obra/orders/oc");
    expect(purchaseDetailPath("rfqs", "rfq", "obra")).toBe("/projects/obra/rfqs/rfq");
  });
  it("rejects another tenant, another worksite and an unassigned order", () => {
    expect(belongsToPurchaseContext({ empresa_id: "tenant", project_id: "obra" }, "tenant", "obra")).toBe(true);
    expect(belongsToPurchaseContext({ empresa_id: "foreign", project_id: "obra" }, "tenant", "obra")).toBe(false);
    expect(belongsToPurchaseContext({ empresa_id: "tenant", project_id: "another" }, "tenant", "obra")).toBe(false);
    expect(belongsToPurchaseContext({ empresa_id: "tenant", project_id: null }, "tenant", "obra")).toBe(false);
  });
  it("allows tenant-owned central purchases only in the global context", () => {
    expect(belongsToPurchaseContext({ empresa_id: "tenant", project_id: null }, "tenant")).toBe(true);
  });
  it("keeps nested detail breadcrumbs correct and ignores an unrelated tab query", () => {
    expect(projectTabForPath("/projects/obra/orders/oc", "?tab=costeo")).toBe("compras");
    expect(projectTabForPath("/projects/obra/rfqs/rfq", "")).toBe("cotizaciones");
    expect(projectTabForPath("/projects/obra", "?tab=recepciones")).toBe("recepciones");
  });
});
