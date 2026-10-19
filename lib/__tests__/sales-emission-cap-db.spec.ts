import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../supabase/migrations/20261018120700_guard_sales_emission_cap.sql", import.meta.url), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;
    CREATE TABLE public.sales_documents (
      id uuid PRIMARY KEY, empresa_id uuid NOT NULL, client_id uuid NOT NULL,
      doc_type text NOT NULL, status text NOT NULL DEFAULT 'BORRADOR',
      source_document_id uuid, quotation_version int NOT NULL DEFAULT 1, total numeric NOT NULL
    );
    CREATE TABLE public.sales_document_items (
      sales_document_id uuid NOT NULL, empresa_id uuid NOT NULL, description text NOT NULL,
      quantity numeric NOT NULL, unit_price numeric NOT NULL, vat_rate int NOT NULL
    );
    CREATE TABLE public.sales_quotation_acceptances (
      sales_document_id uuid NOT NULL, empresa_id uuid NOT NULL, quotation_version int NOT NULL,
      total_snapshot numeric NOT NULL, items_snapshot jsonb NOT NULL
    );
    INSERT INTO public.sales_documents VALUES
      ('${id(1)}','${id(9)}','${id(8)}','PROFORMA','EMITIDA',NULL,1,11000),
      ('${id(2)}','${id(9)}','${id(8)}','REMISION','BORRADOR','${id(1)}',1,11000),
      ('${id(3)}','${id(9)}','${id(8)}','REMISION','BORRADOR','${id(1)}',1,11000);
    INSERT INTO public.sales_document_items VALUES
      ('${id(2)}','${id(9)}','Servicio',1,10000,10),
      ('${id(3)}','${id(9)}','Servicio',1,10000,10);
    INSERT INTO public.sales_quotation_acceptances VALUES
      ('${id(1)}','${id(9)}',1,11000,
       '[{"description":"Servicio","quantity":1,"unit_price":10000,"vat_rate":10}]');
  `);
  if (!process.env.SALES_CAP_BASELINE) await db.exec(migration);
}, 120000);
afterAll(async () => { await db?.close(); });

describe("#19 cap at emission in PostgreSQL", () => {
  it("allows one complete emission and rejects the second without altering it", async () => {
    await db.query("UPDATE public.sales_documents SET status='EMITIDA' WHERE id=$1", [id(2)]);
    await expect(db.query("UPDATE public.sales_documents SET status='EMITIDA' WHERE id=$1", [id(3)]))
      .rejects.toThrow(/supera o altera/);
    const rows = await db.query<{ status: string }>(
      "SELECT status FROM public.sales_documents WHERE id=$1", [id(3)]);
    expect(rows.rows[0].status).toBe("BORRADOR");
  });
  it("does not expose the trigger function as a callable API", async () => {
    const rows = await db.query<{ anon: boolean; authenticated: boolean }>(`
      SELECT has_function_privilege('anon', 'private.guard_sales_emission_cap()', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'private.guard_sales_emission_cap()', 'EXECUTE') AS authenticated`);
    expect(rows.rows[0]).toEqual({ anon: false, authenticated: false });
  });
});
