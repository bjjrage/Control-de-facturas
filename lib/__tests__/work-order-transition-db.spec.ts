import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { allowedWorkOrderTransitions } from "../quotation";

const tenant = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const otherActor = "33333333-3333-4333-8333-333333333333";
const order = "44444444-4444-4444-8444-444444444444";
const quote = "55555555-5555-4555-8555-555555555555";
const migration = readFileSync(new URL("../../supabase/migrations/20261017194900_work_order_transition_guards.sql", import.meta.url), "utf8");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE TYPE public.user_role AS ENUM ('admin','administracion','comercial');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
    CREATE TABLE public.profiles(id uuid, empresa_id uuid, active boolean, role public.user_role);
    CREATE TABLE public.work_orders(
      id uuid PRIMARY KEY, empresa_id uuid, sales_document_id uuid,
      status text, workflow_status text, approval_mode text,
      responsible_role public.user_role, routing_policy_id uuid,
      approved_by uuid, approved_at timestamptz
    );
    CREATE TABLE public.sales_documents(id uuid, empresa_id uuid, source_document_id uuid, status text);
  `);
  await db.exec(migration);
}, 120000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`
    TRUNCATE public.work_orders, public.profiles, public.sales_documents;
    SELECT set_config('test.actor', '${actor}', false);
    INSERT INTO public.profiles VALUES
      ('${actor}','${tenant}',true,'administracion'),
      ('${otherActor}','${tenant}',true,'comercial');
    INSERT INTO public.work_orders VALUES
      ('${order}','${tenant}','${quote}','PENDIENTE','PENDING_INTERNAL_APPROVAL',
       'RESPONSIBLE_APPROVAL','administracion',null,null,null);
  `);
});

describe("work order transitions", () => {
  it("requires approval before starting, then moves forward without reopening terminal states", async () => {
    expect(allowedWorkOrderTransitions("PENDIENTE", "PENDING_INTERNAL_APPROVAL")).toEqual(["CANCELADA"]);
    await expect(db.exec(`UPDATE public.work_orders SET status='EN_CURSO' WHERE id='${order}'`)).rejects.toThrow(/pendiente de aprobación/);
    await db.exec(`UPDATE public.work_orders SET workflow_status='READY_FOR_PRODUCTION',
      approved_by='${actor}',approved_at=now() WHERE id='${order}'`);
    await db.exec(`UPDATE public.work_orders SET status='EN_CURSO' WHERE id='${order}'`);
    await db.exec(`UPDATE public.work_orders SET status='COMPLETADA' WHERE id='${order}'`);
    await expect(db.exec(`UPDATE public.work_orders SET status='EN_CURSO' WHERE id='${order}'`)).rejects.toThrow(/Transición de estado/);
    expect(allowedWorkOrderTransitions("COMPLETADA", "READY_FOR_PRODUCTION")).toEqual([]);
  });

  it("rejects forged approval and role changes", async () => {
    await expect(db.exec(`UPDATE public.work_orders SET workflow_status='READY_FOR_PRODUCTION' WHERE id='${order}'`)).rejects.toThrow(/responsable autorizado/);
    await expect(db.exec(`UPDATE public.work_orders SET workflow_status='READY_FOR_PRODUCTION',
      responsible_role='comercial',approved_by='${actor}',approved_at=now() WHERE id='${order}'`)).rejects.toThrow(/responsable autorizado/);
    await db.exec(`SELECT set_config('test.actor','${otherActor}',false)`);
    await expect(db.exec(`UPDATE public.work_orders SET workflow_status='READY_FOR_PRODUCTION',
      approved_by='${otherActor}',approved_at=now() WHERE id='${order}'`)).rejects.toThrow(/rol responsable/);
  });

  it("blocks cancellation while derived sales documents remain active", async () => {
    await db.exec(`INSERT INTO public.sales_documents VALUES(gen_random_uuid(),'${tenant}','${quote}','EMITIDA')`);
    await expect(db.exec(`UPDATE public.work_orders SET status='CANCELADA' WHERE id='${order}'`)).rejects.toThrow(/documentos derivados activos/);
    await db.exec("UPDATE public.sales_documents SET status='ANULADA'");
    await db.exec(`UPDATE public.work_orders SET status='CANCELADA' WHERE id='${order}'`);
  });

  it("keeps direct routing available only during unauthenticated quotation acceptance", async () => {
    await expect(db.exec(`UPDATE public.work_orders SET approval_mode='DIRECT_TO_PRODUCTION',
      workflow_status='READY_FOR_PRODUCTION' WHERE id='${order}'`)).rejects.toThrow(/pase directo/);
    await db.exec("SELECT set_config('test.actor','',false)");
    await db.exec(`UPDATE public.work_orders SET approval_mode='DIRECT_TO_PRODUCTION',
      workflow_status='READY_FOR_PRODUCTION' WHERE id='${order}'`);
    const result = await db.query<{ workflow_status: string }>(`SELECT workflow_status FROM public.work_orders WHERE id='${order}'`);
    expect(result.rows[0].workflow_status).toBe("READY_FOR_PRODUCTION");
  });
});
