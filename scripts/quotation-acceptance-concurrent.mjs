/**
 * quotation-acceptance-concurrent.mjs — Prueba de doble aceptación concurrente
 * real contra un branch seguro (PUNTO 4/12).
 *
 * Uso (SOLO branch con 0090+0091 aplicadas, NUNCA producción):
 *   $env:SMOKE_SUPABASE_URL="https://<branch>.supabase.co"
 *   $env:SMOKE_ANON_KEY="<anon key del branch>"
 *   $env:SMOKE_SERVICE_KEY="<service_role del branch>"
 *   $env:SMOKE_EMPRESA_ID="<uuid empresa de prueba>"
 *   $env:SMOKE_CLIENT_ID="<uuid cliente de prueba>"
 *   node scripts/quotation-acceptance-concurrent.mjs
 *
 * Flujo:
 *  1. Crea PROFORMA + ítem + token (vía service_role) y la deja PENDING.
 *  2. Verifica superficie mínima: anon YA NO puede invocar accept_quotation
 *     (0092 revocó anon/authenticated; el portal trabaja server-side con
 *     service_role y el token como capacidad). Un intento anon debe fallar.
 *  3. Dispara N=10 llamadas CONCURRENTES a accept_quotation vía service_role
 *     (mismo RPC/constraints/locks que usaría el portal): misma capacidad,
 *     mismo instante.
 *  4. Aserta: exactamente 1 acceptance record, 1 OT, 1 numeración OT;
 *     todas las respuestas ok son already_accepted=true salvo una.
 *  5. Limpia los datos de prueba.
 *
 * La garantía no depende del timing ni del rol: UNIQUE(acceptances.
 * sales_document_id) + UNIQUE(work_orders.sales_document_id) + locks
 * FOR UPDATE en el RPC.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "crypto";

const URL = process.env.SMOKE_SUPABASE_URL;
const ANON = process.env.SMOKE_ANON_KEY;
const SERVICE = process.env.SMOKE_SERVICE_KEY;
const EMPRESA = process.env.SMOKE_EMPRESA_ID;
const CLIENT = process.env.SMOKE_CLIENT_ID;

function assert(cond, msg) {
  if (!cond) {
    console.error("ASSERT FAIL:", msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

if (!URL || !ANON || !SERVICE || !EMPRESA || !CLIENT) {
  console.error("Faltan envs SMOKE_SUPABASE_URL/ANON_KEY/SERVICE_KEY/EMPRESA_ID/CLIENT_ID. Abortado sin tocar nada.");
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const pub = createClient(URL, ANON, { auth: { persistSession: false } });

const raw = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(raw, "utf8").digest("hex");

// 1. Fixture vía service_role.
const { data: prof } = await admin.from("profiles").select("id").eq("empresa_id", EMPRESA).limit(1).single();
assert(prof, "sin profiles en la empresa de prueba");
const { data: doc, error: docErr } = await admin
  .from("sales_documents")
  .insert({ empresa_id: EMPRESA, client_id: CLIENT, doc_type: "PROFORMA", currency: "PYG", notes: "SMOKE concurrent", created_by: prof.id })
  .select("id, quotation_version")
  .single();
assert(!docErr && doc, "crear proforma: " + docErr?.message);
await admin.from("sales_document_items").insert({
  sales_document_id: doc.id, description: "SMOKE conc", quantity: 1, unit_price: 10000, vat_rate: 10, line_total: 10000,
});
// Sin recompute explícito: trg_sales_items_recompute (0020) recalcula solo
// tras el INSERT del ítem, igual que en el flujo real de la app.
const { data: docNow } = await admin.from("sales_documents").select("quotation_version").eq("id", doc.id).single();
await admin.from("sales_quotation_tokens").insert({
  empresa_id: EMPRESA, sales_document_id: doc.id, quotation_version: docNow.quotation_version,
  token_hash: hash, token_prefix: raw.slice(0, 8),
});
await admin.from("sales_documents").update({ acceptance_status: "PENDING_ACCEPTANCE" }).eq("id", doc.id);

// 2. Superficie mínima: anon no puede invocar el RPC (0092).
const anonTry = await pub.rpc("accept_quotation", { p_token_hash: hash, p_acceptor_name: "Anon" });
assert(anonTry.error, "anon debería tener denegado accept_quotation");
console.log("OK: anon denegado (" + (anonTry.error?.message ?? "sin mensaje") + ")");

// 3. N aceptaciones concurrentes vía service_role (mismo RPC del portal).
const N = 10;
const results = await Promise.all(
  Array.from({ length: N }, (_, i) =>
    admin.rpc("accept_quotation", {
      p_token_hash: hash, p_acceptor_name: `Concurrente ${i}`, p_ip: "198.51.100.7", p_user_agent: "smoke-conc/1.0",
    }).then(
      (r) => ({ ok: !r.error, data: r.data, error: r.error?.message ?? null }),
      (e) => ({ ok: false, data: null, error: String(e?.message ?? e) })
    )
  )
);
const oks = results.filter((r) => r.ok);
console.log(`respuestas ok: ${oks.length}/${N}; errores: ${results.filter((r) => !r.ok).map((r) => r.error).join(" | ") || "-"}`);
assert(oks.length === N, "todas las llamadas concurrentes deben responder ok (una acepta, el resto idempotente)");
const fresh = oks.filter((r) => r.data && r.data.already_accepted === false);
assert(fresh.length === 1, `exactamente 1 aceptación fresca, hubo ${fresh.length}`);

// 3. Una sola fila en cada tabla + una sola numeración OT.
const [{ count: nAcc }, { count: nWo }, { data: wos }] = await Promise.all([
  admin.from("sales_quotation_acceptances").select("id", { count: "exact", head: true }).eq("sales_document_id", doc.id),
  admin.from("work_orders").select("id", { count: "exact", head: true }).eq("sales_document_id", doc.id),
  admin.from("work_orders").select("id, code").eq("sales_document_id", doc.id),
]);
assert(nAcc === 1, `acceptance records: ${nAcc}`);
assert(nWo === 1, `work orders: ${nWo}`);
assert(new Set(wos.map((w) => w.code)).size === 1, "una sola numeración OT");
console.log(`OK: 1 acceptance, 1 OT (${wos[0].code}), ${N} requests concurrentes sin duplicados`);

// 4. Cierre: la cadena aceptada queda bloqueada como evidencia permanente
// (acceptance append-only + FKs RESTRICT impiden borrar doc/ítems/token/OT).
// Solo los eventos son eliminables; se informa el doc para verificación.
await admin.from("sales_quotation_events").delete().eq("sales_document_id", doc.id);
console.log(`Evidencia permanente: doc=${doc.id} ot=${wos[0].code} (cadena aceptada bloqueada por diseño)`);
