/**
 * Validación funcional de la migración final
 * supabase/migrations/20261010040051_invoice_item_match_integrity.sql
 * sobre PGlite (WASM, efímero). El lock/concurrency verdict viene solo de
 * scripts/test-invoice-item-match-postgres.ts contra PostgreSQL 17 real.
 *
 * ALCANCE: invariantes secuenciales (documental / OC / relacional),
 * idempotencia, aislamiento multitenant, freeze por estado, rollback ante
 * error y corrección in-place. Las RPC bajo prueba son byte-idénticas a las
 * del archivo de migración (se cargan desde el archivo; solo se filtran
 * GRANT/REVOKE/OWNER/EXTENSION y se inyectan shims mínimos: auth.uid,
 * auth.role, extensions.unaccent vía translate, gen_random_uuid vía md5).
 *
 * NO CERTIFICA: contención real de locks entre dos transacciones simultáneas
 * (PGlite es monoproceso: no puede bloquearse de verdad). La concurrencia se
 * certifica aparte con scripts/test-invoice-item-match-postgres.ts contra
 * PostgreSQL 17 real, ejecutado por el workflow Remediation 3.
 *
 * NOTA OPERATIVA: PGlite inicializa WASM; correr en modo serial
 * (npx vitest run --no-file-parallelism). Bajo paralelismo la carga WASM
 * falla de forma ambiental (misma causa que los 7 tests preexistentes H4).
 */
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const T = { timeout: 120_000 };

const A = "11111111-1111-4111-8111-111111111111"; // empresa A (tenant de prueba)
const B = "22222222-2222-4222-8222-222222222222"; // empresa B (aislamiento)
const ADMIN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMERCIAL_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ADMIN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INV = "00000000-0000-4000-8000-000000000001";
const INV_B = "00000000-0000-4000-8000-000000000002";
const OC = "00000000-0000-4000-8000-000000000003";
const OC_B = "00000000-0000-4000-8000-000000000004";
const IL1 = "00000000-0000-4000-8000-000000000005";
const OL1 = "00000000-0000-4000-8000-000000000006";
const OL_B1 = "00000000-0000-4000-8000-000000000007";
const IL2 = "00000000-0000-4000-8000-000000000008";

let db: PGlite;

async function setActor(role: string, uid: string) {
  await db.exec(`SELECT set_config('app.test_role', '${role}', false)`);
  await db.exec(`SELECT set_config('app.test_uid', '${uid}', false)`);
}

async function throwsWith(p: Promise<unknown>, needle: string) {
  try {
    await p;
  } catch (e) {
    expect(String((e as Error)?.message ?? e)).toContain(needle);
    return;
  }
  throw new Error(`se esperaba RAISE con: ${needle}`);
}

const callCreate = (empresa: string, invoice: string, line: string, orderItem: string, qty: number | null) =>
  db.query("SELECT public.create_invoice_item_match($1,$2,$3,$4,$5,$6) AS r", [empresa, invoice, OC, line, orderItem, qty]);

const callCorrect = (empresa: string, item: string, desc: string, qty: number | null, unit: string | null, price: number | null, sub: number | null) =>
  db.query("SELECT public.correct_invoice_item($1,$2,$3,$4,$5,$6,$7) AS r", [empresa, item, desc, qty, unit, price, sub]);

async function seed() {
  await db.exec(`
    INSERT INTO public.empresas (id, active) VALUES ('${A}', true), ('${B}', true);
    INSERT INTO public.profiles (id, empresa_id, role, active, is_super_admin) VALUES
      ('${ADMIN_A}', '${A}', 'admin', true, false),
      ('${COMERCIAL_A}', '${A}', 'comercial', true, false),
      ('${ADMIN_B}', '${B}', 'admin', true, false);
    INSERT INTO public.invoices (id, empresa_id, status) VALUES
      ('${INV}', '${A}', 'PENDIENTE'),
      ('${INV_B}', '${B}', 'PENDIENTE');
    INSERT INTO public.authorized_orders (id, empresa_id) VALUES ('${OC}', '${A}'), ('${OC_B}', '${A}');
    INSERT INTO public.invoice_items (id, invoice_id, empresa_id, product_description, quantity, unit) VALUES
      ('${IL1}', '${INV}', '${A}', 'Ladrillo común', 2500, 'un'),
      ('${IL2}', '${INV}', '${A}', 'Ladrillo común', 2500, 'un');
    INSERT INTO public.authorized_order_items (id, order_id, empresa_id, product, quantity, unit, quantity_invoiced) VALUES
      ('${OL1}', '${OC}', '${A}', 'Ladrillo común', 3000, 'un', 0),
      ('${OL_B1}', '${OC_B}', '${A}', 'Cemento puzolánico', 700, 'bolsa', 0);
    INSERT INTO public.invoice_order_matches (invoice_id, authorized_order_id, empresa_id) VALUES
      ('${INV}', '${OC}', '${A}');
  `);
}

beforeAll(async () => {
  db = new PGlite();
  // Shims de entorno (solo test): auth por settings, unaccent vía translate,
  // gen_random_uuid vía md5 (pgcrypto no incluido en este PGlite).
  await db.exec(`
    CREATE OR REPLACE FUNCTION pg_catalog.gen_random_uuid() RETURNS uuid
    LANGUAGE sql AS $$ SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid
      FROM (SELECT md5(random()::text || clock_timestamp()::text) AS h) s $$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.test_uid', true), '')::uuid $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT current_setting('app.test_role', true) $$;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE OR REPLACE FUNCTION extensions.unaccent(p text) RETURNS text LANGUAGE sql IMMUTABLE
    AS $$ SELECT translate($1, 'áéíóúüñÁÉÍÓÚÜÑàèìòùâêîôûãõçÀÈÌÒÙÂÊÎÔÛÃÕÇ', 'aeiouunAEIOUUNaeiouaeiocAEIOUAEIOCAOC') $$;
    CREATE SCHEMA IF NOT EXISTS private;
  `);
  // Subset mínimo del schema real (mismas columnas usadas por las RPCs).
  await db.exec(`
    CREATE TYPE public.user_role AS ENUM ('comercial', 'administracion', 'admin');
    CREATE TYPE public.invoice_status AS ENUM ('PENDIENTE','MATCH','REQUIERE_REVISION','APROBADO_EXCEPCION','APTO_PARA_PAGO','PAGADO');
    CREATE TYPE public.invoice_job_status AS ENUM ('queued','processing','needs_review','failed');
    CREATE TABLE public.empresas (id uuid PRIMARY KEY, active boolean NOT NULL DEFAULT true);
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, empresa_id uuid, role public.user_role, active boolean DEFAULT true, is_super_admin boolean DEFAULT false);
    CREATE TABLE public.authorized_orders (id uuid PRIMARY KEY, empresa_id uuid NOT NULL);
    CREATE TABLE public.invoices (id uuid PRIMARY KEY, empresa_id uuid NOT NULL, status public.invoice_status NOT NULL DEFAULT 'PENDIENTE');
    CREATE TABLE public.invoice_items (id uuid PRIMARY KEY, invoice_id uuid NOT NULL, empresa_id uuid NOT NULL, product_description text NOT NULL, quantity numeric, unit text, unit_price numeric, subtotal numeric, sort_order integer DEFAULT 0 NOT NULL);
    CREATE TABLE public.authorized_order_items (id uuid PRIMARY KEY, order_id uuid NOT NULL, empresa_id uuid NOT NULL, product text NOT NULL, quantity numeric NOT NULL, unit text NOT NULL, unit_price numeric NOT NULL DEFAULT 0, total_price numeric NOT NULL DEFAULT 0, quantity_invoiced numeric NOT NULL DEFAULT 0, sort_order integer DEFAULT 0 NOT NULL);
    CREATE TABLE public.invoice_order_matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL UNIQUE, authorized_order_id uuid NOT NULL, empresa_id uuid NOT NULL);
    CREATE TABLE public.invoice_item_matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_item_id uuid NOT NULL, order_item_id uuid NOT NULL, empresa_id uuid NOT NULL, quantity_matched numeric NOT NULL, CONSTRAINT m_qty CHECK (quantity_matched > 0));
    CREATE TABLE public.audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, actor_id uuid, actor_type text NOT NULL, actor_label text, action text NOT NULL, rfq_id uuid, rfq_provider_id uuid, invoice_id uuid, authorized_order_id uuid, detail jsonb);
    CREATE TABLE public.invoice_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, created_by uuid NOT NULL, storage_bucket text NOT NULL DEFAULT 'invoice-files', storage_path text NOT NULL, file_name text NOT NULL, mime_type text NOT NULL, batch_date date NOT NULL DEFAULT current_date, status public.invoice_job_status NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0, extracted jsonb, provider_id uuid, invoice_id uuid, outcome text, message text, error text, locked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  `);
  // Gate B11 + auditoría + trigger canónico (copias del schema real).
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.current_empresa_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
      SELECT p.empresa_id FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
      WHERE p.id=auth.uid() AND p.active AND (e.active OR p.is_super_admin);
    $$;
    CREATE OR REPLACE FUNCTION public.is_internal_role(roles public.user_role[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
      SELECT coalesce((SELECT p.role FROM public.profiles p WHERE p.id=auth.uid() AND p.active) = any(roles), false);
    $$;
    CREATE OR REPLACE FUNCTION private.b11_require_financial_actor(p_empresa uuid) RETURNS void
    LANGUAGE plpgsql SET search_path = '' AS $$
    BEGIN
      IF auth.role()='service_role' OR (auth.role() IS NULL AND current_setting('role',true) IN ('none','postgres') AND session_user IN ('postgres','supabase_admin')) THEN RETURN; END IF;
      IF auth.uid() IS NULL OR p_empresa IS NULL OR p_empresa IS DISTINCT FROM public.current_empresa_id()
         OR NOT public.is_internal_role(ARRAY['admin','administracion']::public.user_role[]) THEN
        RAISE EXCEPTION 'Financial actor/tenant denied' USING ERRCODE='42501';
      END IF;
    END;
    $$;
    CREATE OR REPLACE FUNCTION public.log_audit_event(p_action text, p_rfq_id uuid DEFAULT NULL, p_rfq_provider_id uuid DEFAULT NULL, p_invoice_id uuid DEFAULT NULL, p_authorized_order_id uuid DEFAULT NULL, p_detail jsonb DEFAULT NULL, p_actor_type text DEFAULT 'internal', p_actor_label text DEFAULT NULL) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
    DECLARE v_id uuid; BEGIN
      INSERT INTO public.audit_logs (actor_id, actor_type, actor_label, action, rfq_id, rfq_provider_id, invoice_id, authorized_order_id, detail)
      VALUES (auth.uid(), p_actor_type, p_actor_label, p_action, p_rfq_id, p_rfq_provider_id, p_invoice_id, p_authorized_order_id, p_detail)
      RETURNING id INTO v_id; RETURN v_id; END; $$;
    CREATE OR REPLACE FUNCTION public.recompute_order_item_quantity_invoiced() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
    DECLARE v_item_id uuid; BEGIN
      v_item_id := coalesce(new.order_item_id, old.order_item_id);
      UPDATE public.authorized_order_items SET quantity_invoiced = (
        SELECT coalesce(sum(quantity_matched), 0) FROM public.invoice_item_matches WHERE order_item_id = v_item_id)
      WHERE id = v_item_id;
      RETURN coalesce(new, old); END; $$;
    CREATE TRIGGER trg_recompute_order_item_qty AFTER INSERT OR DELETE OR UPDATE ON public.invoice_item_matches
    FOR EACH ROW EXECUTE FUNCTION public.recompute_order_item_quantity_invoiced();
  `);
  // Migración bajo prueba (byte-idéntica salvo GRANT/REVOKE/OWNER/EXTENSION).
  const url = new URL("../supabase/migrations/20261010040051_invoice_item_match_integrity.sql", import.meta.url);
  let skippingEnvironmentStatement = false;
  const sql = readFileSync(url, "utf8")
    .split("\n")
    .filter((line) => {
      if (skippingEnvironmentStatement) {
        if (line.includes(";")) skippingEnvironmentStatement = false;
        return false;
      }
      if (/^\s*(GRANT|REVOKE|ALTER FUNCTION|CREATE EXTENSION)\b/i.test(line)) {
        skippingEnvironmentStatement = !line.includes(";");
        return false;
      }
      return true;
    })
    .join("\n");
  await db.exec(sql);
}, T.timeout);

beforeEach(async () => {
  await db.exec(`TRUNCATE public.invoice_item_matches, public.invoice_order_matches, public.invoice_items, public.authorized_order_items, public.authorized_orders, public.invoices, public.profiles, public.empresas, public.audit_logs, public.invoice_jobs`);
  await seed();
  await setActor("authenticated", ADMIN_A);
}, T.timeout);

describe("helpers de correspondencia (réplica SQL de reconcile.ts)", () => {
  it("unidades: alias compatibles e incompatibles", T, async () => {
    const q = (a: string | null, b: string | null) =>
      db.query("SELECT public.invoice_match_units_compatible($1,$2) AS v", [a, b]).then((r) => (r.rows[0] as { v: boolean }).v);
    expect(await q("un", "unidades")).toBe(true);
    expect(await q("UN", "u")).toBe(true);
    expect(await q("m²", "m2")).toBe(true);
    expect(await q("kg", "un")).toBe(false);
    expect(await q(null, "un")).toBe(false);
    expect(await q("un", null)).toBe(false);
  });

  it("descripciones: tildes, subset léxico y ajenos", T, async () => {
    const q = (a: string, b: string) =>
      db.query("SELECT public.invoice_match_descriptions_match($1,$2) AS v", [a, b]).then((r) => (r.rows[0] as { v: boolean }).v);
    expect(await q("Ladrillo común", "LADRILLO COMUN")).toBe(true);
    expect(await q("Ladrillo común segunda entrega", "Ladrillo común")).toBe(true);
    expect(await q("Ladrillo común", "Cemento puzolánico")).toBe(false);
    expect(await q("", "Ladrillo")).toBe(false);
  });
});

describe("create_invoice_item_match (H2 funcional)", () => {
  it("caso válido: inserta, el trigger recalcula y audita", T, async () => {
    const r = await callCreate(A, INV, IL1, OL1, 2500);
    const out = (r.rows[0] as { r: { ok: boolean; match_id: string; duplicate: boolean } }).r;
    expect(out.ok).toBe(true);
    expect(out.duplicate).toBe(false);
    const qty = await db.query("SELECT quantity_invoiced AS v FROM public.authorized_order_items WHERE id=$1", [OL1]);
    expect(Number((qty.rows[0] as { v: string }).v)).toBe(2500);
    const audit = await db.query("SELECT action AS a FROM public.audit_logs WHERE invoice_id=$1", [INV]);
    expect(audit.rows.map((x) => (x as { a: string }).a)).toContain("invoice.item_matched");
  });

  it("supera documentada: revierte sin escribir", T, async () => {
    await throwsWith(callCreate(A, INV, IL1, OL1, 2501), "documentada");
    const n = await db.query("SELECT count(*) AS c FROM public.invoice_item_matches");
    expect(Number((n.rows[0] as { c: string }).c)).toBe(0);
  });

  it("supera remanente: revierte sin escribir", T, async () => {
    await db.exec(`INSERT INTO public.invoice_item_matches (invoice_item_id,order_item_id,empresa_id,quantity_matched) VALUES ('${IL2}','${OL1}','${A}',2000)`);
    await throwsWith(callCreate(A, INV, IL1, OL1, 1500), "remanente");
    const n = await db.query("SELECT count(*) AS c FROM public.invoice_item_matches");
    expect(Number((n.rows[0] as { c: string }).c)).toBe(1);
    const counter = await db.query("SELECT quantity_invoiced AS q FROM public.authorized_order_items WHERE id=$1", [OL1]);
    expect(Number((counter.rows[0] as { q: string }).q)).toBe(2000);
  });

  it("línea de otra factura: rechazada", T, async () => {
    await db.exec(`INSERT INTO public.invoices (id, empresa_id, status) VALUES ('00000000-0000-4000-8000-000000000010', '${A}', 'PENDIENTE');
      INSERT INTO public.invoice_items (id, invoice_id, empresa_id, product_description, quantity, unit) VALUES ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000010', '${A}', 'Ladrillo común', 100, 'un');
      INSERT INTO public.invoice_order_matches (invoice_id, authorized_order_id, empresa_id) VALUES ('00000000-0000-4000-8000-000000000010', '${OC}', '${A}');`);
    await throwsWith(
      callCreate(A, "00000000-0000-4000-8000-000000000010", IL1, OL1, 100),
      "no pertenece a esta factura"
    );
  });

  it("ítem de otra OC: rechazado", T, async () => {
    await throwsWith(callCreate(A, INV, IL1, OL_B1, 100), "otra OC");
  });

  it("sin vínculo: rechazado", T, async () => {
    await db.exec(`DELETE FROM public.invoice_order_matches WHERE invoice_id='${INV}'`);
    await throwsWith(callCreate(A, INV, IL1, OL1, 100), "OC vinculada");
  });

  it("factura APTO: congelada", T, async () => {
    await db.exec(`UPDATE public.invoices SET status='APTO_PARA_PAGO' WHERE id='${INV}'`);
    await throwsWith(callCreate(A, INV, IL1, OL1, 100), "congelada");
  });

  it("unidad incompatible: rechazada", T, async () => {
    await db.exec(`INSERT INTO public.authorized_order_items (id, order_id, empresa_id, product, quantity, unit) VALUES ('00000000-0000-4000-8000-000000000013', '${OC}', '${A}', 'Ladrillo común', 5000, 'bolsa')`);
    await throwsWith(callCreate(A, INV, IL1, "00000000-0000-4000-8000-000000000013", 100), "unidad");
  });

  it("reintento idéntico: idempotente (mismo id, una sola fila)", T, async () => {
    const r1 = await callCreate(A, INV, IL1, OL1, 2500);
    const id1 = (r1.rows[0] as { r: { match_id: string } }).r.match_id;
    const r2 = await callCreate(A, INV, IL1, OL1, 2500);
    const out2 = (r2.rows[0] as { r: { ok: boolean; match_id: string; duplicate: boolean } }).r;
    expect(out2.ok).toBe(true);
    expect(out2.duplicate).toBe(true);
    expect(out2.match_id).toBe(id1);
    const n = await db.query("SELECT count(*) AS c FROM public.invoice_item_matches");
    expect(Number((n.rows[0] as { c: string }).c)).toBe(1);
  });

  it("duplicado con distinta cantidad: error, sin duplicar", T, async () => {
    await callCreate(A, INV, IL1, OL1, 1000);
    await throwsWith(callCreate(A, INV, IL1, OL1, 1500), "ya está imputada");
    const n = await db.query("SELECT count(*) AS c FROM public.invoice_item_matches");
    expect(Number((n.rows[0] as { c: string }).c)).toBe(1);
  });

  it("segunda imputación acumulada respeta el tope documentado", T, async () => {
    await db.exec(`INSERT INTO public.authorized_order_items (id, order_id, empresa_id, product, quantity, unit) VALUES ('00000000-0000-4000-8000-000000000012', '${OC}', '${A}', 'Ladrillo común', 9000, 'un')`);
    await callCreate(A, INV, IL1, OL1, 2000);
    await throwsWith(callCreate(A, INV, IL1, "00000000-0000-4000-8000-000000000012", 600), "documentada");
    const ok = await callCreate(A, INV, IL1, "00000000-0000-4000-8000-000000000012", 500);
    expect((ok.rows[0] as { r: { ok: boolean } }).r.ok).toBe(true);
  });

  it("tenant B no toca datos de A (42501)", T, async () => {
    await setActor("authenticated", ADMIN_B);
    await throwsWith(callCreate(A, INV, IL1, OL1, 100), "denied");
    const n = await db.query("SELECT count(*) AS c FROM public.invoice_item_matches");
    expect(Number((n.rows[0] as { c: string }).c)).toBe(0);
    await setActor("authenticated", ADMIN_A);
  });

  it("rol sin autorización es denegado", T, async () => {
    await setActor("authenticated", COMERCIAL_A);
    await throwsWith(callCreate(A, INV, IL1, OL1, 100), "denied");
    await setActor("authenticated", ADMIN_A);
  });

  it("vía worker (service_role) con empresa explícita funciona", T, async () => {
    await setActor("service_role", "");
    const r = await callCreate(A, INV, IL1, OL1, 2500);
    expect((r.rows[0] as { r: { ok: boolean } }).r.ok).toBe(true);
    await setActor("authenticated", ADMIN_A);
  });

  it("worker con empresa errónea falla cerrado", T, async () => {
    await setActor("service_role", "");
    await throwsWith(callCreate(B, INV, IL1, OL1, 100), "esta empresa");
    await setActor("authenticated", ADMIN_A);
  });
});

describe("correct_invoice_item (H3 funcional)", () => {
  it("corrección válida in-place: mismo id, matches conservados", T, async () => {
    await callCreate(A, INV, IL1, OL1, 2500);
    const r = await callCorrect(A, IL1, "Ladrillo común", 2500, "un", 1400, 3500000);
    const out = (r.rows[0] as { r: { ok: boolean; item_id: string; matches_kept: number; matches_dropped: number } }).r;
    expect(out.ok).toBe(true);
    expect(out.item_id).toBe(IL1);
    expect(out.matches_kept).toBe(1);
    expect(out.matches_dropped).toBe(0);
    const qty = await db.query("SELECT quantity_invoiced AS v FROM public.authorized_order_items WHERE id=$1", [OL1]);
    expect(Number((qty.rows[0] as { v: string }).v)).toBe(2500);
  });

  it("reducir bajo lo imputado: rollback total (línea y matches intactos)", T, async () => {
    await callCreate(A, INV, IL1, OL1, 2500);
    await throwsWith(callCorrect(A, IL1, "Ladrillo común", 1000, "un", 1400, 1400000), "sobre-imputada");
    const line = await db.query("SELECT quantity AS q FROM public.invoice_items WHERE id=$1", [IL1]);
    expect(Number((line.rows[0] as { q: string }).q)).toBe(2500);
    const n = await db.query("SELECT count(*) AS c FROM public.invoice_item_matches");
    expect(Number((n.rows[0] as { c: string }).c)).toBe(1);
    const qty = await db.query("SELECT quantity_invoiced AS v FROM public.authorized_order_items WHERE id=$1", [OL1]);
    expect(Number((qty.rows[0] as { v: string }).v)).toBe(2500);
  });

  it("cambio de producto: match obsoleto se da de baja explícita y el trigger recalcula", T, async () => {
    await callCreate(A, INV, IL1, OL1, 2500);
    const r = await callCorrect(A, IL1, "Cemento puzolánico", 2500, "bolsa", 5000, 12500000);
    const out = (r.rows[0] as { r: { matches_kept: number; matches_dropped: number } }).r;
    expect(out.matches_kept).toBe(0);
    expect(out.matches_dropped).toBe(1);
    const qty = await db.query("SELECT quantity_invoiced AS v FROM public.authorized_order_items WHERE id=$1", [OL1]);
    expect(Number((qty.rows[0] as { v: string }).v)).toBe(0);
    const audit = await db.query("SELECT detail AS d FROM public.audit_logs WHERE action='invoice.item_corrected'");
    expect(JSON.stringify((audit.rows[0] as { d: unknown }).d)).toContain("matches_dropped");
  });

  it("factura aprobada: corrección rechazada sin tocar nada", T, async () => {
    await db.exec(`UPDATE public.invoices SET status='PAGADO' WHERE id='${INV}'`);
    await throwsWith(callCorrect(A, IL1, "Otro", 100, "un", 1, 100), "congeladas");
  });

  it("línea inexistente: error sin efectos", T, async () => {
    await throwsWith(callCorrect(A, "00000000-0000-4000-8000-000000000099", "X", 1, "un", 1, 1), "no encontrada");
  });

  it("descripción vacía: error de validación", T, async () => {
    await throwsWith(callCorrect(A, IL1, "   ", 1, "un", 1, 1), "descripción válida");
  });
});
