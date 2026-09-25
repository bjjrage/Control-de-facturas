import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260925022102_batch6_project_scope_guards.sql"),
  "utf8",
);
const bimSection = readFileSync(resolve(process.cwd(), "app/(internal)/projects/[id]/bim-section.tsx"), "utf8");
const certificateActions = readFileSync(resolve(process.cwd(), "app/(internal)/projects/certificado-actions.ts"), "utf8");
const caterpillarActions = readFileSync(resolve(process.cwd(), "app/(internal)/projects/caterpillar-actions.ts"), "utf8");
const climateActions = readFileSync(resolve(process.cwd(), "app/(internal)/projects/climate-actions.ts"), "utf8");
const caterpillarMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/0030_construccion_caterpillar.sql"), "utf8");
const certificateAnnexesMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/0041_project_certificate_annexes.sql"), "utf8");

describe("Batch 6 project-operation contracts", () => {
  it("presents IFC and Excel/PDF as parallel compute sources with one human review path", () => {
    expect(bimSection).toContain("OPCIÓN A · MODELO BIM / IFC");
    expect(bimSection).toContain("OPCIÓN B · CÓMPUTO EXCEL/PDF");
    expect(bimSection).toContain("matching, revisión humana y presupuesto");
    expect(bimSection).toContain("ninguno genera ejecución ni certificados automáticamente");
    expect(bimSection).not.toContain("CÓMPUTO SIN MODELO BIM");
  });

  it("resyncs draft certificate measurements through one locked transaction", () => {
    expect(certificateActions).toContain('supabase.rpc("resync_project_certificate_quantities_atomically"');
    expect(migration).toContain("BEFORE INSERT OR UPDATE ON public.project_certificate_items");
    expect(migration).toContain("FOR UPDATE OF c");
    expect(migration).toContain("v_status <> 'BORRADOR'");
    expect(migration).toContain("La lista de cantidades no coincide con las líneas del certificado");
  });

  it("keeps subcontract references within one project and serializes the approval ceiling", () => {
    expect(caterpillarActions).toContain('.eq("id", budgetItemId)');
    expect(caterpillarActions).toContain('.eq("project_id", projectId)');
    expect(caterpillarActions).toContain('supabase.rpc("approve_subcontractor_certificate_atomically"');
    expect(caterpillarActions).toContain('supabase.rpc("reject_subcontractor_certificate_atomically"');
    expect(caterpillarActions).not.toContain('.from("subcontractor_certificates").update(');
    expect(migration).toContain("guard_subcontractor_contract_project_scope");
    expect(migration).toContain("guard_subcontractor_certificate_project_scope");
    expect(migration).toContain("FOR UPDATE;\n  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato no encontrado para el proyecto'");
    expect(migration).toContain("v_other_approved + p_approved_amount > v_contracted_amount");
    expect(migration).toContain("REVOKE UPDATE ON TABLE public.subcontractor_certificates");
    expect(migration).toContain("GRANT UPDATE (ai_flags) ON TABLE public.subcontractor_certificates TO service_role");
  });

  it("rejects climate evidence links that point outside the selected project", () => {
    expect(climateActions).toContain('from("climate_events")');
    expect(climateActions).toContain('from("project_workday_status")');
    expect(climateActions).toContain('.eq("project_id", input.projectId)');
  });

  it("keeps existing personnel records scoped without changing the module", () => {
    expect(caterpillarActions).toContain('.from("projects")');
    expect(caterpillarActions).toContain('.eq("id", projectId)');
    expect(caterpillarActions).toContain('.eq("empresa_id", empresaId)');
    expect(caterpillarMigration).toContain("CREATE POLICY labor_entries_insert ON public.daily_labor_entries");
    expect(caterpillarMigration).toContain("project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())");
    expect(certificateAnnexesMigration).toContain("create policy project_certificate_staff_insert on public.project_certificate_staff");
    expect(certificateAnnexesMigration).toContain("join public.projects p on p.id = c.project_id");
    expect(certificateAnnexesMigration).toContain("where p.empresa_id = public.current_empresa_id()");
  });

  it("does not turn subcontractor certificate approval into payment", () => {
    const approval = migration.match(/CREATE OR REPLACE FUNCTION public\.approve_subcontractor_certificate_atomically\([\s\S]*?\n\$\$;/)?.[0] ?? "";
    expect(approval).toContain("SET status = 'APROBADO'");
    expect(approval).not.toContain("SET status = 'PAGADO'");
    expect(approval).not.toContain("movimientos_tesoreria");
  });
});
