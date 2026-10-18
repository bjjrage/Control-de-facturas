/** Exact proposed SQL on ephemeral PGlite. No live SQL is executed.
 * Treasury downstream is a minimal test stub: this verifies the guards and
 * rollback, not the production ledger or concurrent PostgreSQL locks.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
let db: PGlite;
const tenant="11111111-1111-4111-8111-111111111111", actor="22222222-2222-4222-8222-222222222222";
const provider="33333333-3333-4333-8333-333333333333", attachment="44444444-4444-4444-8444-444444444444";
const invoice="55555555-5555-4555-8555-555555555555", order="66666666-6666-4666-8666-666666666666";
const sale="77777777-7777-4777-8777-777777777777", client="88888888-8888-4888-8888-888888888888", account="99999999-9999-4999-8999-999999999999";
const job="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const releaseSql=readFileSync(new URL("../../supabase/migrations/20261017182341_audit_financial_guards.sql",import.meta.url),"utf8");
const receiptIdempotencySql=readFileSync(new URL("../../supabase/migrations/20261017194800_sales_receipt_idempotency.sql",import.meta.url),"utf8");
const preventNegativeSql=readFileSync(new URL("../../supabase/migrations/20261018120200_payment_prevent_negative_balance.sql",import.meta.url),"utf8");
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE SCHEMA private;
 CREATE TYPE public.user_role AS ENUM ('admin','administracion','comercial');
 CREATE TYPE public.currency_code AS ENUM ('PYG','USD');
 CREATE TYPE public.sales_doc_status AS ENUM ('BORRADOR','EMITIDA','COBRADA_PARCIAL','COBRADA','ANULADA');
 CREATE TYPE public.receipt_method AS ENUM ('EFECTIVO','TRANSFERENCIA');
 CREATE TYPE public.invoice_job_status AS ENUM ('processing','queued','needs_review');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role',true) $$;
 CREATE FUNCTION public.current_empresa_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.tenant',true),'')::uuid $$;
 CREATE FUNCTION public.is_internal_role(public.user_role[]) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role',true)='authenticated' $$;
 CREATE FUNCTION private.b11_require_financial_actor(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF $1 IS DISTINCT FROM public.current_empresa_id() THEN RAISE EXCEPTION 'foreign tenant'; END IF; END $$;
 CREATE TABLE providers(id uuid,empresa_id uuid,tax_id text,UNIQUE(empresa_id,id));
 CREATE TABLE attachments(id uuid,empresa_id uuid,bucket text,path text,UNIQUE(empresa_id,id));
 CREATE TABLE invoices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,provider_id uuid,attachment_id uuid,invoice_number text,invoice_date date,due_date date,currency public.currency_code,total numeric,subtotal numeric,vat numeric,timbrado text,created_by uuid,status text DEFAULT 'PENDIENTE',updated_at timestamptz);
 CREATE TABLE authorized_orders(id uuid PRIMARY KEY,empresa_id uuid,provider_id uuid,currency public.currency_code,code text,product text);
 CREATE TABLE authorized_order_items(id uuid,empresa_id uuid,order_id uuid,product text);
 CREATE TABLE invoice_order_matches(invoice_id uuid,authorized_order_id uuid,empresa_id uuid);
 CREATE FUNCTION private.guard_invoice_order_match_tenant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
 CREATE TRIGGER zzz_r3_invoice_order_match_tenant BEFORE INSERT ON invoice_order_matches FOR EACH ROW EXECUTE FUNCTION private.guard_invoice_order_match_tenant();
 CREATE TABLE payment_orders(id uuid PRIMARY KEY,empresa_id uuid,provider_id uuid,status text,total numeric,code text,executed_at timestamptz,cuenta_id uuid);
 CREATE TABLE payment_order_invoices(invoice_id uuid,payment_order_id uuid,empresa_id uuid);
 CREATE TABLE sales_documents(id uuid PRIMARY KEY,empresa_id uuid,client_id uuid,currency public.currency_code,doc_type text,status text,total numeric,cobrado_amount numeric DEFAULT 0,source_document_id uuid,code text,subtotal numeric,vat_amount numeric);
 CREATE TABLE sales_document_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,sales_document_id uuid,quantity numeric,unit_price numeric,vat_rate numeric,line_total numeric);
 CREATE TABLE cuentas_financieras(id uuid PRIMARY KEY,empresa_id uuid,moneda public.currency_code,saldo numeric);
 CREATE TABLE sales_receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,sales_document_id uuid,amount numeric,receipt_date date,method public.receipt_method,reference text,notes text,cuenta_id uuid,created_by uuid,reversed_at timestamptz);
 CREATE FUNCTION public.registrar_movimiento_tesoreria(p_empresa_id uuid,p_cuenta_id uuid,p_monto numeric,p_tipo text,p_fecha date DEFAULT NULL,p_motivo text DEFAULT NULL,p_payment_order_id uuid DEFAULT NULL,p_sales_receipt_id uuid DEFAULT NULL,p_project_id uuid DEFAULT NULL,p_created_by uuid DEFAULT NULL,p_permitir_negativo boolean DEFAULT false) RETURNS numeric LANGUAGE plpgsql AS $$
 DECLARE v_saldo numeric;
 BEGIN
   UPDATE public.cuentas_financieras SET saldo=saldo+p_monto
   WHERE id=p_cuenta_id AND empresa_id=p_empresa_id RETURNING saldo INTO v_saldo;
   IF p_monto < 0 AND NOT coalesce(p_permitir_negativo,false) AND v_saldo < 0 THEN
     RAISE EXCEPTION 'Saldo insuficiente';
   END IF;
   RETURN v_saldo;
 END $$;
 CREATE TABLE profiles(id uuid,empresa_id uuid,active boolean DEFAULT true,role public.user_role DEFAULT 'admin');
 CREATE TABLE invoice_jobs(id uuid PRIMARY KEY,empresa_id uuid,created_by uuid,status public.invoice_job_status,attempts integer,invoice_id uuid,provider_id uuid,updated_at timestamptz);
 CREATE TABLE audit_logs(empresa_id uuid,actor_id uuid,actor_type text,actor_label text,action text,invoice_id uuid,detail jsonb);
 `);
 await db.exec(releaseSql);
 await db.exec(receiptIdempotencySql);
 await db.exec(preventNegativeSql);
},120000);
afterAll(async()=>{await db?.close()});
beforeEach(async()=>{
 await db.exec(`RESET ROLE; TRUNCATE sales_document_items,invoices,providers,attachments,authorized_orders,invoice_order_matches,payment_orders,payment_order_invoices,sales_documents,sales_receipts,cuentas_financieras,profiles,invoice_jobs,audit_logs CASCADE;
 SELECT set_config('test.actor','${actor}',false),set_config('test.tenant','${tenant}',false),set_config('test.role','authenticated',false);
 INSERT INTO providers VALUES('${provider}','${tenant}','80000000-1');
 INSERT INTO attachments VALUES('${attachment}','${tenant}','invoice-files','test.pdf');
 INSERT INTO invoices(id,empresa_id,provider_id,attachment_id,invoice_number,currency,total,created_by) VALUES('${invoice}','${tenant}','${provider}','${attachment}','001','PYG',110,'${actor}');
 INSERT INTO authorized_orders VALUES('${order}','${tenant}','${provider}','PYG','OC-TEST','Cemento');
 INSERT INTO sales_documents(id,empresa_id,client_id,currency,doc_type,status,total,code) VALUES('${sale}','${tenant}','${client}','PYG','FACTURA','EMITIDA',110,'V-TEST');
 INSERT INTO cuentas_financieras VALUES('${account}','${tenant}','PYG',1000);
 INSERT INTO profiles(id,empresa_id) VALUES('${actor}','${tenant}');
 INSERT INTO invoice_jobs VALUES('${job}','${tenant}','${actor}','processing',1,NULL,NULL,now());`);
});
const register=(tax="80000000-1",att=attachment)=>db.query("SELECT register_invoice_identity($1,$2,$3,$4,$5::jsonb,$6)",[invoice,att,"a".repeat(64),tax,JSON.stringify({provider_tax_id:tax,invoice_number:"001",invoice_date:null,total:110,product_description:"Cemento",items:[{description:"Cemento"}]}),actor]);
const link=()=>db.exec(`INSERT INTO invoice_order_matches VALUES('${invoice}','${order}','${tenant}')`);
const collect=(amount=10)=>db.query("SELECT registrar_cobro_atomico($1,$2,$3,'EFECTIVO',CURRENT_DATE,NULL,NULL,$4,$5)",[tenant,sale,amount,account,actor]);
const collectOnce=(key:string,amount=10,reference:string|null=null)=>db.query<{receipt_id:string}>(
 "SELECT registrar_cobro_idempotente($1,$2,$3,'EFECTIVO',CURRENT_DATE,$4,NULL,$5,$6,$7) AS receipt_id",
 [tenant,sale,amount,reference,account,actor,key]
);
describe("proposed financial SQL guards (local only)",()=>{
 it("returns one receipt and one treasury movement for a repeated request",async()=>{
   const key="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
   const first=await collectOnce(key,110);
   await db.exec(`UPDATE sales_documents SET status='COBRADA' WHERE id='${sale}'`);
   const replay=await collectOnce(key,110);
   expect(replay.rows[0].receipt_id).toBe(first.rows[0].receipt_id);
   expect((await db.query<{count:string}>("SELECT count(*)::text AS count FROM sales_receipts")).rows[0].count).toBe("1");
   expect((await db.query<{saldo:string}>("SELECT saldo::text AS saldo FROM cuentas_financieras WHERE id=$1",[account])).rows[0].saldo).toBe("1110");
 });
 it("rejects a changed payload for an already-used attempt key",async()=>{
   const key="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
   await collectOnce(key);
   await expect(collectOnce(key,11)).rejects.toThrow(/otro cobro/);
   await expect(collectOnce(key,10,"different")).rejects.toThrow(/otro cobro/);
   expect((await db.query<{count:string}>("SELECT count(*)::text AS count FROM sales_receipts")).rows[0].count).toBe("1");
 });
 it("rejects amounts the receipt column would round, so identical retries stay identical",async()=>{
   await expect(collectOnce("dddddddd-dddd-4ddd-8ddd-dddddddddddd",10.001)).rejects.toThrow(/dos decimales/);
   expect((await db.query<{count:string}>("SELECT count(*)::text AS count FROM sales_receipts")).rows[0].count).toBe("0");
 });
 it("unverified identity cannot link, MATCH or become payable",async()=>{
   await expect(link()).rejects.toThrow(/sin identidad/);
   await expect(db.exec(`UPDATE invoices SET status='MATCH' WHERE id='${invoice}'`)).rejects.toThrow(/sin identidad/);
   await expect(db.exec(`UPDATE invoices SET status='APTO_PARA_PAGO' WHERE id='${invoice}'`)).rejects.toThrow(/sin identidad/);
 });
 it("rejects foreign RUC, wrong check digit and wrong original",async()=>{
   await expect(register("88888888-2")).rejects.toThrow(/RUC/);
   await expect(register("80000000-9")).rejects.toThrow(/RUC/);
   await expect(register("80000000-1",order)).rejects.toThrow(/original/);
   expect((await db.query("SELECT * FROM invoice_identity_evidence")).rows).toHaveLength(0);
 });
 it("authenticated cannot fabricate the typed evidence",async()=>{
   await db.exec("SET ROLE authenticated");
   await expect(register()).rejects.toThrow(/permission denied/);
   await db.exec("RESET ROLE");
 });
 it("verified original allows same supplier/currency OC and payable state",async()=>{
   await register();await link();await db.exec(`UPDATE invoices SET status='MATCH' WHERE id='${invoice}';UPDATE invoices SET status='APTO_PARA_PAGO' WHERE id='${invoice}'`);
   expect((await db.query("SELECT status FROM invoices WHERE id=$1",[invoice])).rows[0]).toEqual({status:"APTO_PARA_PAGO"});
 });
 it.each(["provider_id", "currency"])("rejects a conflicting OC %s",async field=>{
   await register();await db.exec(field==="currency"?`UPDATE authorized_orders SET currency='USD'`:`UPDATE authorized_orders SET provider_id='${actor}'`);
   await expect(link()).rejects.toThrow(/Proveedor y moneda/);
 });
 it("evidence cannot authorize changed amounts or be updated by service_role",async()=>{
   await register();await db.exec(`UPDATE invoices SET total=120 WHERE id='${invoice}'`);
   await expect(link()).rejects.toThrow(/sin identidad/);
   await db.exec("SET ROLE service_role");await expect(db.exec("UPDATE invoice_identity_evidence SET total=120")).rejects.toThrow(/permission denied/);await db.exec("RESET ROLE");
 });
 it.each(["NOTA_CREDITO","REMISION","PROFORMA"])("rejects positive %s collection without treasury effects",async type=>{
   if(type==="NOTA_CREDITO") {
     await db.exec(`INSERT INTO sales_documents(id,empresa_id,client_id,currency,doc_type,status,total,code) VALUES('${order}','${tenant}','${client}','PYG','FACTURA','EMITIDA',110,'V-SOURCE')`);
     await db.query("UPDATE sales_documents SET doc_type=$1,source_document_id=$3 WHERE id=$2",[type,sale,order]);
   } else await db.query("UPDATE sales_documents SET doc_type=$1 WHERE id=$2",[type,sale]);
   await expect(collect()).rejects.toThrow(/no admite cobros positivos/);
   expect((await db.query("SELECT * FROM sales_receipts")).rows).toHaveLength(0);
   expect((await db.query("SELECT saldo FROM cuentas_financieras")).rows[0]).toEqual({saldo:"1000"});
 });
 it("accepts invoice/legacy note and rejects amount beyond NC-adjusted debt",async()=>{
   await db.exec(`INSERT INTO sales_documents(id,empresa_id,client_id,currency,doc_type,status,total,source_document_id) VALUES('${order}','${tenant}','${client}','PYG','NOTA_CREDITO','EMITIDA',100,'${sale}')`);
   await expect(collect(11)).rejects.toThrow(/supera el saldo/);
   await collect(10);expect((await db.query("SELECT saldo FROM cuentas_financieras")).rows[0]).toEqual({saldo:"1010"});
 });
 it("bulk RPC persists the printed due_date and rolls back invalid date",async()=>{
   await db.exec("SELECT set_config('test.role','service_role',false)");
   const data={provider_id:provider,invoice_number:"BULK-001",invoice_date:"2026-10-17",due_date:"bad-date",currency:"PYG",total:110,attachment_id:attachment};
   await expect(db.query("SELECT create_invoice_from_job($1,$2,1,$3::jsonb)",[tenant,job,JSON.stringify(data)])).rejects.toThrow();
   expect((await db.query("SELECT invoice_id FROM invoice_jobs")).rows[0]).toEqual({invoice_id:null});
   data.due_date="2026-10-25";await db.query("SELECT create_invoice_from_job($1,$2,1,$3::jsonb)",[tenant,job,JSON.stringify(data)]);
   const saved=(await db.query("SELECT due_date::text FROM invoices WHERE invoice_number='BULK-001'")).rows[0];expect(saved).toEqual({due_date:"2026-10-25"});
 });
});

it("cross-company sales line cannot be attached to another tenant document", async()=>{
 await expect(db.query("INSERT INTO sales_document_items(empresa_id,sales_document_id,line_total,vat_rate) VALUES($1,$2,100,0)",[actor,sale])).rejects.toThrow(/misma empresa/);
 expect((await db.query("SELECT * FROM sales_document_items")).rows).toHaveLength(0);
 await db.query("INSERT INTO sales_document_items(empresa_id,sales_document_id,line_total,vat_rate) VALUES($1,$2,100,0)",[tenant,sale]);
 await db.query("SELECT recompute_sales_document($1)",[sale]);
 expect((await db.query("SELECT total FROM sales_documents WHERE id=$1",[sale])).rows[0]).toEqual({total:"100.00"});
});

it("verified issuer cannot make another product payable by choosing an OC manually",async()=>{
 await register();await db.exec("UPDATE authorized_orders SET product='Cal agricola'");
 await expect(link()).rejects.toThrow(/producto o la referencia/);
});

it("registration retry is idempotent and retains the actual verifier",async()=>{
 await db.exec(`INSERT INTO profiles(id,empresa_id) VALUES('${order}','${tenant}')`);
 const fields=JSON.stringify({provider_tax_id:"80000000-1",invoice_number:"001",invoice_date:null,total:110,product_description:"Cemento",items:[{description:"Cemento"}]});
 for(let n=0;n<2;n++)await db.query("SELECT register_invoice_identity($1,$2,$3,$4,$5::jsonb,$6)",[invoice,attachment,"a".repeat(64),"80000000-1",fields,order]);
 expect((await db.query("SELECT verified_by FROM invoice_identity_evidence")).rows).toEqual([{verified_by:order}]);
 await db.exec("SET ROLE service_role");
 await expect(db.exec("INSERT INTO invoice_identity_evidence(invoice_id) SELECT NULL")).rejects.toThrow(/permission denied/);
 await db.exec("RESET ROLE");
});
it("legacy unverified OP cannot execute or change invoice/payment status",async()=>{
 await db.exec(`ALTER TABLE invoices DISABLE TRIGGER zzzz_invoice_verified_status;UPDATE invoices SET status='APTO_PARA_PAGO';ALTER TABLE invoices ENABLE TRIGGER zzzz_invoice_verified_status;
 INSERT INTO payment_orders(id,empresa_id,provider_id,status,code) VALUES('${job}','${tenant}','${provider}','EMITIDA','OP-TEST');
 ALTER TABLE payment_order_invoices DISABLE TRIGGER zzzz_payment_invoice_identity;
 INSERT INTO payment_order_invoices VALUES('${invoice}','${job}','${tenant}');
 ALTER TABLE payment_order_invoices ENABLE TRIGGER zzzz_payment_invoice_identity;`);
 await expect(db.query("SELECT ejecutar_orden_pago_atomica($1,$2,NULL,$3)",[tenant,job,actor])).rejects.toThrow(/sin identidad/);
 expect((await db.query("SELECT status FROM payment_orders")).rows).toEqual([{status:"EMITIDA"}]);
 expect((await db.query("SELECT status FROM invoices")).rows).toEqual([{status:"APTO_PARA_PAGO"}]);
});
it("verified OP executes once and its links cannot be removed after execution",async()=>{
 await register();await link();await db.exec(`UPDATE invoices SET status='APTO_PARA_PAGO';
 INSERT INTO payment_orders(id,empresa_id,provider_id,status,code) VALUES('${job}','${tenant}','${provider}','EMITIDA','OP-TEST');
 INSERT INTO payment_order_invoices VALUES('${invoice}','${job}','${tenant}');`);
 await db.query("SELECT ejecutar_orden_pago_atomica($1,$2,NULL,$3)",[tenant,job,actor]);
 expect((await db.query("SELECT status FROM invoices")).rows).toEqual([{status:"PAGADO"}]);
 expect((await db.query("SELECT status FROM payment_orders")).rows).toEqual([{status:"EJECUTADA"}]);
 await expect(db.exec("DELETE FROM payment_order_invoices")).rejects.toThrow(/Solo se modifican/);
 await expect(db.query("SELECT ejecutar_orden_pago_atomica($1,$2,NULL,$3)",[tenant,job,actor])).rejects.toThrow(/ya fue ejecutada/);
});

it("#3 rejects a payment that would leave its treasury account negative",async()=>{
 await register();await link();await db.exec(`UPDATE invoices SET status='APTO_PARA_PAGO';
 INSERT INTO payment_orders(id,empresa_id,provider_id,status,code) VALUES('${job}','${tenant}','${provider}','EMITIDA','OP-TEST');
 INSERT INTO payment_order_invoices VALUES('${invoice}','${job}','${tenant}');
 UPDATE cuentas_financieras SET saldo=100 WHERE id='${account}';`);
 await expect(db.query("SELECT ejecutar_orden_pago_atomica($1,$2,$3,$4)",[tenant,job,account,actor]))
   .rejects.toThrow(/Saldo insuficiente/);
 expect((await db.query("SELECT status FROM payment_orders WHERE id=$1",[job])).rows).toEqual([{status:"EMITIDA"}]);
 expect((await db.query("SELECT status FROM invoices WHERE id=$1",[invoice])).rows).toEqual([{status:"APTO_PARA_PAGO"}]);
 expect((await db.query("SELECT saldo FROM cuentas_financieras WHERE id=$1",[account])).rows).toEqual([{saldo:"100"}]);
});
