import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924090000_mrp_reservation_balance_guard.sql"),
  "utf8"
);

describe("MRP active reservations protect canonical physical balances", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE TABLE public.projects (id uuid PRIMARY KEY, empresa_id uuid NOT NULL);
      CREATE TABLE public.inventory_locations (id uuid PRIMARY KEY, empresa_id uuid NOT NULL);
      CREATE TABLE public.project_weekly_plans (
        id uuid PRIMARY KEY, empresa_id uuid NOT NULL, project_id uuid NOT NULL
      );
      CREATE TABLE public.productos (id uuid PRIMARY KEY, empresa_id uuid NOT NULL);
      CREATE TABLE public.inventory_balances (
        id uuid PRIMARY KEY, empresa_id uuid NOT NULL, location_id uuid NOT NULL,
        producto_id uuid NOT NULL, cost_currency text NOT NULL, quantity numeric NOT NULL
      );
      CREATE TABLE public.inventory_reservations (
        id uuid PRIMARY KEY, empresa_id uuid NOT NULL, location_id uuid NOT NULL,
        producto_id uuid NOT NULL, project_id uuid NOT NULL, weekly_plan_id uuid,
        quantity numeric NOT NULL, status text NOT NULL, needed_by_date date,
        idempotency_key text, created_by uuid, released_at timestamptz
      );
      CREATE FUNCTION public.assert_mrp_actor(uuid, uuid) RETURNS uuid
        LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
    `);
    await db.exec(migration);
    await db.exec(`
      INSERT INTO public.projects VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010');
      INSERT INTO public.inventory_locations VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010');
      INSERT INTO public.productos VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000010');
      INSERT INTO public.inventory_balances VALUES (
        '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000010',
        '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'PYG', 500
      );
      INSERT INTO public.inventory_reservations VALUES (
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000010',
        '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000001', NULL, 400, 'ACTIVE', '2026-09-30', NULL, NULL, NULL
      );
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  it("rejects an outbound physical balance change below active reservations", async () => {
    await expect(
      db.query(`UPDATE public.inventory_balances SET quantity = 99 WHERE id = '00000000-0000-0000-0000-000000000004'`)
    ).rejects.toThrow(/stock físico restante/i);

    await db.query(`UPDATE public.inventory_balances SET quantity = 400 WHERE id = '00000000-0000-0000-0000-000000000004'`);
    const { rows } = await db.query<{ quantity: number }>(
      `SELECT quantity FROM public.inventory_balances WHERE id = '00000000-0000-0000-0000-000000000004'`
    );
    expect(Number(rows[0].quantity)).toBe(400);

    await expect(
      db.query(`DELETE FROM public.inventory_balances WHERE id = '00000000-0000-0000-0000-000000000004'`)
    ).rejects.toThrow(/stock físico restante/i);
  });

  it("does not allocate already-reserved stock a second time", async () => {
    await expect(
      db.query(`
        SELECT public.reserve_plan_stock(
          '00000000-0000-0000-0000-000000000010',
          '00000000-0000-0000-0000-000000000011',
          '00000000-0000-0000-0000-000000000001',
          NULL,
          '00000000-0000-0000-0000-000000000002',
          '[{"producto_id":"00000000-0000-0000-0000-000000000003","quantity":101}]'::jsonb,
          '2026-09-30', 'attempt-b', false
        )
      `)
    ).rejects.toThrow(/stock central insuficiente/i);
  });

  it("locks physical rows before reading availability for a new reservation", () => {
    const lockRows = migration.indexOf("ORDER BY cost_currency::text\n      FOR UPDATE");
    const readPhysical = migration.indexOf("SELECT COALESCE(SUM(quantity), 0) INTO v_fisico");
    expect(lockRows).toBeGreaterThan(-1);
    expect(readPhysical).toBeGreaterThan(lockRows);
  });
});
