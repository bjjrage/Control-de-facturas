import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260913235000_inventory_p1_hardening.sql"),
  "utf8"
);
const actions = readFileSync(
  resolve(process.cwd(), "app/(internal)/inventory/actions.ts"),
  "utf8"
);

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
    expect(migration).toContain("FROM public.authorized_orders\n    WHERE id = v_receipt_order AND empresa_id = p_empresa_id\n    FOR UPDATE");
    expect(migration).toContain("sum(ri.cantidad_recibida) AS receipt_quantity");
    expect(migration).toContain("v_received_quantity");
    expect(migration).toContain("IF p_quantity > v_ordered_quantity - v_received_quantity THEN");
    expect(migration).toContain("HAVING count(*) > 1");
    expect(migration).toContain("No se puede repetir un ítem de OC dentro de una recepción");
    expect(actions).toContain("new Set(requestedOrderItemIds).size !== requestedOrderItemIds.length");
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
});
