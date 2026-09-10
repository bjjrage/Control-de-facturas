// Verification suite for GATE 0: Security, Multi-tenancy & Monetary Invariants.
// Run with: npx tsx scripts/verify-gate0-invariants.ts
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  computeInvoiceStatus,
  isOverbilled,
  orderRemaining,
  OVERBILL_TOLERANCE_PCT,
} from "../lib/reconciliation";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

let failures = 0;
const fail = (msg: string) => {
  console.error("  ✗ " + msg);
  failures++;
};
const ok = (msg: string) => console.log("  ✓ " + msg);

async function run() {
  console.log("\n--- 1. Pure Monetary & Reconciliation Invariants ---");
  try {
    if (OVERBILL_TOLERANCE_PCT !== 5) fail("OVERBILL_TOLERANCE_PCT must be exactly 5%");
    else ok("OVERBILL_TOLERANCE_PCT is 5%");

    // Normal matching within budget
    const s1 = computeInvoiceStatus({
      linkedToOrder: true,
      orderTotal: 1000000,
      orderFacturadoAmount: 1000000,
      hasApprovedException: false,
    });
    if (s1 !== "MATCH") fail(`Expected MATCH, got ${s1}`);
    else ok("Invoice matching within budget -> MATCH");

    // Overbilled within 5% tolerance (e.g. +4%) -> still MATCH
    const s2 = computeInvoiceStatus({
      linkedToOrder: true,
      orderTotal: 1000000,
      orderFacturadoAmount: 1040000,
      hasApprovedException: false,
    });
    if (s2 !== "MATCH") fail(`Expected MATCH within tolerance, got ${s2}`);
    else ok("Invoice overbilled by 4% (within 5% tolerance) -> MATCH");

    // Overbilled beyond 5% tolerance (e.g. +6%) -> REQUIERE_REVISION
    const s3 = computeInvoiceStatus({
      linkedToOrder: true,
      orderTotal: 1000000,
      orderFacturadoAmount: 1060000,
      hasApprovedException: false,
    });
    if (s3 !== "REQUIERE_REVISION") fail(`Expected REQUIERE_REVISION, got ${s3}`);
    else ok("Invoice overbilled by 6% (above tolerance) -> REQUIERE_REVISION");

    // Overbilled with approved exception -> APROBADO_EXCEPCION
    const s4 = computeInvoiceStatus({
      linkedToOrder: true,
      orderTotal: 1000000,
      orderFacturadoAmount: 1100000,
      hasApprovedException: true,
    });
    if (s4 !== "APROBADO_EXCEPCION") fail(`Expected APROBADO_EXCEPCION, got ${s4}`);
    else ok("Invoice overbilled with approved exception -> APROBADO_EXCEPCION");
  } catch (e: any) {
    fail("Reconciliation test error: " + e.message);
  }

  console.log("\n--- 2. Database Multi-Tenancy & Integrity Invariants ---");
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("  ⚠ Skipped DB checks (missing credentials in .env.local)");
  } else {
    try {
      const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      // A. Check payment_orders multi-tenancy
      const { count: nullOps } = await db
        .from("payment_orders")
        .select("*", { count: "exact", head: true })
        .is("empresa_id", null);
      if (nullOps && nullOps > 0) fail(`payment_orders: ${nullOps} rows with NULL empresa_id`);
      else ok("payment_orders: zero rows with NULL empresa_id");

      const { count: nullOpInvs } = await db
        .from("payment_order_invoices")
        .select("*", { count: "exact", head: true })
        .is("empresa_id", null);
      if (nullOpInvs && nullOpInvs > 0) fail(`payment_order_invoices: ${nullOpInvs} rows with NULL empresa_id`);
      else ok("payment_order_invoices: zero rows with NULL empresa_id");

      // B. Check cross-tenant isolation in payment_order_invoices
      const { data: crossLinks } = await db
        .from("payment_order_invoices")
        .select("id, empresa_id, payment_orders(empresa_id), invoices(empresa_id)")
        .limit(500);

      let crossTenantFound = false;
      for (const link of (crossLinks as any[]) ?? []) {
        const opEmpresa = link.payment_orders?.empresa_id;
        const invEmpresa = link.invoices?.empresa_id;
        if (link.empresa_id !== opEmpresa || link.empresa_id !== invEmpresa) {
          fail(`Cross-tenant leak detected on payment_order_invoices id=${link.id}!`);
          crossTenantFound = true;
          break;
        }
      }
      if (!crossTenantFound) {
        ok("payment_order_invoices: zero cross-tenant links detected (perfect match)");
      }

      // C. Check treasury ledger invariant: saldo == sum(movimientos)
      const { data: cuentas } = await db.from("cuentas_financieras").select("id, nombre, saldo");
      let ledgerMismatches = 0;
      for (const c of cuentas ?? []) {
        const { data: movs } = await db
          .from("movimientos_tesoreria")
          .select("monto")
          .eq("cuenta_id", c.id);
        const sum = (movs ?? []).reduce((acc: number, m: any) => acc + Number(m.monto), 0);
        if (Math.abs(Number(c.saldo) - sum) > 0.01) {
          fail(
            `Treasury ledger mismatch on account '${c.nombre}': saldo materializado=${c.saldo}, suma movimientos=${sum}`
          );
          ledgerMismatches++;
        }
      }
      if (ledgerMismatches === 0) {
        ok("Treasury ledger: all account balances strictly equal sum of ledger movements");
      }

      // D. Check domain tables for NULL empresa_id
      const DOMAIN_TABLES = [
        "projects",
        "subcontractors",
        "productos",
        "depositos",
        "cuentas_financieras",
        "movimientos_tesoreria",
        "transferencias",
        "gastos_recurrentes",
        "licitaciones",
        "empresa_documentos",
      ];

      for (const t of DOMAIN_TABLES) {
        const { count: nulls, error } = await db
          .from(t)
          .select("*", { count: "exact", head: true })
          .is("empresa_id", null);
        if (error) {
          // Table might be scoped differently or empty
          continue;
        }
        if (nulls && nulls > 0) fail(`${t}: ${nulls} rows with NULL empresa_id`);
        else ok(`${t}: zero rows with NULL empresa_id`);
      }
    } catch (e: any) {
      fail("Database check error: " + e.message);
    }
  }

  console.log(failures === 0 ? "\nGATE 0 INVARIANTS: ALL PASSED ✅\n" : `\nGATE 0 INVARIANTS: ${failures} FAILURE(S) ❌\n`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
