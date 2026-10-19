import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tenant = "11111111-1111-4111-8111-111111111111";
const quote = "22222222-2222-4222-8222-222222222222";
const order = "33333333-3333-4333-8333-333333333333";
const migration = readFileSync(new URL("../../supabase/migrations/20261018120000_guard_proforma_void_with_work_order.sql", import.meta.url), "utf8");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA private;
    CREATE TABLE public.sales_documents (
      id uuid PRIMARY KEY, empresa_id uuid NOT NULL, doc_type text NOT NULL, status text NOT NULL
    );
    CREATE TABLE public.work_orders (
      id uuid PRIMARY KEY, empresa_id uuid NOT NULL, sales_document_id uuid NOT NULL, status text NOT NULL
    );
  `);
  await db.exec(migration);
}, 120000);
afterAll(async () => { await db?.close(); });

describe("#18 proforma void with a work order", () => {
  it("rejects void atomically while the linked OT is active, then allows it after cancellation", async () => {
    await db.exec(`
      INSERT INTO public.sales_documents VALUES ('${quote}', '${tenant}', 'PROFORMA', 'EMITIDA');
      INSERT INTO public.work_orders VALUES ('${order}', '${tenant}', '${quote}', 'EN_CURSO');
    `);
    await expect(db.exec(`UPDATE public.sales_documents SET status='ANULADA' WHERE id='${quote}'`))
      .rejects.toThrow(/OT activa/);
    expect((await db.query<{ status: string }>(`SELECT status FROM public.sales_documents WHERE id='${quote}'`)).rows[0].status)
      .toBe("EMITIDA");
    await db.exec(`UPDATE public.work_orders SET status='CANCELADA' WHERE id='${order}'`);
    await db.exec(`UPDATE public.sales_documents SET status='ANULADA' WHERE id='${quote}'`);
    expect((await db.query<{ status: string }>(`SELECT status FROM public.sales_documents WHERE id='${quote}'`)).rows[0].status)
      .toBe("ANULADA");
  });
});
