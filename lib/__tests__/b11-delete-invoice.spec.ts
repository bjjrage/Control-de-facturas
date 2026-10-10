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
  rpcError: null as string | null,
  events: [] as string[],
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  storageRemove: vi.fn(),
  attachment: null as { bucket: string; path: string } | null,
}));

vi.mock("@/lib/auth", () => ({ requireEmpresaId: mocks.requireEmpresaId, requireProfile: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      mocks.events.push(`${name}.rpc`);
      mocks.rpcCalls.push({ name, args });
      if (mocks.rpcError) return { data: null, error: { message: mocks.rpcError } };
      if (mocks.selectedInvoice?.status === "APTO_PARA_PAGO" || mocks.selectedInvoice?.status === "PAGADO") {
        return { data: null, error: { message: "No se puede eliminar la factura aprobada o pagada." } };
      }
      return { data: { ok: true, attachment_id: mocks.selectedInvoice?.attachment_id ?? null }, error: null };
    },
  }),
}));
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
          if (table === "attachments") return { data: mocks.attachment, error: null };
          return { data: null, error: null };
        },
        then: (resolveResult: (result: { data: unknown; error: { message: string } | null }) => unknown,
          rejectResult?: (error: unknown) => unknown) => {
          if (operation === "delete") {
            mocks.events.push(`${table}.delete`);
          }
          return Promise.resolve({ data: [], error: null }).then(resolveResult, rejectResult);
        },
      };
      return query;
    },
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => {
      mocks.events.push("storage.remove");
      return await mocks.storageRemove(bucket, paths) ?? { data: [], error: null };
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
  mocks.rpcCalls = [];
  mocks.rpcError = null;
  mocks.attachment = null;
  mocks.selectedInvoice = { attachment_id: null, status: "MATCH", invoice_number: "001-001-0001" };
  mocks.requireEmpresaId.mockResolvedValue("authorized-local-company");
});

describe("B11 hard invoice delete — atomic database delete and post-commit storage cleanup", () => {
  it.each(["APTO_PARA_PAGO", "PAGADO"] as const)("%s is rejected by the atomic RPC before storage cleanup", async (status) => {
    protectedInvoice(status);
    const result = await deleteInvoice("invoice-1");
    expect(result.error).toMatch(/No se puede eliminar la factura/);
    expect(mocks.rpcCalls).toEqual([{ name: "delete_invoice", args: { p_empresa_id: "authorized-local-company", p_invoice_id: "invoice-1" } }]);
    expect(mocks.storageRemove).not.toHaveBeenCalled();
  });

  it("a rejected atomic transaction performs no post-commit storage cleanup", async () => {
    mocks.rpcError = "No se puede eliminar una factura vinculada a una OP ejecutada.";
    const result = await deleteInvoice("invoice-1");
    expect(result).toEqual({ error: mocks.rpcError });
    expect(mocks.rpcCalls).toHaveLength(1);
    expect(mocks.rpcCalls[0].name).toBe("delete_invoice");
    expect(mocks.events).not.toContain("storage.remove");
  });

  it("normal MATCH hard delete makes one atomic RPC, then removes its attachment", async () => {
    mocks.selectedInvoice!.attachment_id = "attachment";
    mocks.attachment = { bucket: "invoice-files", path: "company/invoice.pdf" };
    expect(await deleteInvoice("invoice-1")).toEqual({ error: null });
    expect(mocks.rpcCalls).toEqual([{ name: "delete_invoice", args: { p_empresa_id: "authorized-local-company", p_invoice_id: "invoice-1" } }]);
    expect(mocks.storageRemove).toHaveBeenCalledWith("invoice-files", ["company/invoice.pdf"]);
    expect(mocks.events.indexOf("delete_invoice.rpc")).toBeLessThan(mocks.events.indexOf("attachments.select"));
    expect(mocks.events.indexOf("attachments.select")).toBeLessThan(mocks.events.indexOf("storage.remove"));
    expect(mocks.events.indexOf("storage.remove")).toBeLessThan(mocks.events.indexOf("attachments.delete"));
  });

  it("reports attachment cleanup failure as warning after invoice deletion commits", async () => {
    mocks.selectedInvoice!.attachment_id = "attachment";
    mocks.attachment = { bucket: "invoice-files", path: "company/invoice.pdf" };
    mocks.storageRemove.mockImplementation(async () => ({ error: { message: "storage unavailable" } }));
    const result = await deleteInvoice("invoice-1");
    expect(result.error).toBeNull();
    expect(result.warning).toMatch(/factura se eliminó/);
    expect(mocks.rpcCalls).toHaveLength(1);
    expect(mocks.events).not.toContain("attachments.delete");
  });

  it("does not throw if storage fails after the database deletion commits", async () => {
    mocks.selectedInvoice!.attachment_id = "attachment";
    mocks.attachment = { bucket: "invoice-files", path: "company/invoice.pdf" };
    mocks.storageRemove.mockRejectedValue(new Error("network unavailable"));
    const result = await deleteInvoice("invoice-1");
    expect(result.error).toBeNull();
    expect(result.warning).toMatch(/factura se eliminó/);
    expect(mocks.events).not.toContain("attachments.delete");
  });

  it("non-admin is denied before the privileged client is created", async () => {
    mocks.requireEmpresaId.mockRejectedValue(new Error("admin only"));
    await expect(deleteInvoice("invoice-1")).rejects.toThrow("admin only");
    expect(mocks.events).toEqual([]);
    expect(mocks.rpcCalls).toEqual([]);
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
