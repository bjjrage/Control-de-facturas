import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260913230000_inventory_panol.sql"),
  "utf8",
);
const receiptMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924074417_canonical_purchase_receipt_flow.sql"),
  "utf8",
);

describe("0080 inventory migration contract", () => {
  it("fails closed when legacy cost evidence is unavailable", () => {
    expect(migration).toContain("IF to_regclass('public.cost_observations') IS NULL");
    expect(migration).toContain("LEGACY_COST_EVIDENCE_TABLE_MISSING");
    expect(migration).toContain("LEGACY_FOREIGN_COST_REQUIRES_FX");
    expect(migration).toContain("LEGACY_COST_CURRENCY_UNKNOWN");
  });

  it("does not leave inventory SECURITY DEFINER objects callable by anon", () => {
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.inventory_locations",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.resolve_legacy_inventory_cost(uuid, uuid, numeric) FROM anon, authenticated;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.inventory_post_movement(",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.inventory_confirm_receipt(uuid, uuid, uuid, text, uuid) FROM anon;",
    );
  });
});

describe("canonical purchase receipt migration contract", () => {
  const legacyBackfill = receiptMigration.split(
    "CREATE OR REPLACE FUNCTION public.inventory_create_receipt(",
  )[0];
  const createReceipt = receiptMigration
    .split("CREATE OR REPLACE FUNCTION public.inventory_create_receipt(")[1]
    ?.split("\n$$;")[0] ?? "";
  const movementGuard = receiptMigration
    .split("CREATE OR REPLACE FUNCTION public.enforce_confirmed_canonical_oc_receipt_movement()")[1]
    ?.split("\n$$;")[0] ?? "";
  const confirmReceipt = receiptMigration
    .split("CREATE OR REPLACE FUNCTION public.inventory_confirm_receipt(")[1]
    ?.split("\n$$;")[0] ?? "";

  it("counts only tenant-matched confirmed receipt lines in the invoker view", () => {
    const view = receiptMigration
      .split("CREATE OR REPLACE VIEW public.oc_order_item_recibido")[1]
      ?.split("CREATE OR REPLACE FUNCTION public.enforce_confirmed_canonical_oc_receipt_movement()")[0] ?? "";
    expect(view).toContain("WITH (security_invoker = true) AS");
    expect(view).toContain("AND r.empresa_id = ri.empresa_id");
    expect(view).toContain("WHERE r.status = 'CONFIRMED'");
  });

  it("promotes only legacy receipts whose old stock movements reconcile exactly", () => {
    expect(legacyBackfill).toContain("AND r.idempotency_key IS NULL");
    expect(legacyBackfill).toContain("AND il.active");
    expect(legacyBackfill).toContain("FULL JOIN");
    expect(legacyBackfill).toContain("sm.referencia_id = r.id");
    expect(legacyBackfill).toContain("expected.expected_quantity IS DISTINCT FROM actual.actual_quantity");
    expect(legacyBackfill).not.toContain("INSERT INTO public.inventory_movements");
  });

  it("removes direct authenticated writes and limits receipt deletion to safe drafts", () => {
    expect(receiptMigration).toContain('DROP POLICY IF EXISTS "insert oc_recepciones"');
    expect(receiptMigration).toContain('DROP POLICY IF EXISTS "insert oc_recepcion_items"');
    expect(receiptMigration).toContain("AND status = 'DRAFT'");
    expect(receiptMigration).toContain("public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])");
    expect(receiptMigration).toContain("OLD.idempotency_key IS NULL");
    expect(receiptMigration).toContain("OLD.status IS DISTINCT FROM 'DRAFT'");
  });

  it("creates a receipt atomically with a locked idempotency key and payload comparison", () => {
    expect(createReceipt).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(createReceipt).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(createReceipt).toContain("v_stored_items IS DISTINCT FROM v_requested_items");
    expect(createReceipt).toContain("INSERT INTO public.oc_recepciones");
    expect(createReceipt).toContain("INSERT INTO public.oc_recepcion_items");
    expect(createReceipt).not.toContain("inventory_post_movement");
  });

  it("rejects OC movements unless their confirmed source line matches exactly", () => {
    expect(receiptMigration).toContain("BEFORE INSERT OR UPDATE ON public.inventory_movements");
    expect(movementGuard).toContain("v_receipt.status IS DISTINCT FROM 'CONFIRMED'");
    expect(movementGuard).toContain("v_receipt.idempotency_key IS NULL");
    expect(movementGuard).toContain("v_receipt.producto_id IS DISTINCT FROM NEW.producto_id");
    expect(movementGuard).toContain("v_receipt.cantidad_recibida IS DISTINCT FROM NEW.quantity");
    expect(movementGuard).toContain("v_receipt.delivery_location_id IS DISTINCT FROM NEW.to_location_id");
  });

  it("keeps confirmed receipt lines immutable except for their exact movement link", () => {
    expect(receiptMigration).toContain("BEFORE INSERT OR UPDATE OR DELETE ON public.oc_recepcion_items");
    expect(receiptMigration).toContain("OLD.inventory_movement_id IS NULL");
    expect(receiptMigration).toContain("NEW.inventory_movement_id IS NOT NULL");
    expect(receiptMigration).toContain("m.source_line_id = NEW.id");
    expect(receiptMigration).toContain("m.quantity = NEW.cantidad_recibida");
    expect(receiptMigration).toContain("m.status = 'CONFIRMED'");
  });

  it("confirms inside the same transaction before posting and skips non-stock lines", () => {
    expect(confirmReceipt).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(confirmReceipt).toContain("v_receipt.status = 'DRAFT' AND v_receipt.idempotency_key IS NULL");
    expect(confirmReceipt).toContain("nullif(trim(p_idempotency_key), '') IS DISTINCT FROM v_receipt.idempotency_key");
    const stateChange = confirmReceipt.indexOf("UPDATE public.oc_recepciones");
    const movementPost = confirmReceipt.indexOf("public.inventory_post_movement(");
    expect(stateChange).toBeGreaterThanOrEqual(0);
    expect(movementPost).toBeGreaterThan(stateChange);
    expect(confirmReceipt).toContain("IF v_item.producto_id IS NULL THEN\n      CONTINUE;");
  });
});
