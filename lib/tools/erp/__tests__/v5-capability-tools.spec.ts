import { describe, expect, it } from "vitest";
import { getTool, toolRegistry } from "@/lib/agent/registry";
import "@/lib/tools/index";

describe("Rodrigo ERP V5 capability boundary", () => {
  it("expone lecturas y separa las operaciones aprobables", () => {
    const reads = ["get_supplier_invoice_overview", "get_work_order_overview", "get_sifen_overview"];
    const mutations = ["manage_supplier_invoice", "manage_work_order", "manage_sifen_document"];
    for (const name of reads) expect(getTool(name)?.riskLevel, name).toBe(0);
    for (const name of mutations) expect(getTool(name)?.riskLevel, name).toBe(2);
  });

  it("no allowlistea Auction Lab/Bot operativo ni tesoreria mutante", () => {
    expect(getTool("manage_auction_lab")).toBeUndefined();
    expect(getTool("auction_bot")).toBeUndefined();
    expect(getTool("pay_supplier")).toBeUndefined();
    expect(getTool("transfer_funds")).toBeUndefined();
    expect(toolRegistry.listNames()).not.toContain("send_dncp_offer");
  });

  it("marca toda persistencia previa a aprobacion como risk 2", () => {
    for (const name of ["create_rfq_draft", "prepare_purchase_order", "prepare_email", "update_spreadsheet_rows"]) {
      expect(getTool(name)?.riskLevel, name).toBe(2);
    }
    expect(getTool("send_email")?.riskLevel).toBe(2);
    expect(getTool("get_finance_overview")?.riskLevel).toBe(0);
  });
});
