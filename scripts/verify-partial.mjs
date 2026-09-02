// Chequeo post-migración 0013 (entregas parciales).
//   node scripts/verify-partial.mjs
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

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
const fail = (m) => { console.error("  ✗ " + m); failures++; };
const ok = (m) => console.log("  ✓ " + m);

const { data: matches } = await db.from("invoice_order_matches").select("invoice_id, authorized_order_id");
const perInvoice = {};
for (const m of matches ?? []) perInvoice[m.invoice_id] = (perInvoice[m.invoice_id] ?? 0) + 1;
const dup = Object.entries(perInvoice).filter(([, n]) => n > 1);
if (dup.length) fail(`facturas con 2+ órdenes vinculadas: ${dup.map(([i]) => i).join(", ")}`);
else ok("ninguna factura vinculada a más de una orden");

const { data: orders } = await db.from("authorized_orders").select("id, code, total_price, facturado_amount, status");
const { data: invoices } = await db.from("invoices").select("id, total");
const invTotal = Object.fromEntries((invoices ?? []).map((i) => [i.id, Number(i.total)]));

for (const o of orders ?? []) {
  const linked = (matches ?? []).filter((m) => m.authorized_order_id === o.id);
  const expected = linked.reduce((s, m) => s + (invTotal[m.invoice_id] ?? 0), 0);
  const got = Number(o.facturado_amount);
  if (Math.round(expected * 100) !== Math.round(got * 100)) {
    fail(`${o.code}: facturado_amount=${got} pero suma de facturas=${expected}`);
  } else {
    ok(`${o.code}: facturado ${got} / ${o.total_price} (${o.status})`);
  }
}

console.log(failures === 0 ? "\nTODO OK ✅" : `\n${failures} PROBLEMA(S) ❌`);
process.exit(failures === 0 ? 0 : 1);
