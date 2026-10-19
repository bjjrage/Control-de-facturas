import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

const oldKey = readFileSync("supabase/migrations/20261003133854_inventory_opening_identity.sql", "utf8")
  .match(/CREATE FUNCTION private\.inventory_opening_key[\s\S]*?\$\$;/)![0];
const oldGuard = readFileSync("supabase/migrations/20261003134723_inventory_confirmed_opening_guard.sql", "utf8")
  .match(/CREATE OR REPLACE FUNCTION private\.inventory_opening_guard[\s\S]*?END \$\$;/)![0];
const tenant = "11111111-1111-4111-8111-111111111111";
const product = "22222222-2222-4222-8222-222222222222";
const location = "33333333-3333-4333-8333-333333333333";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA private; CREATE SCHEMA extensions;
    CREATE TYPE public.currency_code AS ENUM ('PYG','USD');
    CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE
      AS $$ SELECT decode(md5($1),'hex') $$;
    CREATE TABLE public.inventory_movements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, producto_id uuid,
      to_location_id uuid, from_location_id uuid, cost_currency public.currency_code,
      status text, metadata jsonb, movement_type text, source_type text, quantity numeric
    );
  `);
  await db.exec(oldKey);
  await db.exec(oldGuard);
  await db.exec(`CREATE TRIGGER inventory_opening_guard AFTER INSERT ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION private.inventory_opening_guard()`);
  if (!process.env.OPENING_STOCK_BASELINE) await db.exec(readFileSync("supabase/migrations/20261018120900_opening_stock_once_per_location.sql", "utf8"));
}, 120000);
afterAll(async () => { await db?.close(); });

it("#16 rejects a second confirmed opening for the same product/location/currency on another date", async () => {
  const insert = (date: string) => db.query(`INSERT INTO public.inventory_movements
    (empresa_id,producto_id,to_location_id,cost_currency,status,metadata,movement_type,source_type,quantity)
    VALUES ($1,$2,$3,'PYG','CONFIRMED',$4::jsonb,'ADJUSTMENT','MANUAL',5)`,
    [tenant, product, location, JSON.stringify({ reason_type: "INITIAL_STOCK", effective_date: date })]);
  await insert("2026-10-01");
  await expect(insert("2026-10-02")).rejects.toThrow(/Opening count already exists/);
  expect((await db.query<{ n: number }>("SELECT count(*)::int n FROM public.inventory_movements")).rows[0].n).toBe(1);
});
