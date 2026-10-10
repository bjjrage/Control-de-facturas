import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
const host = new URL(databaseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error(`Refusing non-loopback PostgreSQL target: ${host}`);
}

async function main() {
const client = new Client({ connectionString: databaseUrl });
const companyId = randomUUID();
const userId = randomUUID();
const providerId = randomUUID();
const orderId = randomUUID();
const itemIds = Array.from({ length: 9 }, () => randomUUID());
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010040050_reject_source_numeric_rounding.sql"), "utf8");

await client.connect();
try {
  await client.query("BEGIN");
  try {
    // Reconstruct the schema at the point immediately before the source-
    // numeric migration, entirely inside the disposable loopback database.
    await client.query(`
      ALTER TABLE public.invoice_items
        DROP CONSTRAINT IF EXISTS r3_invoice_items_quantity_precision_check,
        DROP CONSTRAINT IF EXISTS r3_invoice_items_unit_price_precision_check,
        DROP CONSTRAINT IF EXISTS r3_invoice_items_subtotal_precision_check;
      ALTER TABLE public.authorized_order_items
        DROP CONSTRAINT IF EXISTS r3_aoi_quantity_precision_check,
        DROP CONSTRAINT IF EXISTS r3_aoi_unit_price_precision_check,
        DROP CONSTRAINT IF EXISTS r3_aoi_total_price_precision_check,
        DROP CONSTRAINT IF EXISTS r3_aoi_quantity_invoiced_precision_check;
      ALTER TABLE public.invoice_item_matches
        DROP CONSTRAINT IF EXISTS r3_invoice_item_matches_quantity_precision_check;
      ALTER TABLE public.invoice_jobs
        DROP CONSTRAINT IF EXISTS r3_invoice_jobs_attempts_nonnegative;
      DROP TRIGGER IF EXISTS r3_invoice_job_fencing ON public.invoice_jobs;
    `);
    await client.query(`
      CREATE TEMP TABLE _r3_test_trigger_backup (
        relid oid NOT NULL, trigger_name name NOT NULL, trigger_def text NOT NULL, enabled "char" NOT NULL
      ) ON COMMIT DROP;
      INSERT INTO _r3_test_trigger_backup(relid,trigger_name,trigger_def,enabled)
      SELECT t.tgrelid,t.tgname,pg_catalog.pg_get_triggerdef(t.oid),t.tgenabled
      FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid IN ('public.invoice_items'::regclass,'public.authorized_order_items'::regclass,'public.invoice_item_matches'::regclass)
        AND NOT t.tgisinternal AND t.tgattr::text <> '';
      DO $drop_column_triggers$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT relid,trigger_name FROM _r3_test_trigger_backup LOOP
          EXECUTE pg_catalog.format('DROP TRIGGER %I ON %s',r.trigger_name,r.relid::regclass);
        END LOOP;
      END;
      $drop_column_triggers$;
    `);
    await client.query(`
      ALTER TABLE public.invoice_items
        ALTER COLUMN quantity TYPE numeric(14,2) USING quantity::numeric(14,2),
        ALTER COLUMN unit_price TYPE numeric(14,4) USING unit_price::numeric(14,4),
        ALTER COLUMN subtotal TYPE numeric(14,2) USING subtotal::numeric(14,2);
      ALTER TABLE public.authorized_order_items
        ALTER COLUMN quantity TYPE numeric(18,4) USING quantity::numeric(18,4),
        ALTER COLUMN unit_price TYPE numeric(14,4) USING unit_price::numeric(14,4),
        ALTER COLUMN total_price TYPE numeric(14,2) USING total_price::numeric(14,2),
        ALTER COLUMN quantity_invoiced TYPE numeric(14,2) USING quantity_invoiced::numeric(14,2);
      ALTER TABLE public.invoice_item_matches
        ALTER COLUMN quantity_matched TYPE numeric(14,2) USING quantity_matched::numeric(14,2);
    `);
    await client.query(`
      DO $restore_column_triggers$
      DECLARE r record; v_enable_sql text;
      BEGIN
        FOR r IN SELECT relid,trigger_name,trigger_def,enabled
                 FROM _r3_test_trigger_backup ORDER BY relid,trigger_name LOOP
          EXECUTE r.trigger_def;
          v_enable_sql := CASE r.enabled WHEN 'D' THEN 'DISABLE' WHEN 'R' THEN 'ENABLE REPLICA'
                            WHEN 'A' THEN 'ENABLE ALWAYS' ELSE NULL END;
          IF v_enable_sql IS NOT NULL THEN
            EXECUTE pg_catalog.format('ALTER TABLE %s %s TRIGGER %I',r.relid::regclass,v_enable_sql,r.trigger_name);
          END IF;
        END LOOP;
      END;
      $restore_column_triggers$;
    `);
    await client.query(
      "INSERT INTO public.empresas(id,nombre,slug) VALUES($1,'R3 migration preflight',$2)",
      [companyId, `r3-preflight-${companyId}`],
    );
    await client.query(
      `INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
       VALUES($1,'authenticated','authenticated',$2,now(),'{}'::jsonb,'{}'::jsonb)`,
      [userId, `${userId}@r3-preflight.test`],
    );
    await client.query(
      "INSERT INTO public.profiles(id,email,full_name,role,empresa_id) VALUES($1,$2,'R3 preflight','admin',$3)",
      [userId, `${userId}@r3-preflight.test`, companyId],
    );
    await client.query("INSERT INTO public.providers(id,empresa_id,name) VALUES($1,$2,'R3 preflight')", [providerId, companyId]);
    await client.query(
      `INSERT INTO public.authorized_orders
         (id,provider_id,code,provider_name,product,quantity,unit,unit_price,total_price,currency,vat_included,authorized_by,is_cheapest,empresa_id,created_from)
       VALUES($1,$2,'R3-PREFLIGHT','R3 preflight','Legacy quantity',540,'un',1,540,'PYG',false,$3,true,$4,'invoice')`,
      [orderId, providerId, userId, companyId],
    );
    for (const id of itemIds) {
      await client.query(
        `INSERT INTO public.authorized_order_items
           (id,order_id,empresa_id,product,quantity,unit,unit_price,total_price,quantity_invoiced)
         VALUES($1,$2,$3,'Legacy trailing zeroes',60.0000,'un',1.0000,60.00,0.00)`,
        [id, orderId, companyId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  const before = await client.query(
    "SELECT id,to_jsonb(oi)::text AS row,quantity::text,quantity_invoiced::text FROM public.authorized_order_items oi WHERE id=ANY($1::uuid[]) ORDER BY id",
    [itemIds],
  );
  assert.equal(before.rowCount, 9);
  assert.ok(before.rows.every((row) => row.quantity === "60.0000" && row.quantity_invoiced === "0.00"));
  const triggersBefore = await client.query(`
    SELECT tgrelid::regclass::text AS relation,tgname,pg_catalog.pg_get_triggerdef(oid) AS definition,tgenabled AS enabled
    FROM pg_catalog.pg_trigger WHERE tgrelid IN
      ('public.invoice_items'::regclass,'public.authorized_order_items'::regclass,'public.invoice_item_matches'::regclass)
      AND NOT tgisinternal ORDER BY relation,tgname
  `);

  await client.query(migration);

  const after = await client.query(
    "SELECT id,to_jsonb(oi)::text AS row,quantity::text,quantity_invoiced::text FROM public.authorized_order_items oi WHERE id=ANY($1::uuid[]) ORDER BY id",
    [itemIds],
  );
  assert.deepEqual(after.rows, before.rows, "migration must preserve every seeded historical row and its numeric display scales");
  const counters = await client.query(
    "SELECT count(*)::int AS count,bool_and(quantity::text='60.0000') AS quantity_exact,bool_and(quantity_invoiced::text='0.00') AS counter_exact FROM public.authorized_order_items WHERE id=ANY($1::uuid[])",
    [itemIds],
  );
  assert.deepEqual(counters.rows[0], { count: 9, quantity_exact: true, counter_exact: true });
  const triggersAfter = await client.query(`
    SELECT tgrelid::regclass::text AS relation,tgname,pg_catalog.pg_get_triggerdef(oid) AS definition,tgenabled AS enabled
    FROM pg_catalog.pg_trigger WHERE tgrelid IN
      ('public.invoice_items'::regclass,'public.authorized_order_items'::regclass,'public.invoice_item_matches'::regclass)
      AND NOT tgisinternal ORDER BY relation,tgname
  `);
  assert.deepEqual(triggersAfter.rows, triggersBefore.rows, "source triggers and enabled modes must survive the migration");
  await client.query("DELETE FROM public.authorized_order_items WHERE id=ANY($1::uuid[])", [itemIds]);
  await client.query("DELETE FROM public.authorized_orders WHERE id=$1", [orderId]);
  await client.query("DELETE FROM public.providers WHERE id=$1", [providerId]);
  await client.query("DELETE FROM public.profiles WHERE id=$1", [userId]);
  await client.query("DELETE FROM auth.users WHERE id=$1", [userId]);
  await client.query("DELETE FROM public.empresas WHERE id=$1", [companyId]);
  console.log(JSON.stringify({
    postgres: (await client.query("SHOW server_version")).rows[0].server_version,
    migration: "20261010040050_reject_source_numeric_rounding.sql",
    historicalRows: 9,
    unchanged: true,
    sourceTriggersPreserved: triggersAfter.rowCount,
  }, null, 2));
} finally {
  await client.end();
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
