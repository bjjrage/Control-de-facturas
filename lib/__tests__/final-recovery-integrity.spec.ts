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
const createMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260925052356_serialize_certificate_create_with_revert.sql"),
  "utf8",
);
const headerImmutabilityMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260925053952_certificate_header_immutability_guard.sql"),
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
const workbookAction = readFileSync(
  resolve(process.cwd(), "app/(internal)/projects/actions.ts"),
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
      CREATE TABLE public.test_context (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        user_id uuid NOT NULL,
        empresa_id uuid NOT NULL,
        is_admin boolean NOT NULL
      );
      INSERT INTO public.test_context VALUES
        (true, '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000098', true);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT user_id FROM public.test_context WHERE singleton;
      $$;
      CREATE FUNCTION public.current_empresa_id() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT empresa_id FROM public.test_context WHERE singleton;
      $$;
      CREATE FUNCTION public.is_internal_role(public.user_role[]) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT is_admin FROM public.test_context WHERE singleton;
      $$;
      CREATE TABLE public.projects (id uuid PRIMARY KEY, empresa_id uuid NOT NULL);
      CREATE TABLE public.project_certificates (
        id uuid PRIMARY KEY,
        status text NOT NULL,
        project_id uuid,
        numero integer NOT NULL DEFAULT 1,
        notes text,
        period_start date,
        monto_presente numeric,
        updated_at timestamptz,
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
    await db.exec(createMigration);
    await db.exec(headerImmutabilityMigration);
  });

  afterEach(async () => {
    await db.close();
  });

  it("prevents deleting a closed certificate or its immutable lines", async () => {
    await db.exec(`
      INSERT INTO public.projects VALUES
        ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000098');
      INSERT INTO public.project_certificates (id, status, project_id, numero) VALUES
        ('00000000-0000-0000-0000-000000000001', 'BORRADOR', '00000000-0000-0000-0000-000000000010', 1);
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
      INSERT INTO public.project_certificate_items VALUES
        ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001')
    `)).rejects.toThrow(/certificado en borrador/i);
    await expect(db.query(`
      UPDATE public.project_certificate_items SET id = '00000000-0000-0000-0000-000000000004'
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
      INSERT INTO public.projects VALUES
        ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000098');
      INSERT INTO public.project_certificates (id, status, project_id, numero) VALUES
        ('00000000-0000-0000-0000-000000000011', 'BORRADOR', '00000000-0000-0000-0000-000000000020', 1);
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
        ('00000000-0000-0000-0000-000000000042', 'BORRADOR', '00000000-0000-0000-0000-000000000041', 1);
      UPDATE public.project_certificates SET status = 'ELABORADO'
      WHERE id = '00000000-0000-0000-0000-000000000042';
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
      ALTER TABLE public.project_certificates DISABLE TRIGGER trg_guard_project_certificate_create;
      INSERT INTO public.project_certificates (id, status, project_id, numero) VALUES
        ('00000000-0000-0000-0000-000000000053', 'ELABORADO', '00000000-0000-0000-0000-000000000051', 1);
      ALTER TABLE public.project_certificates ENABLE TRIGGER trg_guard_project_certificate_create;
    `);

    await expect(db.query(`
      SELECT public.revert_project_certificate_status_atomically(
        '00000000-0000-0000-0000-000000000053', 'ELABORADO'
      )
    `)).rejects.toThrow(/no encontrado para la empresa/i);
  });

  it("checks role and expected state, then clears only the signature being reverted", async () => {
    await db.exec(`
      INSERT INTO public.projects VALUES
        ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000098');
      INSERT INTO public.project_certificates (id, status, project_id, numero, notes) VALUES
        ('00000000-0000-0000-0000-000000000062', 'BORRADOR', '00000000-0000-0000-0000-000000000061', 1, 'preserve-me');
      UPDATE public.project_certificates
      SET status = 'ELABORADO', elaborado_por = '00000000-0000-0000-0000-000000000099',
          elaborado_at = now(), closed_at = now(),
          devolucion_anticipo_pct_snap = 30, retencion_pct_snap = 5
      WHERE id = '00000000-0000-0000-0000-000000000062';
    `);

    await db.exec(`UPDATE public.test_context SET is_admin = false WHERE singleton`);
    await expect(db.query(`
      SELECT public.revert_project_certificate_status_atomically(
        '00000000-0000-0000-0000-000000000062', 'ELABORADO'
      )
    `)).rejects.toThrow(/solo administración/i);
    await db.exec(`UPDATE public.test_context SET is_admin = true WHERE singleton`);

    await expect(db.query(`
      SELECT public.revert_project_certificate_status_atomically(
        '00000000-0000-0000-0000-000000000062', 'VERIFICADO'
      )
    `)).rejects.toThrow(/cambió de estado/i);
    await db.query(`
      SELECT public.revert_project_certificate_status_atomically(
        '00000000-0000-0000-0000-000000000062', 'ELABORADO'
      )
    `);
    const elaboradoResult = await db.query<{ status: string; elaborado_por: string | null; elaborado_at: string | null; closed_at: string | null; devolucion_anticipo_pct_snap: number | null; retencion_pct_snap: number | null }>(`
      SELECT status, elaborado_por, elaborado_at, closed_at, devolucion_anticipo_pct_snap, retencion_pct_snap
      FROM public.project_certificates WHERE id = '00000000-0000-0000-0000-000000000062'
    `);
    expect(elaboradoResult.rows[0]).toMatchObject({
      status: "BORRADOR",
      elaborado_por: null,
      elaborado_at: null,
      closed_at: null,
      devolucion_anticipo_pct_snap: null,
      retencion_pct_snap: null,
    });

    await db.exec(`
      UPDATE public.project_certificates
      SET status = 'ELABORADO', elaborado_por = '00000000-0000-0000-0000-000000000099', elaborado_at = now(), closed_at = now()
      WHERE id = '00000000-0000-0000-0000-000000000062';
      UPDATE public.project_certificates
      SET status = 'VERIFICADO', verificado_por = '00000000-0000-0000-0000-000000000099', verificado_at = now()
      WHERE id = '00000000-0000-0000-0000-000000000062';
    `);
    await db.query(`
      SELECT public.revert_project_certificate_status_atomically(
        '00000000-0000-0000-0000-000000000062', 'VERIFICADO'
      )
    `);
    const verificadoResult = await db.query<{ status: string; verificado_por: string | null; verificado_at: string | null }>(`
      SELECT status, verificado_por, verificado_at
      FROM public.project_certificates WHERE id = '00000000-0000-0000-0000-000000000062'
    `);
    expect(verificadoResult.rows[0]).toMatchObject({ status: "ELABORADO", verificado_por: null, verificado_at: null });

    await db.exec(`
      UPDATE public.project_certificates
      SET status = 'VERIFICADO', verificado_por = '00000000-0000-0000-0000-000000000099', verificado_at = now()
      WHERE id = '00000000-0000-0000-0000-000000000062';
      UPDATE public.project_certificates
      SET status = 'APROBADO', aprobado_por = '00000000-0000-0000-0000-000000000099', aprobado_at = now()
      WHERE id = '00000000-0000-0000-0000-000000000062';
    `);
    await db.query(`
      SELECT public.revert_project_certificate_status_atomically(
        '00000000-0000-0000-0000-000000000062', 'APROBADO'
      )
    `);
    const aprobadoResult = await db.query<{ status: string; aprobado_por: string | null; aprobado_at: string | null; notes: string }>(`
      SELECT status, aprobado_por, aprobado_at, notes
      FROM public.project_certificates WHERE id = '00000000-0000-0000-0000-000000000062'
    `);
    expect(aprobadoResult.rows[0]).toMatchObject({ status: "VERIFICADO", aprobado_por: null, aprobado_at: null, notes: "preserve-me" });

    await db.exec(`
      UPDATE public.project_certificates
      SET status = 'APROBADO', aprobado_por = '00000000-0000-0000-0000-000000000099', aprobado_at = now()
      WHERE id = '00000000-0000-0000-0000-000000000062';
      UPDATE public.project_certificates
      SET status = 'FACTURADO', facturado_at = now(), factura_numero = 'F-1'
      WHERE id = '00000000-0000-0000-0000-000000000062';
    `);
    await db.query(`
      SELECT public.revert_project_certificate_status_atomically(
        '00000000-0000-0000-0000-000000000062', 'FACTURADO'
      )
    `);
    const facturadoResult = await db.query<{ status: string; facturado_at: string | null; factura_numero: string | null }>(`
      SELECT status, facturado_at, factura_numero
      FROM public.project_certificates WHERE id = '00000000-0000-0000-0000-000000000062'
    `);
    expect(facturadoResult.rows[0]).toMatchObject({ status: "APROBADO", facturado_at: null, factura_numero: null });
  });

  it("serializes new certificates with rollback and enforces the latest approved predecessor", async () => {
    await db.exec(`
      INSERT INTO public.projects VALUES
        ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000098');
      INSERT INTO public.project_certificates (id, status, project_id, numero) VALUES
        ('00000000-0000-0000-0000-000000000072', 'BORRADOR', '00000000-0000-0000-0000-000000000071', 1);
    `);

    await expect(db.query(`
      INSERT INTO public.project_certificates (id, status, project_id, numero) VALUES
        ('00000000-0000-0000-0000-000000000073', 'BORRADOR', '00000000-0000-0000-0000-000000000071', 2)
    `)).rejects.toThrow(/certificado anterior debe estar aprobado/i);

    await db.exec(`
      UPDATE public.project_certificates SET status = 'ELABORADO'
      WHERE id = '00000000-0000-0000-0000-000000000072';
      UPDATE public.project_certificates SET status = 'VERIFICADO'
      WHERE id = '00000000-0000-0000-0000-000000000072';
      UPDATE public.project_certificates SET status = 'APROBADO'
      WHERE id = '00000000-0000-0000-0000-000000000072';
    `);

    await expect(db.query(`
      INSERT INTO public.project_certificates (id, status, project_id, numero) VALUES
        ('00000000-0000-0000-0000-000000000074', 'BORRADOR', '00000000-0000-0000-0000-000000000071', 3)
    `)).rejects.toThrow(/número del certificado cambió/i);
    await db.query(`
      INSERT INTO public.project_certificates (id, status, project_id, numero) VALUES
        ('00000000-0000-0000-0000-000000000075', 'BORRADOR', '00000000-0000-0000-0000-000000000071', 2)
    `);

    await expect(db.query(`
      SELECT public.revert_project_certificate_status_atomically(
        '00000000-0000-0000-0000-000000000072', 'APROBADO'
      )
    `)).rejects.toThrow(/certificado posterior que depende/i);
  });

  it("freezes approved and invoiced headers and keeps invoice/reversal changes narrow", async () => {
    await db.exec(`
      INSERT INTO public.projects VALUES
        ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000098');
      INSERT INTO public.project_certificates (id, status, project_id, numero, notes) VALUES
        ('00000000-0000-0000-0000-000000000082', 'BORRADOR', '00000000-0000-0000-0000-000000000081', 1, 'base');
      UPDATE public.project_certificates SET status = 'ELABORADO'
      WHERE id = '00000000-0000-0000-0000-000000000082';
      UPDATE public.project_certificates SET status = 'VERIFICADO'
      WHERE id = '00000000-0000-0000-0000-000000000082';
    `);

    await expect(db.query(`
      UPDATE public.project_certificates
      SET status = 'APROBADO', aprobado_por = '00000000-0000-0000-0000-000000000099',
          aprobado_at = now(), monto_presente = 999, period_start = '2026-01-01'
      WHERE id = '00000000-0000-0000-0000-000000000082'
    `)).rejects.toThrow(/transiciÃ³n de certificado no puede modificar otros datos/i);
    await db.query(`
      UPDATE public.project_certificates
      SET status = 'APROBADO', aprobado_por = '00000000-0000-0000-0000-000000000099', aprobado_at = now()
      WHERE id = '00000000-0000-0000-0000-000000000082'
    `);

    await expect(db.query(`
      UPDATE public.project_certificates SET notes = 'alterado'
      WHERE id = '00000000-0000-0000-0000-000000000082'
    `)).rejects.toThrow(/cabecera .* inmutable/i);
    await expect(db.query(`
      UPDATE public.project_certificates SET project_id = '00000000-0000-0000-0000-000000000099'
      WHERE id = '00000000-0000-0000-0000-000000000082'
    `)).rejects.toThrow(/identidad.*inmutables/i);
    await expect(db.query(`
      UPDATE public.project_certificates SET status = 'FACTURADO', factura_numero = 'F-2', facturado_at = now(), notes = 'alterado'
      WHERE id = '00000000-0000-0000-0000-000000000082'
    `)).rejects.toThrow(/puede modificar otros datos del certificado/i);
    await expect(db.query(`
      UPDATE public.project_certificates SET status = 'FACTURADO', factura_numero = 'F-2'
      WHERE id = '00000000-0000-0000-0000-000000000082'
    `)).rejects.toThrow(/requiere nÃºmero y fecha/i);

    await db.query(`
      UPDATE public.project_certificates
      SET status = 'FACTURADO', factura_numero = 'F-2', facturado_at = now()
      WHERE id = '00000000-0000-0000-0000-000000000082'
    `);
    await expect(db.query(`
      UPDATE public.project_certificates SET factura_numero = 'F-ALTERADA'
      WHERE id = '00000000-0000-0000-0000-000000000082'
    `)).rejects.toThrow(/cabecera .* inmutable/i);
    await db.query(`
      SELECT public.revert_project_certificate_status_atomically(
        '00000000-0000-0000-0000-000000000082', 'FACTURADO'
      )
    `);
    const result = await db.query<{ status: string; factura_numero: string | null; facturado_at: string | null; notes: string }>(`
      SELECT status, factura_numero, facturado_at, notes
      FROM public.project_certificates WHERE id = '00000000-0000-0000-0000-000000000082'
    `);
    expect(result.rows[0]).toMatchObject({
      status: "APROBADO",
      factura_numero: null,
      facturado_at: null,
      notes: "base",
    });
  });

  it("keeps certificate project and sequence identity immutable after insertion", async () => {
    await db.exec(`
      INSERT INTO public.projects VALUES
        ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000098'),
        ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000098');
      INSERT INTO public.project_certificates (id, status, project_id, numero) VALUES
        ('00000000-0000-0000-0000-000000000093', 'BORRADOR', '00000000-0000-0000-0000-000000000091', 1);
    `);

    await expect(db.query(`
      UPDATE public.project_certificates SET project_id = '00000000-0000-0000-0000-000000000092'
      WHERE id = '00000000-0000-0000-0000-000000000093'
    `)).rejects.toThrow(/identidad.*inmutables/i);
    await expect(db.query(`
      UPDATE public.project_certificates SET numero = 2
      WHERE id = '00000000-0000-0000-0000-000000000093'
    `)).rejects.toThrow(/identidad.*inmutables/i);
    await expect(db.query(`
      UPDATE public.project_certificates SET id = '00000000-0000-0000-0000-000000000094'
      WHERE id = '00000000-0000-0000-0000-000000000093'
    `)).rejects.toThrow(/identidad.*inmutables/i);
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
    expect(createMigration).toContain("BEFORE INSERT ON public.project_certificates");
    expect(createMigration).toContain("FOR UPDATE");
    expect(createMigration).toContain("revert_project_certificate_status_atomically");
    expect(headerImmutabilityMigration).toContain("BEFORE UPDATE ON public.project_certificates");
    expect(headerImmutabilityMigration).toContain("La cabecera de un certificado aprobado o facturado es inmutable");
    expect(certificateAction).toContain('"revert_project_certificate_status_atomically"');
    expect(receiptAction).toContain('receipt.idempotency_key.startsWith("receipt-portal:")');
    expect(receiptAction).toContain('select("producto_id")');
    expect(receiptUi).toContain("hasUnmappedPortalItems");
    expect(receiptUi).toContain("disabled={confirming || hasUnmappedPortalItems}");

    const workbookCertificateFlow = workbookAction.slice(
      workbookAction.indexOf("if (certificateApplicable && certificateAccepted)"),
      workbookAction.indexOf('} else if (result.candidate.certificate.status !== "NOT_DETECTED")'),
    );
    expect(workbookCertificateFlow).toContain("const certificateWriter = await createClient();");
    expect(workbookCertificateFlow).toContain('certificateWriter.from("project_certificates")');
    expect(workbookCertificateFlow).toContain('certificateWriter.from("project_certificate_items")');
    expect(workbookCertificateFlow).not.toContain('admin.from("project_certificates")');
  });
});
