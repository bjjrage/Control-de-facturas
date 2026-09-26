import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const criticalTables = [
  "empresas",
  "profiles",
  "providers",
  "projects",
  "project_providers",
  "budget_items",
  "execution_entries",
  "rfqs",
  "rfq_providers",
  "quotes",
  "quote_versions",
  "attachments",
  "authorized_orders",
  "authorized_order_items",
  "oc_recepciones",
  "oc_recepcion_items",
  "invoices",
  "invoice_order_matches",
  "invoice_exceptions",
  "payment_orders",
  "payment_order_invoices",
  "cuentas_financieras",
  "movimientos_tesoreria",
  "productos",
  "inventory_movements",
  "subcontractor_certificates",
  "subcontractor_certificate_items",
  "audit_logs",
];

console.log("=================================================================");
console.log("AUDITORIA EN VIVO DE TABLAS Y ESTADO DE LA BASE DE DATOS");
console.log("Target:", env.NEXT_PUBLIC_SUPABASE_URL);
console.log("=================================================================\n");

const results = [];

for (const t of criticalTables) {
  try {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    if (error) {
      results.push({ table: t, status: "ERROR", detail: error.message, count: null });
    } else {
      results.push({ table: t, status: "VIVA (OK)", detail: "Accesible", count });
    }
  } catch (err) {
    results.push({ table: t, status: "CRASH", detail: String(err), count: null });
  }
}

console.log("TABLA".padEnd(34) + "ESTADO".padEnd(16) + "FILAS".padEnd(10) + "DETALLE");
console.log("-".repeat(80));

for (const r of results) {
  const cnt = r.count !== null ? String(r.count) : "-";
  console.log(r.table.padEnd(34) + r.status.padEnd(16) + cnt.padEnd(10) + r.detail);
}

// Check sample data of authorized_orders columns
console.log("\n=================================================================");
console.log("INSPECCION DE COLUMNAS EN authorized_orders (EN VIVO)");
console.log("=================================================================");
const { data: sampleOrder, error: sampleErr } = await sb.from("authorized_orders").select("*").limit(1);
if (sampleErr) {
  console.log("Error consultando authorized_orders:", sampleErr.message);
} else if (sampleOrder && sampleOrder.length > 0) {
  console.log("Columnas existentes en fila real:", Object.keys(sampleOrder[0]));
} else {
  // If 0 rows, check via an empty insert error or column probe
  console.log("Tabla authorized_orders esta vacia (0 filas). Probando lectura de metadatos...");
}

// Check sample data of rfqs columns
console.log("\n=================================================================");
console.log("INSPECCION DE COLUMNAS EN rfqs (EN VIVO)");
console.log("=================================================================");
const { data: sampleRfq, error: rfqErr } = await sb.from("rfqs").select("*").limit(1);
if (rfqErr) {
  console.log("Error consultando rfqs:", rfqErr.message);
} else if (sampleRfq && sampleRfq.length > 0) {
  console.log("Columnas existentes en fila real:", Object.keys(sampleRfq[0]));
}
