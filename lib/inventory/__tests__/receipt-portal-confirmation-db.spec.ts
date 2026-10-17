import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const baseline = read("supabase/migrations/20261002231537_production_schema_baseline.sql");
const canonical = read("supabase/migrations/20261003133414_inventory_canonical_boundaries.sql");
const context = read("supabase/migrations/20261003135743_inventory_receipt_product_context.sql");
const proposal = read("supabase/migrations/20261015015138_receipt_portal_confirm_stock.sql");
function original(source: string, name: string, schema = "public") {
  const match = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION (?:${schema}\\.${name}|"${schema}"\\."${name}")\\(`).exec(source);
  if (!match) throw new Error("Missing real function " + name);
  const tail = source.slice(match.index);
  const body = /\bAS (\$[\w]*\$)/.exec(tail);
  if (!body) throw new Error("Missing body " + name);
  const end = tail.indexOf(body[1] + ";", body.index + body[0].length);
  return tail.slice(0, end + body[1].length + 1);
}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tokenHash = "a".repeat(64);
const path = `receipt-portals/${id(7)}/remito.pdf`;
let db: PGlite;
const lines = [{ order_item_id: id(5), quantity: 5, notes: null }];
const evidence = [{ storage_bucket: "warehouse-evidence", storage_path: path, file_name: "remito.pdf", mime_type: "application/pdf", size_bytes: 100, sha256: "b".repeat(64) }];
const submit = (items = lines, files = evidence, hash = tokenHash) => db.query<{ receipt_id: string }>(
  "select public.submit_receipt_portal($1,'2026-10-14','Depositero QA','REM-QA',NULL,$2::jsonb,$3::jsonb) receipt_id",
  [hash, JSON.stringify(items), JSON.stringify(files)],
);
async function state() {
  return (await db.query("select (select count(*)::int from oc_recepciones) receipts, (select count(*)::int from inventory_movements) movements, (select coalesce(sum(quantity),0)::float8 from inventory_balances) stock, (select active from receipt_portal_links) active")).rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA storage;
    CREATE TYPE public.user_role AS ENUM ('admin','administracion','comercial');
    CREATE TYPE public.currency_code AS ENUM ('PYG','USD');
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('qa.role',true),''),'service_role')$$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('role',auth.role())$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('qa.actor',true),'')::uuid$$;
    CREATE FUNCTION public.current_empresa_id() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('qa.empresa',true),'')::uuid$$;
    CREATE TABLE empresas(id uuid primary key,active boolean);
    CREATE TABLE profiles(id uuid primary key,empresa_id uuid,role user_role,active boolean);
    CREATE TABLE projects(id uuid primary key,empresa_id uuid);
    CREATE TABLE budget_items(id uuid,project_id uuid);
    CREATE TABLE productos(id uuid primary key,empresa_id uuid,nombre text,unidad text,activo boolean,stock_actual numeric default 0,updated_at timestamptz);
    CREATE TABLE authorized_orders(id uuid primary key,empresa_id uuid,project_id uuid,currency currency_code);
    CREATE TABLE authorized_order_items(id uuid primary key,empresa_id uuid,order_id uuid,producto_id uuid,product text,unit text,quantity numeric,unit_price numeric);
    CREATE TABLE inventory_locations(id uuid primary key,empresa_id uuid,project_id uuid,location_type text,active boolean,is_primary boolean default true,created_at timestamptz default now());
    CREATE TABLE receipt_portal_links(id uuid primary key,empresa_id uuid,order_id uuid,location_id uuid,token_hash text unique,created_by uuid,active boolean,expires_at timestamptz,last_used_at timestamptz);
    CREATE TABLE oc_recepciones(id uuid primary key default gen_random_uuid(),empresa_id uuid,order_id uuid,fecha date,recibido_por text,notas text,delivery_location_id uuid,remision_number text,idempotency_key text,status text,created_by uuid,confirmed_by uuid,confirmed_at timestamptz,updated_at timestamptz,unique(empresa_id,idempotency_key));
    CREATE TABLE oc_recepcion_items(id uuid primary key default gen_random_uuid(),empresa_id uuid,recepcion_id uuid references oc_recepciones(id),order_item_id uuid,producto_id uuid,cantidad_recibida numeric,notas text,inventory_movement_id uuid);
    CREATE TABLE inventory_receipt_evidence(id uuid default gen_random_uuid(),empresa_id uuid,receipt_id uuid,storage_bucket text,storage_path text,file_name text,mime_type text,size_bytes bigint,sha256 text,uploaded_by uuid);
    CREATE TABLE storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    CREATE TABLE inventory_movements(id uuid primary key default gen_random_uuid(),empresa_id uuid,producto_id uuid,quantity numeric,unit text,movement_type text,from_location_id uuid,to_location_id uuid,project_id uuid,budget_item_id uuid,source_type text,source_id uuid,source_line_id uuid,idempotency_key text,status text,cost_status text,created_by uuid,confirmed_by uuid,confirmed_at timestamptz,metadata jsonb,cost_currency currency_code,unit_cost numeric,cost_total numeric,exchange_rate_to_company numeric,cost_total_company numeric,unique(empresa_id,idempotency_key));
    CREATE TABLE inventory_movement_costs(empresa_id uuid,movement_id uuid,quantity numeric,cost_currency currency_code,unit_cost numeric,total_cost numeric,cost_status text,exchange_rate_to_company numeric,total_cost_company numeric);
    CREATE TABLE inventory_balances(id uuid primary key default gen_random_uuid(),empresa_id uuid,producto_id uuid,location_id uuid,cost_currency currency_code,quantity numeric,total_cost numeric,total_cost_company numeric,cost_status text,original_cost_currency text,original_unit_cost numeric,original_total_cost numeric,exchange_rate_to_company numeric,cost_source text,updated_at timestamptz,unique(empresa_id,producto_id,location_id,cost_currency));
    CREATE UNIQUE INDEX balance_review ON inventory_balances(empresa_id,producto_id,location_id) WHERE cost_currency IS NULL;
    CREATE FUNCTION public.is_internal_role(roles user_role[]) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND active AND role=ANY(roles))$$;
  `);
  for (const name of ["upsert_inventory_balance", "sync_inventory_legacy_projection", "inventory_post_movement"]) await db.exec(original(baseline, name));
  for (const name of ["inventory_create_receipt", "inventory_confirm_receipt", "enforce_confirmed_canonical_oc_receipt_movement", "enforce_oc_receipt_line_immutability"]) await db.exec(original(canonical, name));
  for (const name of ["inventory_receipt_actor_guard", "inventory_receipt_context_guard"]) await db.exec(original(context, name, "private"));
  await db.exec(`
    CREATE TRIGGER receipt_actor BEFORE INSERT OR UPDATE ON oc_recepciones FOR EACH ROW EXECUTE FUNCTION private.inventory_receipt_actor_guard();
    CREATE TRIGGER receipt_context BEFORE INSERT OR UPDATE ON oc_recepcion_items FOR EACH ROW EXECUTE FUNCTION private.inventory_receipt_context_guard();
    CREATE TRIGGER movement_context BEFORE INSERT OR UPDATE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION enforce_confirmed_canonical_oc_receipt_movement();
    CREATE TRIGGER receipt_immutable BEFORE INSERT OR UPDATE OR DELETE ON oc_recepcion_items FOR EACH ROW EXECUTE FUNCTION enforce_oc_receipt_line_immutability();
  `);
  await db.exec(proposal);
}, 30000);
beforeEach(async () => {
  await db.exec(`TRUNCATE oc_recepcion_items,oc_recepciones,inventory_receipt_evidence,inventory_movement_costs,inventory_movements,inventory_balances,receipt_portal_links,authorized_order_items,authorized_orders,inventory_locations,productos,projects,profiles,empresas,storage.objects;
    INSERT INTO empresas VALUES('${id(1)}',true);
    INSERT INTO profiles VALUES('${id(2)}','${id(1)}','admin',true);
    INSERT INTO projects VALUES('${id(3)}','${id(1)}');
    INSERT INTO productos(id,empresa_id,nombre,unidad,activo) VALUES('${id(4)}','${id(1)}','Cemento','bolsa',true);
    INSERT INTO authorized_orders VALUES('${id(6)}','${id(1)}','${id(3)}','PYG');
    INSERT INTO authorized_order_items VALUES('${id(5)}','${id(1)}','${id(6)}','${id(4)}','Cemento','bolsa',100,10000);
    INSERT INTO inventory_locations(id,empresa_id,project_id,location_type,active) VALUES('${id(8)}','${id(1)}','${id(3)}','PROJECT',true);
    INSERT INTO receipt_portal_links VALUES('${id(7)}','${id(1)}','${id(6)}','${id(8)}','${tokenHash}','${id(2)}',true,now()+interval '7 days',NULL);
    INSERT INTO storage.objects VALUES('warehouse-evidence','${path}');
    SELECT set_config('qa.role','service_role',false),set_config('qa.actor','',false),set_config('qa.empresa','',false);
  `);
});
afterAll(async () => { await db.close(); });

describe("receiver link confirms canonical worksite stock atomically", () => {
  it("posts one confirmed receipt, movement and cost to the exact worksite without an administrative confirmer", async () => {
    const receipt = (await submit()).rows[0];
    expect(await state()).toEqual({ receipts: 1, movements: 1, stock: 5, active: false });
    expect((await db.query("select status,confirmed_by,recibido_por,created_by from oc_recepciones where id=$1", [receipt.receipt_id])).rows[0]).toEqual({ status: "CONFIRMED", confirmed_by: null, recibido_por: "Depositero QA", created_by: id(2) });
    expect((await db.query("select project_id,to_location_id,metadata->>'confirmation_source' source,metadata->>'received_by' receiver,confirmed_by,cost_total::float8 from inventory_movements")).rows[0]).toEqual({ project_id: id(3), to_location_id: id(8), source: "RECEIPT_PORTAL", receiver: "Depositero QA", confirmed_by: null, cost_total: 50000 });
    expect((await db.query("select count(*)::int n from inventory_receipt_evidence")).rows[0]).toEqual({ n: 1 });
  });
  it("consumes the link once and never duplicates stock on replay", async () => {
    await submit();
    await expect(submit()).rejects.toThrow(/Enlace/);
    expect(await state()).toEqual({ receipts: 1, movements: 1, stock: 5, active: false });
  });
  it("accepts successive partial deliveries through new links and accumulates their stock once", async () => {
    await submit();
    await db.exec(`INSERT INTO receipt_portal_links SELECT '${id(11)}',empresa_id,order_id,location_id,'${"c".repeat(64)}',created_by,true,now()+interval '7 days',NULL FROM receipt_portal_links;
      INSERT INTO storage.objects VALUES('warehouse-evidence','receipt-portals/${id(11)}/remito.pdf');`);
    await submit([{ ...lines[0], quantity: 20 }], [{ ...evidence[0], storage_path: `receipt-portals/${id(11)}/remito.pdf` }], "c".repeat(64));
    expect((await db.query("select (select count(*)::int from oc_recepciones where status='CONFIRMED') receipts,(select sum(quantity)::float8 from inventory_balances) stock,(select sum(cantidad_recibida)::float8 from oc_recepcion_items) received")).rows[0]).toEqual({ receipts: 2, stock: 25, received: 25 });
  });
  it.each([
    "UPDATE receipt_portal_links SET active=false",
    "UPDATE receipt_portal_links SET expires_at=now()-interval '1 second'",
    `UPDATE receipt_portal_links SET empresa_id='${id(99)}'`,
    `UPDATE inventory_locations SET project_id='${id(99)}'`,
    "UPDATE inventory_locations SET active=false",
    "UPDATE profiles SET active=false",
    "UPDATE empresas SET active=false",
    "UPDATE profiles SET role='comercial'",
  ])("rejects invalid delegation/context without receipt or stock: %s", async mutation => {
    await db.exec(mutation);
    await expect(submit()).rejects.toThrow();
    expect(await state()).toMatchObject({ receipts: 0, movements: 0, stock: 0 });
  });
  it("rejects over-receipt, foreign OC lines and duplicate lines without consuming the link", async () => {
    for (const items of [[{ ...lines[0], quantity: 101 }], [{ ...lines[0], order_item_id: id(99) }], [...lines, ...lines]]) await expect(submit(items)).rejects.toThrow();
    expect(await state()).toEqual({ receipts: 0, movements: 0, stock: 0, active: true });
  });
  it("requires stored evidence and rolls back the whole submission when evidence is missing", async () => {
    await expect(submit(lines, [])).rejects.toThrow();
    await db.exec("DELETE FROM storage.objects");
    await expect(submit()).rejects.toThrow(/evidencia/);
    expect(await state()).toEqual({ receipts: 0, movements: 0, stock: 0, active: true });
  });
  it("never silently confirms an unmapped material, but supports an unambiguous historical OC match", async () => {
    await db.exec("UPDATE authorized_order_items SET producto_id=NULL; UPDATE productos SET nombre='Otro'");
    await expect(submit()).rejects.toThrow(/sin vincular/);
    expect(await state()).toEqual({ receipts: 0, movements: 0, stock: 0, active: true });
    await db.exec("UPDATE productos SET nombre='Cemento'");
    await submit();
    expect(await state()).toMatchObject({ stock: 5, movements: 1 });
  });
  it("rejects ambiguous material matches and evidence belonging to another link", async () => {
    await expect(submit(lines, [{ ...evidence[0], storage_path: `receipt-portals/${id(99)}/remito.pdf` }])).rejects.toThrow(/Evidencia/);
    await db.exec(`UPDATE authorized_order_items SET producto_id=NULL; INSERT INTO productos(id,empresa_id,nombre,unidad,activo) VALUES('${id(20)}','${id(1)}','Cemento','bolsa',true);`);
    await expect(submit()).rejects.toThrow(/sin vincular/);
    expect(await state()).toEqual({ receipts: 0, movements: 0, stock: 0, active: true });
  });
  it("preserves the existing explicit internal confirmation path", async () => {
    const created = await db.query<{ r: { receipt_id: string } }>("select inventory_create_receipt($1,$2,'2026-10-14','Encargado',$3,NULL,'manual',$4,NULL,$5::jsonb) r", [id(1),id(6),id(8),id(2),JSON.stringify([{ order_item_id: id(5),producto_id:id(4),cantidad_recibida:2 }])]);
    await db.query("select inventory_confirm_receipt($1,$2,$3,'manual',$4)",[id(1),created.rows[0].r.receipt_id,id(8),id(2)]);
    expect((await db.query("select status,confirmed_by from oc_recepciones")).rows[0]).toEqual({ status: "CONFIRMED", confirmed_by: id(2) });
    expect(await state()).toMatchObject({ stock: 2, movements: 1 });
  });
  it("rolls back receipt/evidence/token if canonical stock posting fails", async () => {
    await db.exec("UPDATE authorized_order_items SET unit_price=-1");
    await expect(submit()).rejects.toThrow();
    expect(await state()).toEqual({ receipts: 0, movements: 0, stock: 0, active: true });
    expect((await db.query("select count(*)::int n from inventory_receipt_evidence")).rows[0]).toEqual({ n: 0 });
  });
  it("does not expose token submission to anon/authenticated and denies an unscoped null confirmer", async () => {
    expect((await db.query("select has_function_privilege('anon','submit_receipt_portal(text,date,text,text,text,jsonb,jsonb)','execute') a,has_function_privilege('authenticated','submit_receipt_portal(text,date,text,text,text,jsonb,jsonb)','execute') b")).rows[0]).toEqual({ a: false, b: false });
    await db.exec("SELECT set_config('qa.role','authenticated',false)");
    await expect(submit()).rejects.toThrow(/Acceso/);
    await db.exec("SELECT set_config('qa.role','service_role',false)");
    const created = await db.query<{ r: { receipt_id: string } }>("select inventory_create_receipt($1,$2,'2026-10-14','QA',$3,NULL,'manual',$4,NULL,$5::jsonb) r", [id(1),id(6),id(8),id(2),JSON.stringify([{ order_item_id: id(5),producto_id:id(4),cantidad_recibida:1 }])]);
    await expect(db.query("select inventory_confirm_receipt($1,$2,$3,'manual',NULL)",[id(1),created.rows[0].r.receipt_id,id(8)])).rejects.toThrow(/scoped/);
    expect(await state()).toMatchObject({ stock: 0, movements: 0 });
  });
});
