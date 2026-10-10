import { describe, expect, it } from "vitest";
import {
  finishInvoiceJobLease,
  invoiceJobCreationDisposition,
  invoiceJobMatchingOutcome,
} from "@/lib/invoice-job-worker";

function leaseDb(initial: Record<string, unknown>) {
  const row = { ...initial };
  return {
    row,
    client: {
      from(table: string) {
        if (table !== "invoice_jobs") throw new Error(`unexpected table ${table}`);
        let payload: Record<string, unknown> = {};
        const filters: Array<(value: Record<string, unknown>) => boolean> = [];
        const query = {
          update(value: Record<string, unknown>) { payload = value; return query; },
          eq(column: string, value: unknown) { filters.push((current) => current[column] === value); return query; },
          is(column: string, value: unknown) { filters.push((current) => current[column] === value); return query; },
          select() { return query; },
          async maybeSingle() {
            if (!filters.every((filter) => filter(row))) return { data: null, error: null };
            Object.assign(row, payload);
            return { data: { id: row.id }, error: null };
          },
        };
        return query;
      },
    } as never,
  };
}

describe("invoice job worker fencing", () => {
  it("a worker with an expired attempt cannot overwrite the newer lease", async () => {
    const db = leaseDb({ id: "job-1", status: "processing", attempts: 4, invoice_id: null, message: "winner" });
    const result = await finishInvoiceJobLease(db.client, { id: "job-1", attempts: 3, invoice_id: null }, { status: "failed", message: "stale" });
    expect(result).toEqual({ updated: false, error: null });
    expect(db.row).toMatchObject({ status: "processing", attempts: 4, message: "winner" });
  });

  it("a lease cannot finish after another writer checkpoints an invoice", async () => {
    const db = leaseDb({ id: "job-1", status: "processing", attempts: 4, invoice_id: "invoice-winner", message: "winner" });
    const result = await finishInvoiceJobLease(db.client, { id: "job-1", attempts: 4, invoice_id: null }, { status: "failed", message: "stale" });
    expect(result.updated).toBe(false);
    expect(db.row).toMatchObject({ invoice_id: "invoice-winner", status: "processing", message: "winner" });
  });

  it("the owning lease can finish only its exact invoice reference", async () => {
    const db = leaseDb({ id: "job-1", status: "processing", attempts: 4, invoice_id: "invoice-1", message: "running" });
    const result = await finishInvoiceJobLease(db.client, { id: "job-1", attempts: 4, invoice_id: "invoice-1" }, { status: "done", message: "complete" });
    expect(result).toEqual({ updated: true, error: null });
    expect(db.row).toMatchObject({ status: "done", invoice_id: "invoice-1", locked_at: null });
  });

  it("a duplicate RPC result is classified as existing so callers stop before adding lines", () => {
    expect(invoiceJobCreationDisposition({ ok: true, duplicate: true, invoice_id: "invoice-existing" }, null))
      .toEqual({ kind: "existing", invoiceId: "invoice-existing" });
  });

  it("incomplete or skipped proposals remain in manual review with a truthful message", () => {
    expect(invoiceJobMatchingOutcome({
      lineSaveError: null, matchError: null, pendingLines: 1, skippedProposals: 2, matchedOrderId: "order-1", lineCount: 3,
    })).toEqual({
      status: "needs_review", outcome: "needs_manual",
      message: "1 de 3 línea(s) quedaron sin imputación completa. Revisalas antes de aprobar el pago.",
    });
    expect(invoiceJobMatchingOutcome({
      lineSaveError: null, matchError: null, pendingLines: 0, skippedProposals: 1, matchedOrderId: "order-1", lineCount: 1,
    }).status).toBe("needs_review");
  });
});
