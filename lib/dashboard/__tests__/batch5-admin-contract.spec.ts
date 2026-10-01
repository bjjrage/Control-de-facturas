import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260925022101_batch5_admin_treasury_atomicity.sql"),
  "utf8",
);
const dashboardData = readFileSync(resolve(process.cwd(), "app/(internal)/dashboard/data.ts"), "utf8");
const paymentActions = readFileSync(resolve(process.cwd(), "app/(internal)/pagos/actions.ts"), "utf8");
const paymentDetail = readFileSync(resolve(process.cwd(), "app/(internal)/pagos/[id]/page.tsx"), "utf8");
const paymentDialog = readFileSync(resolve(process.cwd(), "app/(internal)/pagos/[id]/execute-button.tsx"), "utf8");
const salesActions = readFileSync(resolve(process.cwd(), "app/(internal)/ventas/actions.ts"), "utf8");
const rfqActions = readFileSync(resolve(process.cwd(), "app/(internal)/rfqs/[id]/actions.ts"), "utf8");
const treasuryActions = readFileSync(resolve(process.cwd(), "app/(internal)/tesoreria/actions.ts"), "utf8");

describe("Batch 5 financial safety contract", () => {
  it("uses canonical global inventory and includes approved certificates in dashboard cashflow", () => {
    expect(dashboardData).toContain('.from("inventory_stock_global_quantity")');
    expect(dashboardData).not.toContain('.select("id, nombre, stock_actual, stock_minimo, activo")');
    expect(dashboardData).toContain('.from("project_certificates")');
    expect(dashboardData).toContain('.in("status", ["APROBADO", "FACTURADO"])');
    expect(dashboardData).toContain("stockSourceUnavailable:");
  });

  it("makes payment execution and receipt reversal fail closed through their atomic RPCs", () => {
    expect(paymentActions).toContain('supabase.rpc("ejecutar_orden_pago_atomica"');
    expect(paymentActions).toContain("if (rpcError) return { error: rpcError.message }");
    expect(paymentActions).not.toContain("function') && rpcError.message?.includes('does not exist");
    expect(salesActions).toContain('supabase.rpc("registrar_cobro_atomico"');
    expect(salesActions).toContain('supabase.rpc("revertir_cobro_atomico"');
    expect(salesActions).not.toContain('.from("sales_receipts").delete()');
    expect(salesActions).not.toContain('.from("sales_receipts").insert(');
    expect(salesActions).toContain("El cobro se registró, pero no se pudo verificar su lectura posterior.");
    expect(salesActions).toContain("La reversa se ejecutó, pero no se pudo verificar su lectura posterior.");
  });

  it("offers only currency-compatible treasury accounts and blocks mixed-currency payment orders", () => {
    expect(paymentDetail).toContain("cuenta.moneda === paymentCurrency");
    expect(paymentDialog).toContain("disabled={hasMixedCurrencies}");
    expect(paymentDialog).toContain("invoiceCurrencies.length > 1");
  });

  it("routes RFQ authorization and account opening through transaction RPCs", () => {
    expect(rfqActions).toContain('supabase.rpc("select_and_authorize_offer_atomically"');
    expect(rfqActions).not.toContain('.from("authorized_orders").insert(');
    expect(treasuryActions).toContain('supabase.rpc("crear_cuenta_financiera_atomica"');
    expect(treasuryActions).not.toContain('supabase.from("cuentas_financieras").insert(');
  });

  it("enforces ledger immutability, tenant gates, pinned search paths and explicit grants", () => {
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON public.movimientos_tesoreria");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.movimientos_tesoreria");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS reversal_of_movement_id");
    expect(migration).toContain("uq_movimientos_tesoreria_reversal_of");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.next_doc_code(p_empresa_id uuid, p_doc_type text)");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.next_doc_code(uuid, text) FROM PUBLIC, anon, authenticated");
    expect(migration).not.toContain("op_code_seq");
    expect(migration).toContain("CREATE POLICY cuentas_fin_update_admin");
    expect(migration).toContain("public.current_empresa_id() IS DISTINCT FROM p_empresa_id");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("La moneda de la cuenta no coincide con la del documento");
    expect(migration).toContain("La moneda de la cuenta no coincide con todas las facturas de la OP");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO authenticated");
  });
});
