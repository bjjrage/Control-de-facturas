import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baseline = readFileSync(resolve("supabase/migrations/20261002231537_production_schema_baseline.sql"), "utf8").replace(/\r\n/g, "\n");
const proposal = readFileSync(resolve("supabase/migrations/20261013153336_fix_accept_quotation_ot_code.sql"), "utf8");
function original(name: string) {
  const start = baseline.indexOf(`CREATE FUNCTION "public"."${name}"(`);
  const source = baseline.slice(start);
  const opening = source.match(/\bAS (\$[A-Za-z_0-9]*\$)/);
  if (start < 0 || !opening || opening.index === undefined) throw new Error("Missing baseline function " + name);
  const end = source.indexOf(opening[1] + ";", opening.index + opening[0].length);
  if (end < 0) throw new Error("Unterminated baseline function " + name);
  return source.slice(0, end + opening[1].length + 1);
}
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const token = "a".repeat(64);
let db: PGlite;
const accept = () => db.query("SELECT public.accept_quotation($1,'Cliente QA') AS result", [token]);
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public.current_empresa_id() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE TYPE work_order_workflow_status AS ENUM ('PENDING_INTERNAL_APPROVAL','READY_FOR_PRODUCTION');
    CREATE TABLE doc_code_counters(empresa_id uuid,doc_type text,last_number int,PRIMARY KEY(empresa_id,doc_type));
    CREATE TABLE clients(id uuid PRIMARY KEY,name text);
    CREATE TABLE sales_documents(id uuid PRIMARY KEY,empresa_id uuid,client_id uuid,doc_type text,
      acceptance_status text,acceptance_expires_at timestamptz,quotation_version int,currency text,
      subtotal numeric,vat_amount numeric,total numeric,code text,accepted_at timestamptz,
      accepted_by_name text,accepted_by_doc text,rejection_reason text,rejected_at timestamptz);
    CREATE TABLE sales_quotation_tokens(id uuid PRIMARY KEY,token_hash text,empresa_id uuid,sales_document_id uuid,
      revoked_at timestamptz,expires_at timestamptz,quotation_version int,prepared_for_email text,token_prefix text);
    CREATE TABLE work_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,
      sales_document_id uuid UNIQUE,client_id uuid,currency text,subtotal numeric,vat_amount numeric,total numeric,
      status text,notes text,code text,approval_mode text,workflow_status work_order_workflow_status,
      responsible_role text,routing_policy_id uuid);
    CREATE TABLE sales_document_items(sales_document_id uuid,description text,quantity numeric,unit_price numeric,
      vat_rate numeric,line_total numeric,created_at timestamptz DEFAULT now());
    CREATE TABLE work_order_items(empresa_id uuid,work_order_id uuid,description text,quantity numeric,
      unit_price numeric,vat_rate numeric,line_total numeric);
    CREATE TABLE sales_quotation_acceptances(id uuid DEFAULT gen_random_uuid(),empresa_id uuid,sales_document_id uuid UNIQUE,
      quotation_version int,client_id uuid,client_name_snapshot text,subtotal_snapshot numeric,vat_snapshot numeric,
      total_snapshot numeric,currency_snapshot text,channel text,recipient_email text,acceptor_name text,acceptor_doc text,
      acceptor_notes text,ip text,user_agent text,token_id uuid,token_prefix text,items_snapshot jsonb,work_order_id uuid);
    CREATE TABLE sales_quotation_events(empresa_id uuid,sales_document_id uuid,token_id uuid,event_type text,
      actor_label text,actor_ip text,actor_user_agent text,detail jsonb);
    CREATE FUNCTION resolve_work_order_policy(uuid,uuid,uuid)
      RETURNS TABLE(mode text,responsible_role text,policy_id uuid,scope text) LANGUAGE sql
      AS $$ SELECT 'DIRECT_READY'::text,NULL::text,NULL::uuid,'TEST'::text $$;
  `);
  await db.exec(original("next_doc_code") + original("set_work_order_code") + original("accept_quotation"));
  await db.exec(`CREATE TRIGGER code BEFORE INSERT ON work_orders FOR EACH ROW EXECUTE FUNCTION set_work_order_code();
    INSERT INTO clients VALUES('${id(3)}','Cliente QA');
    INSERT INTO sales_documents(id,empresa_id,client_id,doc_type,acceptance_status,quotation_version,currency,subtotal,vat_amount,total,code)
      VALUES('${id(2)}','${id(1)}','${id(3)}','PROFORMA','PENDING_ACCEPTANCE',1,'PYG',20000,2000,22000,'V-QA');
    INSERT INTO sales_quotation_tokens(id,token_hash,empresa_id,sales_document_id,quotation_version,token_prefix)
      VALUES('${id(4)}','${token}','${id(1)}','${id(2)}',1,'aaaaaaaa');
    INSERT INTO sales_document_items VALUES('${id(2)}','Servicio',1,22000,10,22000,now());`);
}, 20000);
afterEach(async () => { await db.close(); });

describe("proposed portal OT code fix against real baseline functions", () => {
  it("reproduces the service caller failure and rolls back acceptance", async () => {
    await expect(accept()).rejects.toThrow("Access denied for document code generation");
    expect((await db.query("SELECT acceptance_status FROM sales_documents")).rows[0]).toEqual({ acceptance_status: "PENDING_ACCEPTANCE" });
    expect((await db.query("SELECT count(*)::int AS n FROM work_orders")).rows[0]).toEqual({ n: 0 });
  });
  it("allocates one tenant OT and preserves idempotency without weakening the public generator", async () => {
    await db.exec(proposal);
    await accept();
    await accept();
    await db.exec(proposal);
    expect((await db.query("SELECT count(*)::int AS n FROM work_orders")).rows[0]).toEqual({ n: 1 });
    expect((await db.query("SELECT last_number FROM doc_code_counters")).rows[0]).toEqual({ last_number: 1 });
    await expect(db.query("SELECT next_doc_code($1,'OT')", [id(1)])).rejects.toThrow("Access denied");
  });
  it.each([
    "UPDATE sales_quotation_tokens SET revoked_at=now()",
    `UPDATE sales_quotation_tokens SET empresa_id='${id(99)}'`,
    "UPDATE sales_documents SET quotation_version=2",
    "UPDATE sales_quotation_tokens SET expires_at='2000-01-01'",
  ])("retains token guard and creates no OT/counter: %s", async (mutation) => {
    await db.exec(proposal);
    await db.exec(mutation);
    await expect(accept()).rejects.toThrow();
    expect((await db.query("SELECT count(*)::int AS n FROM work_orders")).rows[0]).toEqual({ n: 0 });
    expect((await db.query("SELECT count(*)::int AS n FROM doc_code_counters")).rows[0]).toEqual({ n: 0 });
  });
});
