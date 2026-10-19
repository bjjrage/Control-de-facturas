import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../../supabase/migrations/20261018120100_guard_project_cost_price_tenant.sql", import.meta.url), "utf8");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA private;
    CREATE TABLE public.projects(id uuid PRIMARY KEY, empresa_id uuid NOT NULL);
    CREATE TABLE public.productos(id uuid PRIMARY KEY, empresa_id uuid NOT NULL);
    CREATE TABLE public.project_cost_prices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL,
      project_id uuid NOT NULL, producto_id uuid NOT NULL, precio_unitario numeric NOT NULL
    );
    INSERT INTO public.projects VALUES
      ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    INSERT INTO public.productos VALUES
      ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      ('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  `);
  await db.exec(migration);
}, 120000);
afterAll(async () => { await db?.close(); });

describe("#24 project cost price tenant integrity", () => {
  it("rejects a foreign product even when the price row claims the current tenant", async () => {
    await expect(db.exec(`INSERT INTO public.project_cost_prices
      (empresa_id,project_id,producto_id,precio_unitario) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222',77)`))
      .rejects.toThrow(/empresa/);
    await db.exec(`INSERT INTO public.project_cost_prices
      (empresa_id,project_id,producto_id,precio_unitario) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '11111111-1111-4111-8111-111111111111',
       '33333333-3333-4333-8333-333333333333',77)`);
    expect((await db.query("SELECT id FROM public.project_cost_prices")).rows).toHaveLength(1);
  });
});
