import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../supabase/migrations/20261018120400_mark_apto_and_create_op_atomic.sql", import.meta.url), "utf8");
const tenant = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const provider = "33333333-3333-4333-8333-333333333333";
const invoice = "44444444-4444-4444-8444-444444444444";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TYPE public.user_role AS ENUM ('administracion','admin');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    CREATE FUNCTION public.current_empresa_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.tenant',true),'')::uuid $$;
    CREATE FUNCTION public.is_internal_role(public.user_role[]) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE TABLE public.invoices(id uuid PRIMARY KEY, empresa_id uuid, provider_id uuid, status text);
    CREATE TABLE public.payment_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, code text, provider_id uuid, status text, created_by uuid);
    CREATE TABLE public.payment_order_invoices(empresa_id uuid, payment_order_id uuid, invoice_id uuid UNIQUE);
    CREATE FUNCTION public.mark_invoice_apto_para_pago(p_invoice_id uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      UPDATE public.invoices SET status='APTO_PARA_PAGO' WHERE id=p_invoice_id AND status='MATCH';
      IF NOT FOUND THEN RAISE EXCEPTION 'not matched'; END IF;
    END $$;
    CREATE FUNCTION public.next_op_code() RETURNS text LANGUAGE sql AS $$ SELECT 'OP-TEST'::text $$;
  `);
  await db.exec(sql);
}, 120000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`TRUNCATE public.payment_order_invoices, public.payment_orders, public.invoices;
    SELECT set_config('test.actor','${actor}',false), set_config('test.tenant','${tenant}',false);
    INSERT INTO public.invoices VALUES ('${invoice}','${tenant}','${provider}','MATCH');`);
});

describe("#2 apto and payment order transaction", () => {
  it("rolls back apto if linking to a payment order fails", async () => {
    await db.exec(`INSERT INTO public.payment_order_invoices VALUES ('${tenant}',gen_random_uuid(),'${invoice}')`);
    await expect(db.query("SELECT public.mark_apto_y_crear_op_atomica($1,$2,$3)",[tenant,invoice,actor])).rejects.toThrow();
    expect((await db.query<{ status: string }>("SELECT status FROM public.invoices")).rows[0].status).toBe("MATCH");
    expect((await db.query("SELECT id FROM public.payment_orders")).rows).toHaveLength(0);
  });
  it("marks apto, creates and links one OP when valid", async () => {
    await db.query("SELECT public.mark_apto_y_crear_op_atomica($1,$2,$3)",[tenant,invoice,actor]);
    expect((await db.query<{ status: string }>("SELECT status FROM public.invoices")).rows[0].status).toBe("APTO_PARA_PAGO");
    expect((await db.query("SELECT id FROM public.payment_orders")).rows).toHaveLength(1);
    expect((await db.query("SELECT invoice_id FROM public.payment_order_invoices")).rows).toHaveLength(1);
  });
});
