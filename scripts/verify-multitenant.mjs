// Post-migration sanity check for 0011_multi_tenant.
// Uses the service-role key (bypasses RLS) to confirm every domain row got an
// empresa_id and every profile is attached to a company.
//   node scripts/verify-multitenant.mjs
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

const TABLES = [
  "providers", "rfqs", "rfq_providers", "attachments", "quotes",
  "quote_versions", "authorized_orders", "invoices",
  "invoice_order_matches", "invoice_exceptions", "audit_logs",
];

let failures = 0;
const fail = (msg) => { console.error("  ✗ " + msg); failures++; };
const ok = (msg) => console.log("  ✓ " + msg);

const { data: empresas, error: eErr } = await db.from("empresas").select("id, nombre, slug");
if (eErr) fail(`no se pudo leer 'empresas': ${eErr.message}`);
else if (!empresas.length) fail("tabla 'empresas' vacía — falta el seed niu.pack");
else ok(`empresas: ${empresas.map((e) => e.nombre).join(", ")}`);

const niupack = empresas?.find((e) => e.slug === "niupack");
if (!niupack) fail("no existe la empresa con slug 'niupack'");

for (const t of TABLES) {
  const { count: total, error: cErr } = await db.from(t).select("*", { count: "exact", head: true });
  if (cErr) { fail(`${t}: ${cErr.message}`); continue; }
  const { count: nulls } = await db.from(t).select("*", { count: "exact", head: true }).is("empresa_id", null);
  if (nulls > 0) fail(`${t}: ${nulls}/${total} filas con empresa_id NULL`);
  else ok(`${t}: ${total} filas, todas con empresa_id`);
}

const { data: orphanProfiles } = await db
  .from("profiles")
  .select("id, email")
  .eq("active", true)
  .is("empresa_id", null);
if (orphanProfiles?.length) fail(`perfiles activos sin empresa: ${orphanProfiles.map((p) => p.email).join(", ")}`);
else ok("todos los perfiles activos tienen empresa");

console.log(failures === 0 ? "\nTODO OK ✅" : `\n${failures} PROBLEMA(S) ❌`);
process.exit(failures === 0 ? 0 : 1);
