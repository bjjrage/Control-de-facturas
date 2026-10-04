import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const mocks = vi.hoisted(() => ({
  requireEmpresaId: vi.fn(),
  selectedInvoice: { attachment_id: null as string | null, status: "MATCH", invoice_number: "001-001-0001" } as {
    attachment_id: string | null; status: string; invoice_number: string;
  } | null,
  deleteErrors: {} as Record<string, string | undefined>,
  events: [] as string[],
  deleteCalls: [] as string[],
  storageRemove: vi.fn(),
  attachment: null as { bucket: string; path: string } | null,
}));

vi.mock("@/lib/auth", () => ({ requireEmpresaId: mocks.requireEmpresaId, requireProfile: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let operation = "select";
      const query = {
        select: () => { operation = "select"; return query; },
        delete: () => { operation = "delete"; return query; },
        eq: () => query,
        maybeSingle: async () => {
          mocks.events.push(`${table}.select`);
          if (table === "invoices") return { data: mocks.selectedInvoice, error: null };
          if (table === "attachments") return { data: mocks.attachment, error: null };
          return { data: null, error: null };
        },
        then: (resolveResult: (result: { data: unknown; error: { message: string } | null }) => unknown,
          rejectResult?: (error: unknown) => unknown) => {
          if (operation === "delete") {
            mocks.events.push(`${table}.delete`);
            mocks.deleteCalls.push(table);
          }
          const message = operation === "delete" ? mocks.deleteErrors[table] : undefined;
          return Promise.resolve({ data: [], error: message ? { message } : null }).then(resolveResult, rejectResult);
        },
      };
      return query;
    },
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => {
      mocks.events.push("storage.remove");
      mocks.storageRemove(bucket, paths);
      return { data: [], error: null };
    } }) },
  }),
}));
import { deleteInvoice } from "@/app/(internal)/invoices/[id]/actions";
import { DeleteInvoiceButton, canHardDeleteInvoice } from "@/app/(internal)/invoices/[id]/delete-button";

const protectedInvoice = (status: "APTO_PARA_PAGO" | "PAGADO") => {
  mocks.selectedInvoice = { attachment_id: "attachment", status, invoice_number: "001-001-0001" };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events = [];
  mocks.deleteCalls = [];
  mocks.deleteErrors = {};
  mocks.attachment = null;
  mocks.selectedInvoice = { attachment_id: null, status: "MATCH", invoice_number: "001-001-0001" };
  mocks.requireEmpresaId.mockResolvedValue("authorized-local-company");
});

describe("B11 hard invoice delete — protected status and fail-fast cleanup", () => {
  it.each(["APTO_PARA_PAGO", "PAGADO"] as const)("%s rejects before every child/storage mutation", async (status) => {
    protectedInvoice(status);
    const result = await deleteInvoice("invoice-1");
    expect(result.error).toMatch(/No se puede eliminar la factura/);
    expect(mocks.deleteCalls).toEqual([]);
    expect(mocks.storageRemove).not.toHaveBeenCalled();
  });

  it("race: guarded relationship DELETE stops exceptions, audit, OP and parent cleanup", async () => {
    mocks.deleteErrors.invoice_order_matches = "No se puede modificar el vínculo OC de una factura apta para pago o pagada.";
    const result = await deleteInvoice("invoice-1");
    expect(result).toEqual({ error: mocks.deleteErrors.invoice_order_matches });
    expect(mocks.deleteCalls).toEqual(["invoice_order_matches"]);
    expect(mocks.events).not.toContain("invoice_exceptions.delete");
    expect(mocks.events).not.toContain("audit_logs.delete");
    expect(mocks.events).not.toContain("payment_order_invoices.delete");
    expect(mocks.events).not.toContain("invoices.delete");
    expect(mocks.events).not.toContain("storage.remove");
  });

  it.each([
    ["invoice_exceptions", ["invoice_order_matches", "invoice_exceptions"]],
    ["audit_logs", ["invoice_order_matches", "invoice_exceptions", "audit_logs"]],
    ["payment_order_invoices", ["invoice_order_matches", "invoice_exceptions", "audit_logs", "payment_order_invoices"]],
    ["invoices", ["invoice_order_matches", "invoice_exceptions", "audit_logs", "payment_order_invoices", "invoices"]],
  ] as const)("%s delete error stops every later destructive step", async (failedTable, expectedCalls) => {
    mocks.deleteErrors[failedTable] = `${failedTable} delete denied`;
    const result = await deleteInvoice("invoice-1");
    expect(result).toEqual({ error: `${failedTable} delete denied` });
    expect(mocks.deleteCalls).toEqual(expectedCalls);
    expect(mocks.storageRemove).not.toHaveBeenCalled();
  });

  it("normal MATCH hard delete succeeds and still removes its attachment", async () => {
    mocks.selectedInvoice!.attachment_id = "attachment";
    mocks.attachment = { bucket: "invoice-files", path: "company/invoice.pdf" };
    expect(await deleteInvoice("invoice-1")).toEqual({ error: null });
    expect(mocks.deleteCalls).toEqual([
      "invoice_order_matches", "invoice_exceptions", "audit_logs", "payment_order_invoices", "invoices", "attachments",
    ]);
    expect(mocks.storageRemove).toHaveBeenCalledWith("invoice-files", ["company/invoice.pdf"]);
    expect(mocks.events.indexOf("invoice_order_matches.delete")).toBeLessThan(mocks.events.indexOf("invoice_exceptions.delete"));
    expect(mocks.events.indexOf("invoice_exceptions.delete")).toBeLessThan(mocks.events.indexOf("audit_logs.delete"));
    expect(mocks.events.indexOf("audit_logs.delete")).toBeLessThan(mocks.events.indexOf("payment_order_invoices.delete"));
    expect(mocks.events.indexOf("payment_order_invoices.delete")).toBeLessThan(mocks.events.indexOf("invoices.delete"));
    expect(mocks.events.indexOf("invoices.delete")).toBeLessThan(mocks.events.indexOf("storage.remove"));
  });

  it("non-admin is denied before the privileged client is created", async () => {
    mocks.requireEmpresaId.mockRejectedValue(new Error("admin only"));
    await expect(deleteInvoice("invoice-1")).rejects.toThrow("admin only");
    expect(mocks.events).toEqual([]);
    expect(mocks.deleteCalls).toEqual([]);
  });
});

describe("B11 hard delete button visibility", () => {
  it.each(["APTO_PARA_PAGO", "PAGADO"] as const)("hides delete control for %s", (status) => {
    expect(canHardDeleteInvoice(status)).toBe(false);
    expect(renderToStaticMarkup(createElement(DeleteInvoiceButton, { invoiceId: "invoice-1", status }))).toBe("");
  });

  it.each(["PENDIENTE", "MATCH", "APROBADO_EXCEPCION", "REQUIERE_REVISION"] as const)("preserves allowed %s hard delete", (status) => {
    expect(canHardDeleteInvoice(status)).toBe(true);
    expect(renderToStaticMarkup(createElement(DeleteInvoiceButton, { invoiceId: "invoice-1", status }))).toContain("Eliminar factura");
  });

  it("passes invoice status from every existing hard-delete surface", () => {
    const detailPage = readFileSync(resolve("app/(internal)/invoices/[id]/page.tsx"), "utf8");
    const listPage = readFileSync(resolve("app/(internal)/invoices/page.tsx"), "utf8");
    const section = readFileSync(resolve("app/(internal)/invoices/invoices-section.tsx"), "utf8");
    expect(detailPage).toContain("DeleteInvoiceButton invoiceId={invoice.id} status={invoice.status}");
    expect(listPage).toContain("DeleteInvoiceButton invoiceId={i.id} status={i.status} compact");
    expect(section).toContain("status={i.status}");
  });
});
