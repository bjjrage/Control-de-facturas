import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const tenant = "11111111-1111-4111-8111-111111111111";
const otherTenant = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const client = "44444444-4444-4444-8444-444444444444";
const otherClient = "55555555-5555-4555-8555-555555555555";
const migration = readFileSync(new URL("../../supabase/migrations/20261017201618_sales_document_atomic_write.sql", import.meta.url), "utf8");
let db: PGlite;
const item = { description: "Servicio", quantity: 2, unit_price: 50, vat_rate: 10 };

async function save(documentId: string | null, items: unknown[] = [item], clientId = client, notes = "Primera") {
  const result = await db.query<{ id: string }>(
    "SELECT public.save_sales_document_atomico($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) AS id",
    [tenant, documentId, clientId, "FACTURA", "2026-10-17", null, "PYG", notes, null, actor, JSON.stringify(items)]
  );
  return result.rows[0].id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE TYPE public.user_role AS ENUM ('administracion','admin','comercial');
    CREATE TYPE public.sales_doc_type AS ENUM ('PROFORMA','REMISION','FACTURA','NOTA_CREDITO');
    CREATE TYPE public.currency_code AS ENUM ('PYG','USD');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    CREATE FUNCTION public.current_empresa_id() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.tenant',true),'')::uuid $$;
    CREATE FUNCTION public.is_internal_role(public.user_role[]) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT current_setting('test.role',true)='administracion' $$;
    CREATE TABLE public.clients(id uuid PRIMARY KEY,empresa_id uuid);
    CREATE TABLE public.sales_documents(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,client_id uuid,
      doc_type public.sales_doc_type,issue_date date,due_date date,currency public.currency_code,
      notes text,source_document_id uuid,created_by uuid,status text DEFAULT 'BORRADOR',
      acceptance_status text DEFAULT 'DRAFT'
    );
    CREATE TABLE public.sales_document_items(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,sales_document_id uuid,
      description text,quantity numeric(14,4) CHECK (quantity>0),unit_price numeric(14,4),
      vat_rate integer,line_total numeric(14,2)
    );
    ALTER TABLE public.sales_documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.sales_document_items ENABLE ROW LEVEL SECURITY;
    CREATE POLICY doc_tenant ON public.sales_documents FOR ALL TO authenticated
      USING (empresa_id=public.current_empresa_id()) WITH CHECK (empresa_id=public.current_empresa_id());
    CREATE POLICY item_tenant ON public.sales_document_items FOR ALL TO authenticated
      USING (empresa_id=public.current_empresa_id()) WITH CHECK (empresa_id=public.current_empresa_id());
    GRANT SELECT ON public.clients TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_documents,public.sales_document_items TO authenticated;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid(),public.current_empresa_id(),public.is_internal_role(public.user_role[]) TO authenticated;
  `);
  await db.exec(migration);
}, 120000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`
    RESET ROLE; TRUNCATE public.sales_document_items,public.sales_documents,public.clients;
    INSERT INTO public.clients VALUES ('${client}','${tenant}'),('${otherClient}','${otherTenant}');
    SELECT set_config('test.actor','${actor}',false),set_config('test.tenant','${tenant}',false),
      set_config('test.role','administracion',false);
    SET ROLE authenticated;
  `);
});

describe("atomic sales header and items", () => {
  it("creates a document with all items in one call", async () => {
    const id = await save(null, [item, { ...item, description: "Material", quantity: 1 }]);
    const rows = await db.query<{ description: string }>(
      "SELECT description FROM public.sales_document_items WHERE sales_document_id=$1 ORDER BY description", [id]
    );
    expect(rows.rows.map((row) => row.description)).toEqual(["Material", "Servicio"]);
  });

  it("rolls back the header when a later item is invalid", async () => {
    await expect(save(null, [item, { ...item, quantity: 0 }])).rejects.toThrow(/Línea de venta inválida/);
    const docs = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM public.sales_documents");
    expect(docs.rows[0].count).toBe("0");
  });

  it("preserves old header and lines if a replacement fails", async () => {
    const id = await save(null);
    await expect(save(id, [item, { ...item, quantity: -1 }], client, "Cambiada")).rejects.toThrow(/Línea de venta inválida/);
    const doc = await db.query<{ notes: string }>("SELECT notes FROM public.sales_documents WHERE id=$1", [id]);
    const lines = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM public.sales_document_items WHERE sales_document_id=$1", [id]);
    expect(doc.rows[0].notes).toBe("Primera");
    expect(lines.rows[0].count).toBe("1");
  });

  it("rejects a client from another company before writing", async () => {
    await expect(save(null, [item], otherClient)).rejects.toThrow(/Cliente no disponible/);
  });
});
