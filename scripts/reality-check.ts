import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const env = Object.fromEntries(
    fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );

  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  console.log("================================================================================");
  console.log("FASE F: TARGETED REALITY CHECK (RAW DNCP VS RELATIONAL DB)");
  console.log("================================================================================\n");

  // 1. Contrato con adenda de monto (ej. 371560)
  console.log("--- [1] CONTRATO CON ADENDA DE MONTO (ID 371560) ---");
  const { data: p371560 } = await supabase.from("procurement_processes").select("id, ocid, monto_referencial, monto_disponible").ilike("ocid", "%371560%").single();
  if (!p371560) throw new Error("p371560 not found");
  const { data: c371560 } = await supabase.from("procurement_contracts").select("id, numero_contrato, monto_contrato_original, monto_contrato_vigente, total_amendment_amount_delta, amendment_count").eq("process_id", p371560.id).single();
  if (!c371560) throw new Error("c371560 not found");
  const { data: a371560 } = await supabase.from("procurement_contract_amendments").select("amendment_dncp_id, tipo, monto_delta, dncp_amendment_type_raw").eq("contract_id", c371560.id);

  console.log("Process OCID:", p371560.ocid);
  console.log("Presupuesto Referencial (Tender):", p371560.monto_referencial);
  console.log("Contrato Original:", c371560.monto_contrato_original);
  console.log("Adendas:", a371560);
  console.log("Delta Total de Adendas:", c371560.total_amendment_amount_delta);
  console.log("Monto Vigente Final:", c371560.monto_contrato_vigente);
  console.log("INVARIANTE ECONÓMICA RESPETADA (Orig + Delta = Vigente):", 
    Number(c371560.monto_contrato_original) + Number(c371560.total_amendment_amount_delta) === Number(c371560.monto_contrato_vigente));

  // 2. Contrato con extensión de plazo
  console.log("\n--- [2] CONTRATO CON EXTENSIÓN DE PLAZO ---");
  const { data: termAmend } = await supabase.from("procurement_contract_amendments").select("contract_id, amendment_dncp_id, tipo, dncp_amendment_type_raw, descripcion").eq("tipo", "TERM_EXTENSION").limit(1).single();
  if (!termAmend) throw new Error("termAmend not found");
  const { data: termContract } = await supabase.from("procurement_contracts").select("id, numero_contrato, duracion_dias_original, duracion_dias_vigente, total_amendment_duration_delta_days, amendment_count").eq("id", termAmend.contract_id).single();
  if (!termContract) throw new Error("termContract not found");
  console.log("Contrato con prórroga:", termContract.numero_contrato);
  console.log("Tipo de adenda oficial:", termAmend.dncp_amendment_type_raw || termAmend.descripcion);
  console.log("Duración original (días):", termContract.duracion_dias_original, "Vigente:", termContract.duracion_dias_vigente);

  // 3. Proceso Multi-bidder
  console.log("\n--- [3] PROCESO MULTI-BIDDER ---");
  const { data: bids } = await supabase.from("procurement_bids").select("process_id");
  const bidsPerProc: Record<string, number> = {};
  for (const b of bids || []) bidsPerProc[b.process_id] = (bidsPerProc[b.process_id] || 0) + 1;
  const multiBidProcId = Object.keys(bidsPerProc).find(id => bidsPerProc[id] > 3);
  if (!multiBidProcId) throw new Error("multiBidProcId not found");
  const { data: mbProc } = await supabase.from("procurement_processes").select("ocid, titulo").eq("id", multiBidProcId).single();
  if (!mbProc) throw new Error("mbProc not found");
  const { count: mbBidsCount } = await supabase.from("procurement_bids").select("*", { count: "exact", head: true }).eq("process_id", multiBidProcId);
  console.log("Proceso:", mbProc.ocid, "|", mbProc.titulo);
  console.log("Total oferentes registrados en DB:", mbBidsCount);

  // 4. Consorcios
  console.log("\n--- [4] CONSORCIOS DETECTADOS ---");
  const { data: consortia } = await supabase.from("procurement_suppliers").select("ruc_clean, nombre").ilike("nombre", "%CONSORCIO%").limit(3);
  console.log("Muestra de consorcios:", consortia);

  // 5. Proveedor SBE / PYME
  console.log("\n--- [5] PROVEEDOR SBE / PYME ---");
  const { data: smeSupp } = await supabase.from("procurement_suppliers").select("ruc_clean, nombre, tamano").in("tamano", ["sme", "micro"]).limit(3);
  console.log("Muestra SBE:", smeSupp);

  // 6. Proceso Planning-only
  console.log("\n--- [6] PROCESO PLANNING-ONLY (RECONCILIADO VÍA P1) ---");
  const { data: planProc } = await supabase.from("procurement_processes").select("ocid, titulo, estado, moneda, monto_disponible").eq("estado", "PLANNING").limit(1).single();
  console.log("Proceso Planning-only:", planProc);

  // 7. Base64 Item IDs
  console.log("\n--- [7] ÍTEM CON ID BASE64 NATIVO DNCP ---");
  const { data: b64Item } = await supabase.from("procurement_items").select("item_dncp_id, descripcion, cantidad, unidad").like("item_dncp_id", "%==%").limit(1).single();
  console.log("Ítem Base64:", b64Item);
}

main().catch(console.error);