import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/20261004200423_b11_authority_boundaries.sql"), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
let db: PGlite;
async function actor(n=11, role="authenticated") {
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:id(n),role})]);
  await db.exec(`SET ROLE ${role}`);
}
async function denied(sql: string, pattern: RegExp = /denied|authority|Protected|canonical|immutable|permission denied/i) {
  await db.exec("SAVEPOINT expected_denial");
  await expect(db.exec(sql)).rejects.toThrow(pattern);
  await db.exec("ROLLBACK TO SAVEPOINT expected_denial");
}
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
    GRANT USAGE ON SCHEMA public,auth,private TO anon,authenticated,service_role;
    CREATE TYPE user_role AS ENUM ('admin','administracion','comercial');
    CREATE TYPE invoice_status AS ENUM ('PENDIENTE','MATCH','APROBADO_EXCEPCION','REQUIERE_REVISION','APTO_PARA_PAGO','PAGADO');
    CREATE TYPE order_status AS ENUM ('AUTORIZADO','FACTURADO','APTO_PARA_PAGO','PAGADO');
    CREATE TABLE empresas(id uuid PRIMARY KEY,active boolean DEFAULT true);
    CREATE TABLE profiles(id uuid PRIMARY KEY,empresa_id uuid REFERENCES empresas,role user_role,active boolean DEFAULT true,is_super_admin boolean DEFAULT false);
    CREATE TABLE invoices(id uuid PRIMARY KEY,empresa_id uuid,total numeric DEFAULT 100,status invoice_status DEFAULT 'PENDIENTE');
    CREATE TABLE authorized_orders(id uuid PRIMARY KEY,empresa_id uuid,total_price numeric DEFAULT 100,facturado_amount numeric DEFAULT 0,status order_status DEFAULT 'AUTORIZADO');
    CREATE TABLE invoice_order_matches(invoice_id uuid,authorized_order_id uuid);
    CREATE TABLE invoice_exceptions(invoice_id uuid);
    CREATE TABLE payment_orders(id uuid PRIMARY KEY,empresa_id uuid,status text DEFAULT 'EMITIDA',executed_at timestamptz,cuenta_id uuid);
    CREATE TABLE rfqs(id uuid,empresa_id uuid); CREATE TABLE rfq_providers(id uuid,empresa_id uuid);
    CREATE TABLE audit_logs(id uuid DEFAULT gen_random_uuid(),empresa_id uuid,actor_id uuid,actor_type text,actor_label text,action text,rfq_id uuid,rfq_provider_id uuid,invoice_id uuid,authorized_order_id uuid,detail jsonb);
    ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY audit_logs_select ON audit_logs FOR SELECT USING(actor_id=auth.uid());
    CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
    CREATE FUNCTION is_internal_role(roles user_role[]) RETURNS boolean LANGUAGE sql AS $$ SELECT public.current_profile_role()=ANY(roles) $$;
  `.replace("CREATE FUNCTION is_internal_role(roles user_role[]) RETURNS boolean LANGUAGE sql AS $$ SELECT public.current_profile_role()=ANY(roles) $$;", ""));
  await db.exec(`CREATE FUNCTION current_profile_role() RETURNS user_role LANGUAGE sql AS $$ SELECT role FROM profiles WHERE id=auth.uid() $$;
    CREATE FUNCTION is_internal_role(roles user_role[]) RETURNS boolean LANGUAGE sql AS $$ SELECT public.current_profile_role()=ANY(roles) $$;
    CREATE FUNCTION claim_invoice_job() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
    CREATE FUNCTION requeue_stale_invoice_jobs(integer,integer) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
    CREATE FUNCTION mark_invoice_pagado(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
    CREATE FUNCTION next_cot_code() RETURNS text LANGUAGE sql AS $$ SELECT 'unused'::text $$;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
    INSERT INTO empresas VALUES('${id(1)}',true),('${id(2)}',true),('${id(3)}',false);
    INSERT INTO profiles VALUES('${id(11)}','${id(1)}','admin',true,false),('${id(12)}','${id(2)}','admin',true,false),('${id(13)}','${id(1)}','admin',false,false),('${id(14)}','${id(1)}','comercial',true,false),('${id(15)}','${id(3)}','admin',true,false),('${id(16)}','${id(3)}','admin',true,true);
    INSERT INTO invoices VALUES('${id(21)}','${id(1)}',100,'MATCH'),('${id(22)}','${id(2)}',100,'MATCH');
    INSERT INTO payment_orders(id,empresa_id) VALUES('${id(31)}','${id(1)}');`);
  await db.exec(migration);
  await db.exec(`CREATE TYPE currency_code AS ENUM ('PYG','USD');
    CREATE TABLE providers(id uuid PRIMARY KEY,empresa_id uuid);
    CREATE TABLE attachments(id uuid PRIMARY KEY,empresa_id uuid);
    INSERT INTO providers VALUES('${id(41)}','${id(1)}'),('${id(42)}','${id(2)}');
    INSERT INTO attachments VALUES('${id(51)}','${id(1)}'),('${id(52)}','${id(2)}');
    ALTER TABLE invoices ADD provider_id uuid, ADD attachment_id uuid, ADD currency currency_code DEFAULT 'PYG',ADD updated_at timestamptz;
    ALTER TABLE payment_orders ADD provider_id uuid,ADD code text DEFAULT 'LOCAL-OP';
    UPDATE invoices SET provider_id='${id(41)}' WHERE id='${id(21)}';
    UPDATE invoices SET provider_id='${id(42)}' WHERE id='${id(22)}';
    UPDATE payment_orders SET provider_id='${id(41)}';
    CREATE TABLE payment_order_invoices(empresa_id uuid,payment_order_id uuid,invoice_id uuid);
    CREATE TABLE cuentas_financieras(id uuid PRIMARY KEY,empresa_id uuid,nombre text,tipo text,banco text,numero_cuenta text,activo boolean,updated_at timestamptz,moneda currency_code,saldo numeric DEFAULT 0);
    INSERT INTO cuentas_financieras(id,empresa_id,nombre,moneda) VALUES('${id(61)}','${id(1)}','LOCAL','PYG');
    GRANT ALL ON providers,attachments,payment_order_invoices,cuentas_financieras TO authenticated;
  `);
  await db.exec(readFileSync(resolve("supabase/migrations/20261004204346_b11_invoice_source_tenant.sql"),"utf8"));
  await db.exec(readFileSync(resolve("supabase/migrations/20261004210311_b11_invoice_reconciliation_lock.sql"),"utf8"));
},20000);
beforeEach(async()=>{await db.exec("BEGIN");});
afterEach(async()=>{await db.exec("ROLLBACK; RESET ROLE"); await db.query("SELECT set_config('request.jwt.claims','',false)");});
afterAll(async()=>{await db.close();});
describe("B11 defensive denial boundaries — isolated PostgreSQL fixtures",()=>{
  it.each(["claim_invoice_job()","requeue_stale_invoice_jobs(integer,integer)","mark_invoice_pagado(uuid)","next_cot_code()"])("worker/legacy RPC %s only service role",async signature=>{
    const result=await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service",[signature]);
    expect(result.rows[0]).toEqual({anon:false,authenticated:false,service:true});
  });
  it.each(["mark_invoice_apto_para_pago(uuid)","recompute_invoice_status(uuid)","recompute_order_facturado(uuid)","sync_order_payment_status(uuid)","log_audit_event(text,uuid,uuid,uuid,uuid,jsonb,text,text)"])("public anon denial on %s",async signature=>{
    expect((await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS allowed",[signature])).rows[0]).toEqual({allowed:false});
  });
  it.each([13,15])("inactive identity/company %i has no shared tenant/role authority",async n=>{
    await actor(n);expect((await db.query("SELECT current_empresa_id() AS tenant,current_profile_role() AS role,is_super_admin() AS super")).rows[0]).toEqual({tenant:null,role:null,super:false});
    await denied(`SELECT mark_invoice_apto_para_pago('${id(21)}')`);
  });
  it("active superadmin retains documented suspended-company exception",async()=>{await actor(16);expect((await db.query("SELECT current_empresa_id() AS tenant,is_super_admin() AS super")).rows[0]).toEqual({tenant:id(3),super:true});});
  it.each([12,14])("foreign tenant/non-financial role %i is denied",async n=>{await actor(n);await denied(`SELECT mark_invoice_apto_para_pago('${id(21)}')`);});
  it("own active admin approval passes through canonical RPC",async()=>{await actor();await db.query("SELECT mark_invoice_apto_para_pago($1)",[id(21)]);expect((await db.query("SELECT status FROM invoices WHERE id=$1",[id(21)])).rows[0]).toEqual({status:'APTO_PARA_PAGO'});});
  it("ordinary admin cannot change protected profile authority",async()=>{await actor();await denied(`UPDATE profiles SET is_super_admin=true WHERE id='${id(11)}'`);await denied(`UPDATE profiles SET empresa_id='${id(2)}' WHERE id='${id(11)}'`);await denied(`DELETE FROM profiles WHERE id='${id(16)}'`);});
  it("ordinary profile role/active administration remains available",async()=>{await actor();await db.query("UPDATE profiles SET role='administracion' WHERE id=$1",[id(13)]);});
  it("raw invoice settlement and OP execution are denied",async()=>{await actor();await denied(`UPDATE invoices SET status='PAGADO' WHERE id='${id(21)}'`);await denied(`UPDATE payment_orders SET status='EJECUTADA',executed_at=now() WHERE id='${id(31)}'`);});
  it("settled facts remain immutable to service writes",async()=>{await db.exec(`UPDATE payment_orders SET status='EJECUTADA' WHERE id='${id(31)}'; UPDATE invoices SET status='PAGADO' WHERE id='${id(21)}'`);await denied(`DELETE FROM payment_orders WHERE id='${id(31)}'`);await denied(`UPDATE invoices SET total=101 WHERE id='${id(21)}'`);});
  it("audit foreign source/provider attribution is denied",async()=>{await actor();await denied(`SELECT log_audit_event('test',NULL,NULL,'${id(22)}')`);await denied(`SELECT log_audit_event('test',NULL,NULL,NULL,NULL,NULL,'provider')`);});
  it("own audit event records authoritative actor/tenant",async()=>{await actor();await db.exec(`SELECT log_audit_event('test',NULL,NULL,'${id(21)}')`);expect((await db.query("SELECT actor_id,empresa_id,actor_type FROM audit_logs")).rows[0]).toEqual({actor_id:id(11),empresa_id:id(1),actor_type:'internal'});});
});

describe('B11 financial source/canonical RPC regression',()=>{
 it.each([['provider_id',42],['attachment_id',52]] as const)('denies foreign %s on invoice',async(column,n)=>{await actor();await denied(`UPDATE invoices SET ${column}='${id(n)}' WHERE id='${id(21)}'`,/foreign key/);});
 it('denies foreign provider on OP and allows own supplier/attachment',async()=>{await actor();await denied(`UPDATE payment_orders SET provider_id='${id(42)}' WHERE id='${id(31)}'`,/foreign key/);await db.exec(`UPDATE invoices SET attachment_id='${id(51)}' WHERE id='${id(21)}'`);});
 it('account metadata remains editable, direct balance/creation denied',async()=>{await actor();await db.exec(`UPDATE cuentas_financieras SET nombre='Renamed' WHERE id='${id(61)}'`);await denied(`UPDATE cuentas_financieras SET saldo=1 WHERE id='${id(61)}'`);await denied(`INSERT INTO cuentas_financieras(id,empresa_id) VALUES('${id(62)}','${id(1)}')`);});
 it('unapproved invoice cannot be settled by canonical OP execution',async()=>{await db.exec(`INSERT INTO payment_order_invoices VALUES('${id(1)}','${id(31)}','${id(21)}')`);await actor();await denied(`SELECT ejecutar_orden_pago_atomica('${id(1)}','${id(31)}',NULL,'${id(11)}')`,/facturas ajenas/);expect((await db.query(`SELECT status FROM payment_orders WHERE id='${id(31)}'`)).rows[0]).toEqual({status:'EMITIDA'});});
 it('approved invoice ? canonical OP passes once, repeat denied without extra facts',async()=>{await db.exec(`INSERT INTO payment_order_invoices VALUES('${id(1)}','${id(31)}','${id(21)}')`);await actor();await db.exec(`SELECT mark_invoice_apto_para_pago('${id(21)}'); SELECT ejecutar_orden_pago_atomica('${id(1)}','${id(31)}',NULL,'${id(11)}');`);expect((await db.query(`SELECT status FROM invoices WHERE id='${id(21)}'`)).rows[0]).toEqual({status:'PAGADO'});await denied(`SELECT ejecutar_orden_pago_atomica('${id(1)}','${id(31)}',NULL,'${id(11)}')`,/ya fue ejecutada/);});
});

describe('B11 approval/reconciliation serialization',()=>{
 it.each(['mark_invoice_apto_para_pago','recompute_invoice_status','recompute_order_facturado','sync_order_payment_status'])('%s locks source before actor check/calculation',async name=>{const result=await db.query<{definition:string}>('SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname=$1',[name]);expect(result.rows[0].definition).toMatch(/b11_require_financial_actor\(\(select empresa_id .* for update\)\)/i);});
 it('canonical reconciliation cannot undo an approved invoice',async()=>{await actor();await db.exec(`SELECT mark_invoice_apto_para_pago('${id(21)}'); SELECT recompute_invoice_status('${id(21)}');`);expect((await db.query(`SELECT status FROM invoices WHERE id='${id(21)}'`)).rows[0]).toEqual({status:'APTO_PARA_PAGO'});});
});
