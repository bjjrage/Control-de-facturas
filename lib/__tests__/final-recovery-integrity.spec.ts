import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260925043900_final_adversarial_integrity_guards.sql"),
  "utf8",
);
const transitionMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260925050829_certificate_status_transition_guard.sql"),
  "utf8",
);
const receiptAction = readFileSync(
  resolve(process.cwd(), "app/(internal)/orders/oc-recepcion-actions.ts"),
  "utf8",
);
const receiptUi = readFileSync(
  resolve(process.cwd(), "app/(internal)/orders/[id]/recepcion-section.tsx"),
  "utf8",
);
const certificateAction = readFileSync(
  resolve(process.cwd(), "app/(internal)/projects/certificado-actions.ts"),
  "utf8",
);

describe("final adversarial integrity guards", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth;
      CREATE TYPE public.user_role AS ENUM ('admin', 'administracion');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT '00000000-0000-0000-0000-000000000099'::uuid;
      $$;
      CREATE FUNCTION public.current_empresa_id() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT '00000000-0000-0000-0000-000000000098'::uuid;
      $$;
      CREATE FUNCTION public.is_internal_role(public.user_role[]) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT true;
      $$;
      CREATE TABLE public.projects (id uuid PRIMARY KEY, empresa_id uuid NOT NULL);
      CREATE TABLE public.project_certificates (
        id uuid PRIMARY KEY,
        status text NOT NULL,
        project_id uuid,
        numero integer NOT NULL DEFAULT 1,
        elaborado_por uuid,
        elaborado_at timestamptz,
        closed_at timestamptz,
        devolucion_anticipo_pct_snap numeric,
        retencion_pct_snap numeric,
        verificado_por uuid,
        verificado_at timestamptz,
        aprobado_por uuid,
        aprobado_at timestamptz,
        facturado_at timestamptz,
        factura_numero text
      );
      CREATE TABLE public.project_certificate_items (
        id uuid PRIMARY KEY,
        certificate_id uuid NOT NULL REFERENCES public.project_certificates(id) ON DELETE CASCADE
      );
      CREATE TABLE public.oc_recepciones (
        id uuid PRIMARY KEY,
        empresa_id uuid NOT NULL,
        status text NOT NULL,
        idempotency_key text
      );
      CREATE TABLE public.oc_recepcion_items (
        id uuid PRIMARY KEY,
        empresa_id uuid NOT NULL,
        recepcion_id uuid NOT NULL REFERENCES public.oc_recepciones(id) ON DELETE CASCADE,
        producto_id uuid
      );
    `);
    await db.exec(migration);
    await db.exec(transitionMigration);
  });

  afterEach(async () => {
    await db.close();
  });

  it("prevents deleting a closed certificate or its immutable lines", async () => {
    await db.exec(`
      INSERT INTO public.project_certificates (id, status) VALUES ('00000000-0000-0000-0000-000000000001', 'BORRADOR');
      INSERT INTO public.project_certificate_items VALUES
        ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
      UPDATE public.project_certificates SET status = 'ELABORADO'
      WHERE id = '00000000-0000-0000-0000-000000000001';
      UPDATE public.project_certificates SET status = 'VERIFICADO'
      WHERE id = '00000000-0000-0000-0000-000000000001';
      UPDATE public.project_certificates SET status = 'APROBADO'
      WHERE id = '00000000-0000-0000-0000-000000000001';
    `);

    await expect(db.query(`
      DELETE FROM public.project_certificate_items
      WHERE id = '00000000-0000-0000-0000-000000000002'
    `)).rejects.toThrow(/certificado en borrador/i);
    await expect(db.query(`
      UPDATE public.project_certificates SET status = 'BORRADOR'
      WHERE id = '00000000-0000-0000-0000-000000000001'
    `)).rejects.toThrow(/acción administrativa autorizada/i);
    await expect(db.query(`
      DELETE FROM public.project_certificates
      WHERE id = '00000000-0000-0000-0000-000000000001'
    `)).rejects.toThrow(/certificado cerrado/i);
  });

  it("still permits deleting a draft certificate and cascading its lines", async () => {
    await db.exec(`
      INSERT INTO public.project_certificates (id, status) VALUES ('00000000-0000-0000-0000-000000000011', 'BORRADOR');
      INSERT INTO public.project_certificate_items VALUES
        ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000011');
    `);
    await db.query(`DELETE FROM public.project_certificates WHERE id = '00000000-0000-0000-0000-000000000011'`);
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.project_certificate_items`
    );
    expect(rows[0].count).toBe(0);
  });

  it("allows only the tenant-checked admin RPC to roll a certificate back", async () => {
    await db.exec(`
      INSERT INTO public.projects VALUES
        ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000098');
      INSERT INTO public.project_certificates (id, status, project_id, numero) VALUES
        ('00000000-0000-0000-0000-000000000042', 'ELABORADO', '00000000-0000-0000-0000-000000000041', 1);
    `);

    const { rows } = await db.query<{ status: string }>(`
      SELECT public.revert_project_certificate_status_atomically(
        '00000000-0000-0000-0000-000000000042', 'ELABORADO'
      ) AS status
    `);
    expect(rows[0].status).toBe("BORRADOR");
  });

  it("does not let the rollback RPC cross the current company boundary", async () => {
    await db.exec(`
      INSERT INTO public.projects VALUES
        ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000052');
      INSERT INTO public.project_certificates (id, status, project_id, numero) VALUES
        ('00000000-0000-0000-0000-000000000053', 'ELABORADO', '00000000-0000-0000-0000-000000000051', 1);
    `);

    await expect(db.query(`
      SELECT public.revert_project_certificate_status_atomically(
        '00000000-0000-0000-0000-000000000053', 'ELABORADO'
      )
    `)).rejects.toThrow(/no encontrado para la empresa/i);
  });

  it("requires every external portal receipt line to map before confirmation", async () => {
    await db.exec(`
      INSERT INTO public.oc_recepciones VALUES
        ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000022', 'DRAFT', 'receipt-portal:link');
      INSERT INTO public.oc_recepcion_items VALUES
        ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000021', NULL);
    `);

    await expect(db.query(`
      UPDATE public.oc_recepciones SET status = 'CONFIRMED'
      WHERE id = '00000000-0000-0000-0000-000000000021'
    `)).rejects.toThrow(/Vinculá todos los productos/i);

    await db.query(`
      UPDATE public.oc_recepcion_items SET producto_id = '00000000-0000-0000-0000-000000000024'
      WHERE id = '00000000-0000-0000-0000-000000000023'
    `);
    await db.query(`
      UPDATE public.oc_recepciones SET status = 'CONFIRMED'
      WHERE id = '00000000-0000-0000-0000-000000000021'
    `);
  });

  it("does not change confirmation rules for non-portal legacy receipts", async () => {
    await db.exec(`
      INSERT INTO public.oc_recepciones VALUES
        ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000032', 'DRAFT', 'manual-key');
      INSERT INTO public.oc_recepcion_items VALUES
        ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000031', NULL);
    `);
    await db.query(`
      UPDATE public.oc_recepciones SET status = 'CONFIRMED'
      WHERE id = '00000000-0000-0000-0000-000000000031'
    `);
  });

  it("keeps portal completion blockers visible in both the server action and review UI", () => {
    expect(migration).toContain("BEFORE INSERT OR UPDATE OR DELETE ON public.project_certificate_items");
    expect(migration).toContain("BEFORE DELETE ON public.project_certificates");
    expect(migration).toContain("BEFORE UPDATE OF status ON public.oc_recepciones");
    expect(transitionMigration).toContain("BEFORE UPDATE OF status ON public.project_certificates");
    expect(transitionMigration).toContain("revert_project_certificate_status_atomically");
    expect(certificateAction).toContain('"revert_project_certificate_status_atomically"');
    expect(receiptAction).toContain('receipt.idempotency_key.startsWith("receipt-portal:")');
    expect(receiptAction).toContain('select("producto_id")');
    expect(receiptUi).toContain("hasUnmappedPortalItems");
    expect(receiptUi).toContain("disabled={confirming || hasUnmappedPortalItems}");
  });
});
