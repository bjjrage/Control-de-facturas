import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/20261004200423_b11_authority_boundaries.sql"), "utf8");
const baseline = readFileSync(resolve("supabase/migrations/20261002231537_production_schema_baseline.sql"), "utf8");
function baselineFunction(name: string) {
  const start = baseline.indexOf(`CREATE FUNCTION "public"."${name}"`);
  if (start < 0) throw new Error(`Missing actual baseline function: ${name}`);
  return baseline.slice(start, baseline.indexOf('ALTER FUNCTION', start));
}
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
  // Actual reconciliation/treasury functions and relationship policies, not mocks.
  await db.exec(`ALTER TABLE invoice_order_matches ADD id uuid DEFAULT gen_random_uuid(),ADD empresa_id uuid;
    ALTER TABLE invoice_order_matches ADD FOREIGN KEY(invoice_id) REFERENCES invoices ON DELETE CASCADE;
    ALTER TABLE invoice_order_matches ADD FOREIGN KEY(authorized_order_id) REFERENCES authorized_orders;
    ALTER TABLE invoice_order_matches ADD UNIQUE(invoice_id);
    ALTER TABLE payment_order_invoices ADD FOREIGN KEY(payment_order_id) REFERENCES payment_orders ON DELETE CASCADE;
    ALTER TABLE payment_order_invoices ADD FOREIGN KEY(invoice_id) REFERENCES invoices;
    ALTER TABLE payment_order_invoices ADD UNIQUE(invoice_id);
    CREATE TABLE projects(id uuid,empresa_id uuid);
    CREATE TABLE sales_documents(id uuid,empresa_id uuid,currency currency_code);
    CREATE TABLE sales_receipts(id uuid,empresa_id uuid,sales_document_id uuid,cuenta_id uuid,amount numeric,reversed_at timestamptz);
    CREATE TABLE movimientos_tesoreria(id uuid DEFAULT gen_random_uuid(),empresa_id uuid,cuenta_id uuid,fecha date,monto numeric,tipo text,motivo text,payment_order_id uuid,sales_receipt_id uuid,project_id uuid,created_by uuid);
    GRANT SELECT ON movimientos_tesoreria TO authenticated;
    ALTER TABLE invoice_order_matches ENABLE ROW LEVEL SECURITY;
    ALTER TABLE payment_order_invoices ENABLE ROW LEVEL SECURITY;
    ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
    ALTER TABLE authorized_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
  `);
  for (const name of ['set_invoice_order_matches_empresa','set_payment_order_invoices_empresa','trg_recompute_on_match_change','registrar_movimiento_tesoreria','fn_mov_tesoreria_saldo']) {
    await db.exec(baselineFunction(name));
  }
  for (const table of ['invoice_order_matches','payment_order_invoices','invoices','authorized_orders','payment_orders']) {
    for (const policy of baseline.matchAll(new RegExp(`CREATE POLICY [^\\n]+ ON "public"\\."${table}"[^\\n]+;`, 'g'))) await db.exec(policy[0]);
  }
  await db.exec(`CREATE TRIGGER trg_invoice_order_matches_empresa BEFORE INSERT ON invoice_order_matches FOR EACH ROW EXECUTE FUNCTION set_invoice_order_matches_empresa();
    CREATE TRIGGER trg_payment_order_invoices_empresa BEFORE INSERT ON payment_order_invoices FOR EACH ROW EXECUTE FUNCTION set_payment_order_invoices_empresa();
    CREATE TRIGGER trg_iom_recompute AFTER INSERT OR UPDATE OR DELETE ON invoice_order_matches FOR EACH ROW EXECUTE FUNCTION trg_recompute_on_match_change();
    CREATE TRIGGER trg_mov_tesoreria_saldo AFTER INSERT ON movimientos_tesoreria FOR EACH ROW EXECUTE FUNCTION fn_mov_tesoreria_saldo();`);
  await db.exec(readFileSync(resolve("supabase/migrations/20261004213348_b11_settled_financial_relationships.sql"),"utf8"));
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

describe('B11 external correction — financial relationship immutability',()=>{
 beforeEach(async()=>{
   await db.exec(`INSERT INTO authorized_orders(id,empresa_id,total_price) VALUES('${id(71)}','${id(1)}',100),('${id(72)}','${id(1)}',100);
     INSERT INTO invoices(id,empresa_id,total,status,provider_id) VALUES('${id(23)}','${id(1)}',100,'MATCH','${id(41)}');
     INSERT INTO payment_orders(id,empresa_id,provider_id) VALUES('${id(32)}','${id(1)}','${id(41)}');
     INSERT INTO invoice_order_matches(invoice_id,authorized_order_id) VALUES('${id(21)}','${id(71)}');
     INSERT INTO payment_order_invoices VALUES('${id(1)}','${id(31)}','${id(21)}');`);
 });
 async function settle() {
   await actor();
   await db.exec(`SELECT mark_invoice_apto_para_pago('${id(21)}');
     SELECT ejecutar_orden_pago_atomica('${id(1)}','${id(31)}','${id(61)}','${id(11)}');`);
 }
 async function facts() {
   return (await db.query<{
     invoice_status: string; op_status: string; order_status: string; order_id: string | null; op_id: string | null;
     facturado: number; movements: number; actual_amount: number | null; balance: number;
   }>(`SELECT
     (SELECT status FROM invoices WHERE id='${id(21)}') AS invoice_status,
     (SELECT status FROM payment_orders WHERE id='${id(31)}') AS op_status,
     (SELECT status FROM authorized_orders WHERE id='${id(71)}') AS order_status,
     (SELECT authorized_order_id FROM invoice_order_matches WHERE invoice_id='${id(21)}') AS order_id,
     (SELECT payment_order_id FROM payment_order_invoices WHERE invoice_id='${id(21)}') AS op_id,
     (SELECT facturado_amount::float8 FROM authorized_orders WHERE id='${id(71)}') AS facturado,
     (SELECT count(*)::int FROM movimientos_tesoreria WHERE payment_order_id='${id(31)}') AS movements,
     (SELECT sum(monto)::float8 FROM movimientos_tesoreria WHERE payment_order_id='${id(31)}') AS actual_amount,
     (SELECT saldo::float8 FROM cuentas_financieras WHERE id='${id(61)}') AS balance`)).rows[0];
 }
 it('MATCH invoice may unlink; real reconciliation returns invoice pending and OC authorized',async()=>{
   await actor();await db.exec(`DELETE FROM invoice_order_matches WHERE invoice_id='${id(21)}'`);
   expect((await db.query(`SELECT status FROM invoices WHERE id='${id(21)}'`)).rows[0]).toEqual({status:'PENDIENTE'});
   expect((await db.query(`SELECT status,facturado_amount::float8 AS facturado FROM authorized_orders WHERE id='${id(71)}'`)).rows[0]).toEqual({status:'AUTORIZADO',facturado:0});
 });
 it.each(['PENDIENTE','APROBADO_EXCEPCION','REQUIERE_REVISION'])('%s unpaid invoice can still unlink',async status=>{
   await db.query(`UPDATE invoices SET status=$1 WHERE id='${id(21)}'`,[status]);
   await actor();await db.exec(`DELETE FROM invoice_order_matches WHERE invoice_id='${id(21)}'`);
 });
 it('APTO_PARA_PAGO invoice DELETE is rejected and relation stays intact',async()=>{
   await actor();await db.exec(`SELECT mark_invoice_apto_para_pago('${id(21)}')`);
   await denied(`DELETE FROM invoice_order_matches WHERE invoice_id='${id(21)}'`,/No se puede/);
   expect((await facts()).order_id).toBe(id(71));
 });
 it('PAGADO invoice DELETE is rejected; OC and financial facts do not regress',async()=>{
   await settle();const before=await facts();
   await denied(`DELETE FROM invoice_order_matches WHERE invoice_id='${id(21)}'`,/No se puede/);
   expect(await facts()).toEqual(before);
   expect(before).toMatchObject({invoice_status:'PAGADO',op_status:'EJECUTADA',order_status:'APTO_PARA_PAGO',order_id:id(71),op_id:id(31),facturado:100,movements:1,actual_amount:-100,balance:-100});
 });
 it.each(['APTO_PARA_PAGO','PAGADO'])('%s invoice cannot INSERT another OC or repoint its existing link, even in maintenance context',async status=>{
   if(status==='PAGADO') await settle();else {await actor();await db.exec(`SELECT mark_invoice_apto_para_pago('${id(21)}')`);}
   await db.exec('RESET ROLE');
   await denied(`INSERT INTO invoice_order_matches(invoice_id,authorized_order_id) VALUES('${id(21)}','${id(72)}')`,/No se puede/);
   await denied(`UPDATE invoice_order_matches SET authorized_order_id='${id(72)}' WHERE invoice_id='${id(21)}'`,/No se puede/);
   await denied(`UPDATE invoice_order_matches SET invoice_id='${id(23)}' WHERE invoice_id='${id(21)}'`,/No se puede/);
   expect((await facts()).order_id).toBe(id(71));
 });
 it('repoint checks the destination invoice as well as the original',async()=>{
   await db.exec(`UPDATE invoices SET status='PAGADO' WHERE id='${id(23)}'`);
   await denied(`UPDATE invoice_order_matches SET invoice_id='${id(23)}' WHERE invoice_id='${id(21)}'`,/No se puede/);
 });
 it.each(['APTO_PARA_PAGO','PAGADO'])('terminal OC %s freezes insertion/deletion/repoint independently of invoice status',async status=>{
   await db.query(`UPDATE authorized_orders SET status=$1 WHERE id='${id(71)}'`,[status]);
   await denied(`DELETE FROM invoice_order_matches WHERE invoice_id='${id(21)}'`,/No se pueden/);
   await denied(`UPDATE invoice_order_matches SET authorized_order_id='${id(72)}' WHERE invoice_id='${id(21)}'`,/No se pueden/);
   await denied(`INSERT INTO invoice_order_matches(invoice_id,authorized_order_id) VALUES('${id(23)}','${id(71)}')`,/No se pueden/);
 });
 it('OC repoint checks the terminal destination order',async()=>{
   await db.exec(`UPDATE authorized_orders SET status='PAGADO' WHERE id='${id(72)}'`);
   await denied(`UPDATE invoice_order_matches SET authorized_order_id='${id(72)}' WHERE invoice_id='${id(21)}'`,/No se pueden/);
 });
 it('EMITIDA OP membership INSERT/DELETE remains available with existing RLS',async()=>{
   await actor();await db.exec(`DELETE FROM payment_order_invoices WHERE payment_order_id='${id(31)}';
     INSERT INTO payment_order_invoices VALUES('${id(1)}','${id(32)}','${id(21)}');
     DELETE FROM payment_order_invoices WHERE payment_order_id='${id(32)}';
     INSERT INTO payment_order_invoices VALUES('${id(1)}','${id(31)}','${id(21)}');`);
   expect((await facts()).op_id).toBe(id(31));
 });
 it('existing pre-execution UPDATE denial policy is preserved; trusted unpaid repoint still works',async()=>{
   await actor();const result=await db.query(`UPDATE payment_order_invoices SET payment_order_id='${id(32)}' WHERE invoice_id='${id(21)}' RETURNING invoice_id`);
   expect(result.rows).toHaveLength(0);await db.exec('RESET ROLE');
   await db.exec(`UPDATE payment_order_invoices SET payment_order_id='${id(32)}' WHERE invoice_id='${id(21)}'`);
   expect((await facts()).op_id).toBe(id(32));
 });
 it('EJECUTADA OP DELETE is rejected',async()=>{await settle();await denied(`DELETE FROM payment_order_invoices WHERE payment_order_id='${id(31)}'`,/OP ejecutada/);expect((await facts()).op_id).toBe(id(31));});
 it('EJECUTADA OP INSERT is rejected',async()=>{await settle();await denied(`INSERT INTO payment_order_invoices VALUES('${id(1)}','${id(31)}','${id(23)}')`,/OP ejecutada/);});
 it('EJECUTADA OP UPDATE/repoint is rejected even in maintenance context',async()=>{
   await settle();await db.exec('RESET ROLE');
   await denied(`UPDATE payment_order_invoices SET payment_order_id='${id(32)}' WHERE invoice_id='${id(21)}'`,/OP ejecutada/);
   await denied(`UPDATE payment_order_invoices SET invoice_id='${id(23)}' WHERE invoice_id='${id(21)}'`,/OP ejecutada/);
 });
 it('OP repoint also checks an executed destination',async()=>{
   await settle();await db.exec('RESET ROLE');
   await db.exec(`INSERT INTO payment_order_invoices VALUES('${id(1)}','${id(32)}','${id(23)}')`);
   await denied(`UPDATE payment_order_invoices SET payment_order_id='${id(31)}' WHERE invoice_id='${id(23)}'`,/OP ejecutada/);
 });
 it('paid invoice membership cannot change even if the OP remains EMITIDA',async()=>{
   await db.exec(`UPDATE invoices SET status='PAGADO' WHERE id='${id(21)}'`);
   await denied(`DELETE FROM payment_order_invoices WHERE invoice_id='${id(21)}'`,/factura pagada/);
   await denied(`UPDATE payment_order_invoices SET payment_order_id='${id(32)}' WHERE invoice_id='${id(21)}'`,/factura pagada/);
   await db.exec(`UPDATE invoices SET status='PAGADO' WHERE id='${id(23)}'`);
   await denied(`INSERT INTO payment_order_invoices VALUES('${id(1)}','${id(32)}','${id(23)}')`,/factura pagada/);
 });
 it('canonical OP execution succeeds, rejects replay and posts treasury exactly once',async()=>{
   await settle();const before=await facts();
   await denied(`SELECT ejecutar_orden_pago_atomica('${id(1)}','${id(31)}','${id(61)}','${id(11)}')`,/ya fue ejecutada/);
   expect(await facts()).toEqual(before);expect(before.movements).toBe(1);expect(before.actual_amount).toBe(-100);
 });
 it('B09 source facts stay identical after all rejected settled mutations',async()=>{
   await settle();const before=await facts();await db.exec('RESET ROLE');
   for(const sql of [
     `DELETE FROM invoice_order_matches WHERE invoice_id='${id(21)}'`,
     `UPDATE invoice_order_matches SET authorized_order_id='${id(72)}' WHERE invoice_id='${id(21)}'`,
     `DELETE FROM payment_order_invoices WHERE invoice_id='${id(21)}'`,
     `UPDATE payment_order_invoices SET invoice_id='${id(23)}' WHERE invoice_id='${id(21)}'`,
     `INSERT INTO payment_order_invoices VALUES('${id(1)}','${id(31)}','${id(23)}')`,
   ]) await denied(sql,/No se pued/);
   expect(await facts()).toEqual(before);
 });
 it.each(['APTO_PARA_PAGO','PAGADO'])('%s invoice cannot be deleted through FK cascade',async status=>{
   if(status==='PAGADO') await settle();else {await actor();await db.exec(`SELECT mark_invoice_apto_para_pago('${id(21)}')`);}
   await db.exec('RESET ROLE');
   await denied(`DELETE FROM invoices WHERE id='${id(21)}'`,/No se puede eliminar/);
 });
 it('normal unpaid OP deletion still cascades membership',async()=>{
   await actor();await db.exec(`DELETE FROM payment_orders WHERE id='${id(31)}'`);
   expect((await db.query(`SELECT * FROM payment_order_invoices WHERE payment_order_id='${id(31)}'`)).rows).toHaveLength(0);
 });
 it('actual guard definitions lock exact OLD/NEW parents in canonical order with no service exception',async()=>{
   for(const name of ['b11_guard_invoice_order_relationship','b11_guard_op_invoice_relationship']) {
     const {rows}=await db.query<{definition:string;prosecdef:boolean}>(`SELECT pg_get_functiondef(oid) AS definition,prosecdef FROM pg_proc WHERE proname=$1`,[name]);
     expect(rows[0].prosecdef).toBe(false);expect(rows[0].definition.match(/ORDER BY [ipo]\.id FOR UPDATE/g)).toHaveLength(2);
     expect(rows[0].definition).toContain('OLD.invoice_id');expect(rows[0].definition).toContain('NEW.invoice_id');
     expect(rows[0].definition).not.toMatch(/service_role|current_user/);
     if(name.includes('op_invoice')) expect(rows[0].definition.indexOf('FROM public.payment_orders')).toBeLessThan(rows[0].definition.indexOf('FROM public.invoices'));
     else expect(rows[0].definition.indexOf('FROM public.invoices')).toBeLessThan(rows[0].definition.indexOf('FROM public.authorized_orders'));
   }
 });
});
