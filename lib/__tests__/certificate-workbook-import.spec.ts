import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCertificateImportLines, extractCertificateWorkbookData, matchCertificateRows, type CertificateBudgetItem, type CertificateWorkbookRow } from "@/lib/certificates/workbook-import";
import { parseWorkbook } from "@/lib/workbook-interpretation/parser";
import { reconcileImportPlan } from "@/lib/workbook-interpretation/import-plan";

const createGuard = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925052356_serialize_certificate_create_with_revert.sql"), "utf8");
const importMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925110000_project_certificate_workbook_import.sql"), "utf8");
const forwardMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260926010000_autonomous_certificate_workbook_import.sql"), "utf8");
const tenantA = "00000000-0000-4000-8000-000000000001";
const tenantB = "00000000-0000-4000-8000-000000000002";
const projectA = "00000000-0000-4000-8000-000000000101";
const otherProject = "00000000-0000-4000-8000-000000000102";
const foreignProject = "00000000-0000-4000-8000-000000000103";
const budgetA = "00000000-0000-4000-8000-000000000201";
const budgetOther = "00000000-0000-4000-8000-000000000202";
const budgetForeign = "00000000-0000-4000-8000-000000000203";

describe("project certificate workbook import", () => {
  it("extracts a valid XLSX certificate and exact budget matches", () => {
    const workbook = parseWorkbook(makeXlsx(), "certificate.xlsx");
    const extracted = extractCertificateWorkbookData(workbook, plan());
    const matches = matchCertificateRows(extracted.rows, [budgetItem(budgetA, projectA)], projectA);
    expect(extracted).toMatchObject({ number: 1, periodStart: "2026-09-01", periodEnd: "2026-09-30" });
    expect(extracted.rows[0]).toMatchObject({ code: "01", description: "Excavación manual", unit: "m3", quantityContractual: 10, quantityPrevious: 0, quantityCurrent: 2, unitPrice: 1250, amountCurrent: 2500 });
    expect(matches[0]).toMatchObject({ budgetItemId: budgetA, match: "MATCHED" });
  });

  it("infers the certificate table locally without calling the external workbook model", () => {
    const workbook = parseWorkbook(makeXlsx(), "certificate.xlsx");
    const inferred = reconcileImportPlan(workbook, {
      workbookType: "CONSTRUCTION_PROJECT", overallConfidence: 1, blocks: [], unresolvedRegions: [], warnings: [],
    }, ["CERTIFICATE"]);
    expect(inferred.plan.blocks[0].columnMappings.map(({ column, role }) => [column, role])).toEqual([
      ["A", "code"], ["B", "description"], ["C", "unit"], ["D", "quantity"],
      ["E", "previousQuantity"], ["F", "currentQuantity"], ["G", "cumulativeQuantity"], ["H", "unitPrice"],
    ]);
    const extracted = extractCertificateWorkbookData(workbook, inferred.plan);
    expect(inferred.plan.blocks.map((block) => block.target)).toEqual(["CERTIFICATE"]);
    expect(extracted.rows).toHaveLength(1);
    expect(extracted.number).toBe(1);
  });

  it("allows unmapped lines with budgetItemId null and rejects a mapping to another project", () => {
    const unknown = workbookRow({ code: "99", description: "Rubro desconocido" });
    expect(matchCertificateRows([unknown], [budgetItem(budgetA, projectA)], projectA)[0]).toMatchObject({ budgetItemId: null, match: "NEEDS_REVIEW" });
    const lines = buildCertificateImportLines([unknown], [{ sourceRow: 4, budgetItemId: null }], [], projectA);
    expect(lines[0].budgetItemId).toBeNull();
    expect(() => buildCertificateImportLines([unknown], [{ sourceRow: 4, budgetItemId: budgetOther }], [budgetItem(budgetOther, otherProject)], projectA)).toThrow(/partida distinta de esta obra/);
  });

  describe("atomic authenticated database import", () => {
    let db: PGlite;
    beforeEach(async () => {
      db = new PGlite();
      await db.exec(`
        CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
        CREATE SCHEMA auth; CREATE SCHEMA private; CREATE TYPE public.user_role AS ENUM ('admin','administracion');
        CREATE TABLE public.test_context (user_id uuid, empresa_id uuid, is_admin boolean);
        INSERT INTO public.test_context VALUES ('00000000-0000-4000-8000-000000000010','${tenantA}',true);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT user_id FROM public.test_context $$;
        CREATE FUNCTION public.current_empresa_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT empresa_id FROM public.test_context $$;
        CREATE FUNCTION public.is_internal_role(public.user_role[]) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT is_admin FROM public.test_context $$;
        CREATE TABLE public.projects (id uuid PRIMARY KEY, empresa_id uuid NOT NULL);
        CREATE TABLE public.budget_items (id uuid PRIMARY KEY, project_id uuid NOT NULL, code text NOT NULL, description text NOT NULL, unit text, quantity numeric, unit_price numeric, sort_order integer NOT NULL DEFAULT 0);
        CREATE TABLE private.project_certificate_transition_authorizations (transaction_id bigint, certificate_id uuid, user_id uuid, from_status text, to_status text, PRIMARY KEY(transaction_id,certificate_id));
        CREATE TABLE public.project_certificates (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id), numero integer NOT NULL,
          period_start date NOT NULL, period_end date NOT NULL, status text NOT NULL DEFAULT 'BORRADOR', created_by uuid,
          import_fingerprint text, monto_anterior numeric(18,2) NOT NULL DEFAULT 0, monto_presente numeric(18,2) NOT NULL DEFAULT 0,
          UNIQUE(project_id,numero)
        );
        CREATE TABLE public.project_certificate_items (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), certificate_id uuid NOT NULL REFERENCES public.project_certificates(id) ON DELETE CASCADE,
          budget_item_id uuid, codigo text, descripcion text NOT NULL, unidad text, qty_contractual numeric NOT NULL,
          precio_unitario numeric NOT NULL, qty_anterior numeric NOT NULL, qty_presente numeric NOT NULL,
          monto_anterior numeric GENERATED ALWAYS AS (round(qty_anterior*precio_unitario,0)) STORED,
          monto_presente numeric GENERATED ALWAYS AS (round(qty_presente*precio_unitario,0)) STORED, sort_order integer NOT NULL DEFAULT 0
        );
        INSERT INTO public.projects VALUES ('${projectA}','${tenantA}'),('${otherProject}','${tenantA}'),('${foreignProject}','${tenantB}');
        INSERT INTO public.budget_items (id,project_id,code,description,unit,quantity,unit_price) VALUES
          ('${budgetA}','${projectA}','01','Excavación manual','m3',10,1250),
          ('${budgetOther}','${otherProject}','01','Otra obra','m3',10,1250),
          ('${budgetForeign}','${foreignProject}','01','Otra empresa','m3',10,1250);
      `);
      await db.exec(createGuard);
      await db.exec(importMigration);
      await db.exec(forwardMigration);
    });

    it("writes one BORRADOR and its items, and makes a duplicate import idempotent", async () => {
      const created = await importFile(db, projectA, "a", budgetA, 1, 0);
      expect(created).toMatchObject({ numero: 1, already_imported: false });
      const detail = await db.query("SELECT c.status,c.monto_presente,i.qty_anterior,i.qty_presente,i.monto_presente AS line_amount FROM public.project_certificates c JOIN public.project_certificate_items i ON i.certificate_id=c.id WHERE c.id=$1", [created.certificate_id]);
      expect(detail.rows[0]).toMatchObject({ status: "BORRADOR", monto_presente: "2500.00", qty_anterior: "0", qty_presente: "2", line_amount: "2500" });
      const duplicate = await importFile(db, projectA, "a", budgetA, 1, 0);
      expect(duplicate).toMatchObject({ certificate_id: created.certificate_id, already_imported: true });
      const count = await db.query("SELECT count(*)::int AS n FROM public.project_certificates WHERE project_id=$1", [projectA]);
      expect((count.rows[0] as { n: number }).n).toBe(1);
    });

    it("1. Proyecto SIN budget_items -> importar certificado -> PASS", async () => {
      const emptyProject = "00000000-0000-4000-8000-000000000199";
      await db.query(`INSERT INTO public.projects VALUES ('${emptyProject}', '${tenantA}')`);
      const created = await importFile(db, emptyProject, "1", null, 1, 0);
      expect(created).toMatchObject({ numero: 1, already_imported: false });
      const items = await db.query("SELECT budget_item_id, descripcion, qty_presente FROM public.project_certificate_items WHERE certificate_id=$1", [created.certificate_id]);
      expect(items.rows[0]).toMatchObject({ budget_item_id: null, descripcion: "Excavación manual", qty_presente: "2" });
    });

    it("2. Proyecto con budget_items sin match -> certificado entra con budget_item_id NULL", async () => {
      const created = await importFile(db, projectA, "2", null, 2, 0);
      expect(created).toMatchObject({ numero: 2, already_imported: false });
      const items = await db.query("SELECT budget_item_id, descripcion FROM public.project_certificate_items WHERE certificate_id=$1", [created.certificate_id]);
      expect(items.rows[0]).toMatchObject({ budget_item_id: null, descripcion: "Excavación manual" });
    });

    it("3. Proyecto con match seguro -> puede conservar vínculo", async () => {
      const created = await importFile(db, projectA, "3", budgetA, 3, 0);
      expect(created).toMatchObject({ numero: 3, already_imported: false });
      const items = await db.query("SELECT budget_item_id FROM public.project_certificate_items WHERE certificate_id=$1", [created.certificate_id]);
      expect(items.rows[0]).toMatchObject({ budget_item_id: budgetA });
    });

    it("4, 5, 6, 7, 8, 9: Secuencia no correlativa (N°6 -> N°8 -> N°7), qty_anterior > 0 preservado, sin certificados 1-5 ficticios y sin alterar cantidades", async () => {
      const cleanProject = "00000000-0000-4000-8000-000000000188";
      await db.query(`INSERT INTO public.projects VALUES ('${cleanProject}', '${tenantA}')`);

      // 4. DB sin certificados -> importar directamente Certificado N°6 con qty_anterior > 0
      const cert6 = await importFile(db, cleanProject, "6", null, 6, 15);
      expect(cert6).toMatchObject({ numero: 6, already_imported: false });

      // 7. qty_anterior > 0 sin certificados anteriores registrados -> PASS y valor preservado
      // 9. No modificar cantidades del documento para reconciliarlas con la DB
      const cert6Items = await db.query(
        "SELECT c.numero, c.status, c.monto_anterior, c.monto_presente, i.qty_contractual, i.qty_anterior, i.qty_presente, i.precio_unitario, i.monto_anterior AS item_monto_ant, i.monto_presente AS item_monto_pres FROM public.project_certificates c JOIN public.project_certificate_items i ON i.certificate_id=c.id WHERE c.id=$1",
        [cert6.certificate_id]
      );
      expect(cert6Items.rows[0]).toMatchObject({
        numero: 6,
        status: "BORRADOR",
        qty_contractual: "10",
        qty_anterior: "15",
        qty_presente: "2",
        precio_unitario: "1250",
        item_monto_ant: "18750",
        item_monto_pres: "2500",
        monto_anterior: "18750.00",
        monto_presente: "2500.00",
      });

      // 8. No crear certificados 1-5 ficticios
      const certsAfter6 = await db.query("SELECT numero FROM public.project_certificates WHERE project_id=$1 ORDER BY numero", [cleanProject]);
      expect(certsAfter6.rows.map((r) => (r as { numero: number }).numero)).toEqual([6]);

      // 5. Después importar Certificado N°8 -> PASS
      const cert8 = await importFile(db, cleanProject, "8", null, 8, 25);
      expect(cert8).toMatchObject({ numero: 8, already_imported: false });

      // 6. Después importar Certificado N°7 -> PASS
      const cert7 = await importFile(db, cleanProject, "7", null, 7, 20);
      expect(cert7).toMatchObject({ numero: 7, already_imported: false });

      // Verificar que solo existen certificados 6, 7 y 8, y que las cantidades no fueron modificadas
      const allCerts = await db.query("SELECT numero FROM public.project_certificates WHERE project_id=$1 ORDER BY numero", [cleanProject]);
      expect(allCerts.rows.map((r) => (r as { numero: number }).numero)).toEqual([6, 7, 8]);
    });

    it("blocks cross-tenant projects and a budget item belonging to another project", async () => {
      await expect(importFile(db, foreignProject, "c", budgetForeign, 1, 0)).rejects.toThrow(/Obra no encontrada para la empresa/);
      await expect(importFile(db, projectA, "d", budgetOther, 1, 0)).rejects.toThrow(/partidas inválidas o vinculadas a otra obra/);
      const count = await db.query("SELECT count(*)::int AS n FROM public.project_certificates WHERE project_id=$1", [projectA]);
      expect((count.rows[0] as { n: number }).n).toBe(0);
    });
  });
});

async function importFile(db: PGlite, projectId: string, fingerprintChar: string, budgetId: string | null, number: number, previous: number) {
  const result = await db.query(
    "SELECT * FROM public.import_project_certificate_atomically($1,$2,'2026-09-01','2026-09-30',$3,$4::jsonb)",
    [projectId, number, fingerprintChar.repeat(64), JSON.stringify([{ budget_item_id: budgetId, codigo: "01", descripcion: "Excavación manual", unidad: "m3", qty_contractual: 10, precio_unitario: 1250, qty_anterior: previous, qty_presente: 2, sort_order: 0 }])],
  );
  return result.rows[0] as { certificate_id: string; numero: number; already_imported: boolean };
}

function makeXlsx() {
  const content = XLSX.write({ SheetNames: ["Certificado"], Sheets: { Certificado: XLSX.utils.aoa_to_sheet([
    ["CERTIFICADO Nro. 1"], ["Período: desde 01/09/2026 hasta 30/09/2026"],
    ["Código", "Descripción", "Unidad", "Cantidad contractual", "Cantidad anterior", "Cantidad presente", "Cantidad acumulada", "P.U.", "Monto presente"],
    ["01", "Excavación manual", "m3", 10, 0, 2, 2, 1250, 2500],
  ]) } }, { type: "buffer", bookType: "xlsx" });
  return new Uint8Array(content);
}

function plan() {
  const mapping = (column: string, role: string) => ({ column, role, confidence: 1, notes: "" });
  return { workbookType: "CONSTRUCTION_PROJECT", overallConfidence: 1, blocks: [{
    id: "certificate", sheet: "Certificado", sourceRange: "A3:I4", target: "CERTIFICATE", confidence: 1, needsReview: false,
    headerRowStart: 3, headerRowEnd: 3, dataRowStart: 4, dataRowEnd: 4,
    columnMappings: [mapping("A","code"),mapping("B","description"),mapping("C","unit"),mapping("D","quantity"),mapping("E","previousQuantity"),mapping("F","currentQuantity"),mapping("G","cumulativeQuantity"),mapping("H","unitPrice"),mapping("I","value")],
    repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "",
  }], unresolvedRegions: [], warnings: [] };
}

function workbookRow(overrides: Partial<CertificateWorkbookRow> = {}): CertificateWorkbookRow {
  return { sourceRow: 4, code: "01", description: "Excavación manual", unit: "m3", quantityContractual: 10, quantityPrevious: 0, quantityCurrent: 2, quantityCumulative: 2, unitPrice: 1250, amountPrevious: null, amountCurrent: null, ...overrides };
}

function budgetItem(id: string, project_id: string): CertificateBudgetItem {
  return { id, project_id, code: "01", description: "Excavación manual", unit: "m3", quantity: 10, unit_price: 1250, sort_order: 0 };
}
