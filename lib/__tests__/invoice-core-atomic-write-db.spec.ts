import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const tenant = "11111111-1111-4111-8111-111111111111";
const otherTenant = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const provider = "44444444-4444-4444-8444-444444444444";
const otherProvider = "55555555-5555-4555-8555-555555555555";
const migration = readFileSync(new URL("../../supabase/migrations/20261017204700_invoice_core_atomic_write.sql", import.meta.url), "utf8");
let db: PGlite;

const header = {
  provider_id: provider, invoice_number: "QA-001", invoice_date: "2026-10-17",
  due_date: null, currency: "PYG", exchange_rate: null,
  subtotal: 100, vat: 10, total: 110, timbrado: null,
  attachment_id: null, observations: "QA",
};
const line = { description: "Material", quantity: "2", unit: "un", unit_price: 50, subtotal: 100 };

async function save(items: unknown[], nextHeader = header) {
  const result = await db.query<{ id: string }>(
    "SELECT public.create_invoice_with_lines_atomico($1,$2,$3::jsonb,$4::jsonb) AS id",
    [tenant, actor, JSON.stringify(nextHeader), JSON.stringify(items)]
  );
  return result.rows[0].id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE TYPE public.user_role AS ENUM ('administracion','admin','comercial');
    CREATE TYPE public.currency_code AS ENUM ('PYG','USD');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    CREATE FUNCTION public.current_empresa_id() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.tenant',true),'')::uuid $$;
    CREATE FUNCTION public.is_internal_role(public.user_role[]) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT current_setting('test.role',true)='administracion' $$;
    CREATE TABLE public.providers(id uuid PRIMARY KEY,empresa_id uuid);
    CREATE TABLE public.attachments(id uuid PRIMARY KEY,empresa_id uuid);
    CREATE TABLE public.invoices(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, provider_id uuid,
      invoice_number text, invoice_date date, due_date date, currency public.currency_code,
      exchange_rate numeric, subtotal numeric, vat numeric, total numeric CHECK(total>0),
      timbrado text, attachment_id uuid, observations text, created_by uuid
    );
    CREATE TABLE public.invoice_items(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,invoice_id uuid REFERENCES public.invoices(id),
      product_description text,quantity numeric(14,2),unit text,unit_price numeric(14,4),
      subtotal numeric(14,2),sort_order integer
    );
    ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
    CREATE POLICY invoice_tenant ON public.invoices FOR ALL TO authenticated
      USING (empresa_id=public.current_empresa_id()) WITH CHECK (empresa_id=public.current_empresa_id());
    CREATE POLICY line_tenant ON public.invoice_items FOR ALL TO authenticated
      USING (empresa_id=public.current_empresa_id()) WITH CHECK (empresa_id=public.current_empresa_id());
    GRANT SELECT ON public.providers,public.attachments TO authenticated;
    GRANT SELECT,INSERT ON public.invoices,public.invoice_items TO authenticated;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid(),public.current_empresa_id(),public.is_internal_role(public.user_role[]) TO authenticated;
  `);
  await db.exec(migration);
}, 120000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`
    RESET ROLE; TRUNCATE public.invoice_items,public.invoices,public.providers,public.attachments;
    INSERT INTO public.providers VALUES ('${provider}','${tenant}'),('${otherProvider}','${otherTenant}');
    SELECT set_config('test.actor','${actor}',false),set_config('test.tenant','${tenant}',false),
      set_config('test.role','administracion',false);
    SET ROLE authenticated;
  `);
});

describe("atomic purchase invoice header and reviewed lines", () => {
  it("creates a header and its full line set", async () => {
    const id = await save([line, { ...line, description: "Servicio" }]);
    const rows = await db.query<{ product_description: string }>(
      "SELECT product_description FROM public.invoice_items WHERE invoice_id=$1 ORDER BY sort_order", [id]
    );
    expect(rows.rows.map((item) => item.product_description)).toEqual(["Material", "Servicio"]);
  });

  it("rolls back the header when a later line is invalid", async () => {
    await expect(save([line, { ...line, quantity: 0 }])).rejects.toThrow(/Linea de factura invalida/);
    const result = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM public.invoices");
    expect(result.rows[0].count).toBe("0");
  });

  it("rejects a provider from another company", async () => {
    await expect(save([line], { ...header, provider_id: otherProvider })).rejects.toThrow(/Proveedor no disponible/);
  });

  it("rejects anonymous execution", async () => {
    await db.exec("RESET ROLE; SET ROLE anon");
    await expect(save([line])).rejects.toThrow(/permission denied/);
  });
});
