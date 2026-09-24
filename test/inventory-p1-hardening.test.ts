import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

const migration = readSource("supabase/migrations/20260913235000_inventory_p1_hardening.sql");
const actions = readSource("app/(internal)/inventory/actions.ts");
const propagationFix = readSource("supabase/migrations/20260914001000_inventory_p1_transfer_fix.sql");
const auditFix = readSource("supabase/migrations/20260914010000_inventory_final_audit_hardening.sql");
const gateFix = readSource("supabase/migrations/20260914020000_inventory_partial_upload_gate.sql");
const uploadResolution = readSource("supabase/migrations/20260914030000_inventory_partial_upload_resolution.sql");
const portalRoute = readSource("app/api/warehouse-portal/[token]/route.ts");

describe("P1 hardening del inventario canónico", () => {
  it("ata el acceso de Storage al tenant, contexto y path canónico", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.can_read_warehouse_evidence");
    expect(migration).toContain("CREATE POLICY \"internal read warehouse evidence\" ON storage.objects");
    expect(migration).toContain("FOR SELECT TO authenticated");
    expect(migration).toContain("AND public.can_read_warehouse_evidence(name)");
    expect(migration).toContain("e.storage_path = p_object_name");
    expect(migration).toContain("r.empresa_id = v_empresa_id");
    expect(migration).toContain("l.empresa_id = v_empresa_id");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.can_read_warehouse_evidence(text) FROM PUBLIC, anon");
  });

  it("hace atómica la recepción acumulada y rechaza duplicados", () => {
    expect(migration.replace(/\r\n/g, "\n")).toContain("FROM public.authorized_orders\n    WHERE id = v_receipt_order AND empresa_id = p_empresa_id\n    FOR UPDATE");
    expect(migration).toContain("sum(ri.cantidad_recibida) AS receipt_quantity");
    expect(migration).toContain("v_received_quantity");
    expect(migration).toContain("IF p_quantity > v_ordered_quantity - v_received_quantity THEN");
    expect(migration).toContain("HAVING count(*) > 1");
    expect(migration).toContain("No se puede repetir un ítem de OC dentro de una recepción");
    expect(actions).toContain("new Set(args.items.map((item) => item.orderItemId)).size !== args.items.length");
  });

  it("marca revisión cuando falta FX y agrega solo costo compañía computable", () => {
    expect(migration).toContain("v_cost_status := 'REVISION_REQUERIDA'");
    expect(migration).toContain("p_exchange_rate_to_company IS NOT NULL AND p_exchange_rate_to_company > 0");
    expect(migration).toContain("total_cost_company");
    expect(migration).toContain("cost_status = 'COMPUTABLE'");
    expect(migration).toContain("WHERE cost_status = 'COMPUTABLE'");
    expect(migration).toContain("sum(total_cost_company)");
    expect(migration).toContain("total_cost_company IS NOT NULL");
  });

  it("bloquea mutaciones directas de rendiciones confirmadas", () => {
    expect(migration).toContain("prevent_confirmed_warehouse_submission_line_mutation");
    expect(migration).toContain("prevent_confirmed_warehouse_submission_evidence_mutation");
    expect(migration).toContain("IF v_status = 'CONFIRMED' THEN");
    expect(migration).toContain("OLD.inventory_movement_id IS NOT NULL");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OR DELETE ON public.warehouse_submission_lines");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OR DELETE ON public.warehouse_submission_evidence");
    expect(actions).toContain("line.inventory_movement_id");
    expect(actions).toContain("submission?.status === \"CONFIRMED\"");
  });

  it("mantiene el metadato nominal al propagar capas de costo", () => {
    expect(propagationFix).toContain("cost_status, original_cost_currency");
    expect(propagationFix).toContain("original_unit_cost");
    expect(propagationFix).toContain("p_total_cost_company =>");
  });

  it("P1 final audit: hace estrictamente inmutable la cabecera warehouse_submissions confirmada en DB", () => {
    expect(auditFix).toContain("prevent_confirmed_warehouse_submission_mutation");
    expect(auditFix).toContain("BEFORE UPDATE OR DELETE ON public.warehouse_submissions");
    expect(auditFix).toContain("OLD.status = 'CONFIRMED'");
    expect(auditFix).toContain("Una rendición confirmada es inmutable y no puede ser modificada ni reabierta");
    expect(auditFix).toContain("Una rendición confirmada es inmutable y no puede ser eliminada");
  });

  it("P2 final audit: serializa la inserción de líneas con lock FOR UPDATE y numeración atómica", () => {
    expect(auditFix).toContain("inventory_save_submission_lines_atomic");
    expect(auditFix).toContain("FROM public.warehouse_submissions\n  WHERE id = p_submission_id AND empresa_id = p_empresa_id\n  FOR UPDATE;".replace(/\r\n/g, "\n"));
    expect(auditFix).toContain("SELECT coalesce(max(line_number), 0) + 1 INTO v_next_line");
    expect(auditFix).toContain("v_submission.status = 'CONFIRMED'");
    expect(actions).toContain("saveWarehouseSubmissionLinesAtomic");
  });

  it("P2 final audit: portal maneja cargas parciales explícitamente sin presentar falso éxito", () => {
    expect(portalRoute).toContain("const accepted: string[] = [];");
    expect(portalRoute).toContain("const rejected: Array<{ file: string; reason: string }> = [];");
    expect(portalRoute).toContain("partial: true");
    expect(portalRoute).toContain("status: 207");
    expect(portalRoute).toContain("NEEDS_REVIEW");
    expect(portalRoute).toContain("Carga parcial");
  });

  it("P1 partial upload gate: bloquea confirmación fail-closed cuando upload_incomplete = true", () => {
    expect(gateFix).toContain("upload_incomplete boolean NOT NULL DEFAULT false");
    expect(gateFix).toContain("IF v_submission.upload_incomplete THEN");
    expect(gateFix).toContain("RAISE EXCEPTION 'La rendición tiene cargas de archivos incompletas o pendientes';");
    expect(actions).toContain("upload_incomplete");
    expect(actions).toContain("submission.upload_incomplete ? submission.processing_error : null");
  });

  it("P1 partial upload resolution: persiste pendientes estructurados por sha256 y cierra el bypass de UPDATE directo", () => {
    expect(uploadResolution).toContain("pending_uploads jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(uploadResolution).toContain("CREATE OR REPLACE FUNCTION public.inventory_apply_warehouse_upload_result(");
    expect(uploadResolution).toContain("IF auth.role() <> 'service_role' THEN");
    expect(uploadResolution).toContain("RAISE EXCEPTION 'Acceso denegado: sólo el portal de rendiciones puede actualizar el estado de ingestión';");
    expect(uploadResolution).toContain("WHERE NOT (elem ->> 'sha256' = ANY (v_resolved))");
    expect(uploadResolution).toContain("upload_incomplete = (jsonb_array_length(v_pending) > 0)");
    expect(uploadResolution).toContain("GRANT EXECUTE ON FUNCTION public.inventory_apply_warehouse_upload_result(uuid, uuid, text[], jsonb)\n  TO service_role;");
    expect(uploadResolution).toContain("REVOKE UPDATE ON public.warehouse_submissions FROM authenticated;");
    expect(uploadResolution).toContain("GRANT UPDATE (");
    expect(uploadResolution).not.toMatch(/GRANT UPDATE \([^)]*upload_incomplete/);
    expect(uploadResolution).not.toMatch(/GRANT UPDATE \([^)]*pending_uploads/);

    expect(portalRoute).toContain('admin.rpc("inventory_apply_warehouse_upload_result"');
    expect(portalRoute).toContain("resolvedSha256");
    expect(portalRoute).toContain("failedUploads");
    expect(portalRoute).not.toContain("upload_incomplete: true");
    expect(portalRoute).not.toContain("upload_incomplete: false");
  });
});
