import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261004041015_sales_provenance_guard.sql"), "utf8");
const id = (n: number) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
let db: PGlite;
async function create(n: number, type: string, source: number | null = null, tenant = 1) {
  await db.query(`INSERT INTO sales_documents(id,empresa_id,client_id,doc_type,source_document_id)
    VALUES($1,$2,$3,$4,$5)`, [id(n), id(tenant), id(2), type, source ? id(source) : null]);
}
async function status(n: number, value: string) { await db.query("UPDATE sales_documents SET status=$1 WHERE id=$2", [value, id(n)]); }
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE sales_documents(id uuid PRIMARY KEY, empresa_id uuid NOT NULL, client_id uuid NOT NULL,
      currency text DEFAULT 'PYG', doc_type text, status text DEFAULT 'BORRADOR', source_document_id uuid,
      acceptance_status text DEFAULT 'DRAFT', quotation_version int DEFAULT 1,
      subtotal numeric DEFAULT 90, vat_amount numeric DEFAULT 10, total numeric DEFAULT 100,
      CONSTRAINT sales_documents_source_document_id_fkey FOREIGN KEY(source_document_id) REFERENCES sales_documents(id) ON DELETE SET NULL);
    CREATE TABLE work_orders(id uuid PRIMARY KEY, empresa_id uuid, sales_document_id uuid, client_id uuid,
      currency text, subtotal numeric, vat_amount numeric, total numeric);
    CREATE TABLE work_order_items(id uuid PRIMARY KEY, empresa_id uuid, work_order_id uuid, description text,
      quantity numeric, unit_price numeric, vat_rate numeric, line_total numeric);
    CREATE TABLE sales_quotation_acceptances(empresa_id uuid, sales_document_id uuid, work_order_id uuid,
      quotation_version int, client_id uuid, currency_snapshot text, subtotal_snapshot numeric,
      vat_snapshot numeric, total_snapshot numeric, items_snapshot jsonb);
  `);
  await db.exec(migration);
  await create(10, "PROFORMA");
  await db.exec(`UPDATE sales_documents SET acceptance_status='ACCEPTED' WHERE id='${id(10)}';
    INSERT INTO work_orders VALUES('${id(20)}','${id(1)}','${id(10)}','${id(2)}','PYG',90,10,100);
    INSERT INTO work_order_items VALUES('${id(21)}','${id(1)}','${id(20)}','Service',1,100,10,100);
    INSERT INTO sales_quotation_acceptances VALUES('${id(1)}','${id(10)}','${id(20)}',1,'${id(2)}','PYG',90,10,100,
      '[{"description":"Service","quantity":1,"unit_price":100,"vat_rate":10,"line_total":100}]');`);
}, 20000);
afterEach(async () => { await db.close(); });

describe("authoritative provenance migration executed in PostgreSQL", () => {
  it("accepted OT branches, multiple remisiones/invoices and NC emit", async () => {
    await create(30,"REMISION",10); await create(31,"REMISION",10);
    await create(40,"FACTURA",10); await create(41,"FACTURA",30); await create(42,"FACTURA",30);
    for (const n of [30,31,40,41,42]) await status(n,"EMITIDA");
    await create(50,"NOTA_CREDITO",41); await status(50,"EMITIDA");
    const rows = await db.query("SELECT source_document_id FROM sales_documents WHERE id=$1", [id(41)]);
    expect(rows.rows[0]).toEqual({source_document_id:id(30)});
  });
  it("restricts delete even after annulment and keeps source unchanged", async () => {
    await create(30,"REMISION",10); await create(40,"FACTURA",30);
    await expect(db.query("DELETE FROM sales_documents WHERE id=$1",[id(30)])).rejects.toThrow(/foreign key/);
    await status(40,"ANULADA"); await status(30,"ANULADA");
    await expect(db.query("DELETE FROM sales_documents WHERE id=$1",[id(30)])).rejects.toThrow(/foreign key/);
    expect((await db.query("SELECT source_document_id FROM sales_documents WHERE id=$1",[id(40)])).rows[0]).toEqual({source_document_id:id(30)});
  });
  it.each([null, id(10)])("rejects source clear/repoint %s",async source => {
    await create(30,"REMISION",10); await create(40,"FACTURA",30);
    await expect(db.query("UPDATE sales_documents SET source_document_id=$1 WHERE id=$2",[source,id(40)])).rejects.toThrow(/inmutable/);
  });
  it("prevents parent annulment and identity changes until active descendants are cleaned up",async()=>{
    await create(30,"REMISION",10); await create(40,"FACTURA",30);
    await expect(status(30,"ANULADA")).rejects.toThrow(/derivados activos/);
    await expect(db.query("UPDATE sales_documents SET currency='USD' WHERE id=$1",[id(30)])).rejects.toThrow(/documentos derivados/);
    await status(40,"ANULADA"); await status(30,"ANULADA");
    await expect(status(40,"EMITIDA")).rejects.toThrow(/anulado/);
  });
  it("rejects missing and cross-tenant source, and moving a linked document to another tenant",async()=>{
    await expect(create(30,"REMISION",999)).rejects.toThrow(/origen de esta empresa/);
    await expect(create(30,"REMISION",10,99)).rejects.toThrow(/origen de esta empresa/);
    await create(30,"REMISION",10);
    await expect(db.query("UPDATE sales_documents SET empresa_id=$1 WHERE id=$2",[id(99),id(30)])).rejects.toThrow(/empresa.*inmutable/);
  });
  it.each(["quotation_version=2", "acceptance_status='DRAFT'", "total=101"])("blocks emission after quote mismatch %s",async change=>{
    await create(30,"REMISION",10); await db.exec(`UPDATE sales_documents SET ${change} WHERE id='${id(10)}'`);
    await expect(status(30,"EMITIDA")).rejects.toThrow(/snapshot/);
  });
  it.each(["quantity=2","description='Other'"])("blocks emission after OT item mismatch %s",async change=>{
    await create(30,"REMISION",10); await db.exec(`UPDATE work_order_items SET ${change}`);
    await expect(status(30,"EMITIDA")).rejects.toThrow(/snapshot/);
  });
  it("rejects unlinked remision ancestry but preserves standalone invoice to NC",async()=>{
    await create(30,"REMISION"); await create(40,"FACTURA",30);
    await expect(status(40,"EMITIDA")).rejects.toThrow(/proforma aceptada/);
    await create(41,"FACTURA"); await create(50,"NOTA_CREDITO",41);
    await expect(status(50,"EMITIDA")).rejects.toThrow(/factura emitida/);
    await status(41,"EMITIDA"); await status(50,"EMITIDA");
  });
  it("preserves invoker security and grants no new public function API",async()=>{
    const result = await db.query("SELECT prosecdef FROM pg_proc WHERE proname='guard_sales_provenance'");
    expect(result.rows[0]).toEqual({prosecdef:false});
    expect((await db.query("SELECT has_function_privilege('anon','guard_sales_provenance()','EXECUTE') AS allowed")).rows[0]).toEqual({allowed:false});
  });
});
