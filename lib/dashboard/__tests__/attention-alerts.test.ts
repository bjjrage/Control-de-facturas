import { describe, expect, it } from "vitest";
import { generateAttentionAlerts, type AlertSourcesInput } from "../attention-alerts";

const base: AlertSourcesInput = {
  todayIso: "2026-09-19",
  invoices: [],
  invoiceJobs: [],
  salesDocs: [],
  productos: [{ stock_actual: 5, stock_minimo: 10, activo: true }],
  orders: [],
  workOrders: [],
  cuentas: [],
};

describe("dashboard stock alerts", () => {
  it("labels low stock against the supplied canonical global quantity", () => {
    const alert = generateAttentionAlerts(base).find((item) => item.id === "alert-bajo-stock");
    expect(alert?.count).toBe(1);
    expect(alert?.label).toContain("stock global crítico");
  });

  it("surfaces canonical stock read failures instead of presenting an empty alert state", () => {
    const alerts = generateAttentionAlerts({ ...base, productos: [], stockSourceUnavailable: true });
    expect(alerts[0]).toMatchObject({
      id: "alert-stock-source-unavailable",
      tone: "error",
      href: "/inventario",
    });
  });
});
