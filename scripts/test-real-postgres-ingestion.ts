/**
 * SMOKE & IDEMPOTENCY TEST ON SUPABASE STAGING / TEST
 * 
 * Pipeline:
 * 1. Probar que p_cr funciona realmente en PostgreSQL (named parameter RPC).
 * 2. Ingerir fixture DNCP real 371560 (full payload: compiledRelease + releases).
 * 3. Verificar DB:
 *    - contrato (LP-11001-19-183665, montos original y vigente)
 *    - adenda (371560-ricardo-diaz-martinez-1-ampliacion, delta, tipo)
 *    - items Base64 (17 items con IDs base64 intactos)
 *    - supplier (RICARDO DIAZ MARTINEZ, RUC 310695-0)
 *    - moneda (PYG en todas las entidades)
 *    - release refs (releases_metadata con tags y SHA-256)
 * 4. Ingerir 371560 POR SEGUNDA VEZ.
 * 5. Comprobar idempotencia total (cero duplicados, estado inmutable).
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ [ASSERTION FAILED]: ${message}`);
    throw new Error(message);
  }
}

const envPath = path.resolve(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("ERROR: No existe .env.local en la raíz del proyecto.");
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("ERROR: Faltan variables NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

async function main() {
  console.log("================================================================================");
  console.log("TEST EN SUPABASE STAGING/TEST: P_CR + INGESTIÓN FIXTURE REAL 371560 + IDEMPOTENCIA");
  console.log("================================================================================\n");
  console.log(`Conectando a Supabase URL: ${supabaseUrl}`);

  // ---------------------------------------------------------------------------
  // FASE 1: Probar que p_cr funciona realmente en PostgreSQL
  // ---------------------------------------------------------------------------
  console.log("\n--- FASE 1: Probar que p_cr funciona realmente en PostgreSQL ---");
  
  const minimalTestPayload = {
    compiledRelease: {
      ocid: "ocds-03ad3f-smoke-test-p-cr",
      id: "smoke-test-1",
      date: new Date().toISOString(),
      tender: {
        id: "smoke-tender-1",
        title: "Smoke Test p_cr parameter validation",
        status: "complete",
        value: { amount: 1000000, currency: "PYG" }
      }
    },
    releases: [
      {
        id: "rel-smoke-1",
        date: new Date().toISOString(),
        tag: ["tender"]
      }
    ]
  };

  const { data: testProcessId, error: testErr } = await supabase.rpc(
    "ingestar_proceso_ocds_global",
    {
      p_cr: minimalTestPayload,
      p_fuente: "SMOKE_TEST_P_CR"
    }
  );

  assert(!testErr, `Llamada RPC con p_cr falló: ${testErr?.message} (código: ${testErr?.code})`);
  assert(Boolean(testProcessId), "La función ingestar_proceso_ocds_global debe retornar un UUID válido");
  console.log(`  ✓ RPC con p_cr ejecutado exitosamente en PostgreSQL. UUID retornado: ${testProcessId}`);

  await supabase.from("procurement_processes").delete().eq("id", testProcessId);
  console.log("  ✓ Registro temporal de smoke test limpiado exitosamente.");

  // ---------------------------------------------------------------------------
  // FASE 2: Ingerir Fixture DNCP Real 371560 (Primera Ingestión)
  // ---------------------------------------------------------------------------
  console.log("\n--- FASE 2: Ingerir Fixture DNCP Real 371560 (Primera Ingestión) ---");

  const fixturePath = path.resolve(process.cwd(), "data/reality-spike/371560.json");
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`No se encontró el fixture en ${fixturePath}`);
  }

  const rawData = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const recordItem = rawData.records[0];
  const cr = recordItem.compiledRelease;
  const releases = Array.isArray(recordItem.releases) ? recordItem.releases : [];

  const fullPayload371560 = {
    compiledRelease: cr,
    releases: releases,
    releasesMetadata: {
      count: releases.length,
      releaseType: releases.some((r: any) => r.releaseType === "FULL_RELEASE") ? "FULL_RELEASE" : "RELEASE_INDEX",
      ocid: recordItem.ocid || cr.ocid,
      fetchedAt: new Date().toISOString(),
    }
  };

  console.log(`  Payload preparado: OCID=${cr.ocid}, Licitación="${cr.tender.title}"`);
  console.log(`  Ítems en fixture: ${cr.tender.items?.length}, Contratos: ${cr.contracts?.length}`);

  const startTime1 = Date.now();
  const { data: processId1, error: ingestErr1 } = await supabase.rpc(
    "ingestar_proceso_ocds_global",
    {
      p_cr: fullPayload371560,
      p_fuente: "DNCP_REAL_FIXTURE_371560"
    }
  );

  const duration1 = Date.now() - startTime1;
  assert(!ingestErr1, `Error en primera ingestión de 371560: ${ingestErr1?.message} (${ingestErr1?.code})`);
  assert(Boolean(processId1), "Primera ingestión debe retornar UUID de proceso");
  console.log(`  ✓ Primera Ingestión EXITOSA en ${duration1}ms. Process ID: ${processId1}`);

  // ---------------------------------------------------------------------------
  // FASE 3: Verificar Base de Datos en Detalle
  // ---------------------------------------------------------------------------
  console.log("\n--- FASE 3: Verificar Base de Datos en Detalle ---");

  // 3.1 Proceso y Moneda
  console.log("\n[3.1] Verificando procurement_processes...");
  const { data: procRow, error: procErr } = await supabase
    .from("procurement_processes")
    .select("*")
    .eq("id", processId1)
    .single();

  assert(!procErr, `Error consultando proceso: ${procErr?.message}`);
  assert(procRow.ocid === "ocds-03ad3f-371560-1", `OCID incorrecto: ${procRow.ocid}`);
  assert(procRow.dncp_nro.startsWith("371560"), `DNCP nro incorrecto: ${procRow.dncp_nro}`);
  assert(procRow.moneda === "PYG", `Moneda del proceso debe ser PYG, obtenido: ${procRow.moneda}`);
  console.log(`  ✓ Proceso verificado: OCID=${procRow.ocid}, DNCP=${procRow.dncp_nro}, Moneda=${procRow.moneda}`);

  // 3.2 Release References
  console.log("\n[3.2] Verificando release references (releases_metadata)...");
  assert(Array.isArray(procRow.releases_metadata), "releases_metadata debe ser un array JSONB");
  assert(procRow.releases_metadata.length > 0, "releases_metadata no debe estar vacío");
  const firstRel = procRow.releases_metadata[0];
  assert(Boolean(firstRel.date), "Release reference debe tener fecha");
  assert(Boolean(firstRel.payload_sha256), "Release reference debe incluir payload_sha256");
  console.log(`  ✓ Release references verificadas: ${procRow.releases_metadata.length} releases indexadas.`);
  console.log(`    Muestra de tags: ${JSON.stringify(firstRel.tag)}, SHA-256: ${firstRel.payload_sha256.slice(0, 16)}...`);

  // 3.3 Contrato
  console.log("\n[3.3] Verificando procurement_contracts...");
  const { data: contracts, error: contractErr } = await supabase
    .from("procurement_contracts")
    .select("*")
    .eq("process_id", processId1);

  assert(!contractErr, `Error consultando contratos: ${contractErr?.message}`);
  assert(contracts.length === 1, `Debe haber exactamente 1 contrato, encontrados: ${contracts.length}`);
  
  const contract = contracts[0];
  assert(contract.contract_dncp_id === "LP-11001-19-183665", `ID contrato incorrecto: ${contract.contract_dncp_id}`);
  assert(Number(contract.monto_contrato_original) === 824999752, `Monto original debe ser 824,999,752, obtenido: ${contract.monto_contrato_original}`);
  assert(contract.moneda === "PYG", `Moneda del contrato debe ser PYG, obtenido: ${contract.moneda}`);
  assert(contract.status === "active", `Estado del contrato debe ser active, obtenido: ${contract.status}`);
  assert(contract.amendment_count === 1, `Debe registrar 1 adenda en amendment_count, obtenido: ${contract.amendment_count}`);
  assert(Number(contract.total_amendment_amount_delta) === 134372811, `Delta total de adenda debe ser 134,372,811, obtenido: ${contract.total_amendment_amount_delta}`);
  assert(Number(contract.monto_contrato_vigente) === 959372563, `Monto vigente debe ser 959,372,563 (824,999,752 + 134,372,811), obtenido: ${contract.monto_contrato_vigente}`);
  console.log(`  ✓ Contrato verificado: ID=${contract.contract_dncp_id}, Original=PYG ${Number(contract.monto_contrato_original).toLocaleString()}, Vigente=PYG ${Number(contract.monto_contrato_vigente).toLocaleString()}, Adendas=${contract.amendment_count}`);

  // 3.4 Adenda
  console.log("\n[3.4] Verificando procurement_contract_amendments...");
  const { data: amendments, error: amendErr } = await supabase
    .from("procurement_contract_amendments")
    .select("*")
    .eq("process_id", processId1);

  assert(!amendErr, `Error consultando adendas: ${amendErr?.message}`);
  assert(amendments.length === 1, `Debe haber exactamente 1 adenda, encontradas: ${amendments.length}`);

  const amendment = amendments[0];
  assert(amendment.contract_id === contract.id, "La adenda debe estar enlazada al ID del contrato");
  assert(amendment.amendment_dncp_id === "371560-ricardo-diaz-martinez-1-ampliacion", `ID de adenda incorrecto: ${amendment.amendment_dncp_id}`);
  assert(Number(amendment.monto_delta) === 134372811, `Monto delta debe ser 134,372,811, obtenido: ${amendment.monto_delta}`);
  assert(amendment.tipo === "AMOUNT_INCREASE", `Tipo de adenda debe ser AMOUNT_INCREASE, obtenido: ${amendment.tipo}`);
  assert(amendment.dncp_amendment_type_raw === "Ampliación de Monto", `Tipo crudo DNCP incorrecto: ${amendment.dncp_amendment_type_raw}`);
  assert(amendment.moneda === "PYG", `Moneda de la adenda debe ser PYG, obtenido: ${amendment.moneda}`);
  assert(amendment.financial_code === "AC-11001-20-39005", `Código financiero incorrecto: ${amendment.financial_code}`);
  console.log(`  ✓ Adenda verificada: ID=${amendment.amendment_dncp_id}, Tipo=${amendment.tipo} ("${amendment.dncp_amendment_type_raw}"), Delta=PYG ${Number(amendment.monto_delta).toLocaleString()}, Código Financiero=${amendment.financial_code}`);

  // 3.5 Ítems Base64
  console.log("\n[3.5] Verificando procurement_items con IDs Base64...");
  const { data: items, error: itemsErr } = await supabase
    .from("procurement_items")
    .select("*")
    .eq("process_id", processId1)
    .order("sort_order", { ascending: true });

  assert(!itemsErr, `Error consultando items: ${itemsErr?.message}`);
  assert(items.length === 17, `Debe haber exactamente 17 items, encontrados: ${items.length}`);

  const expectedBase64Sample = "BKNfywmd4xcTVYhUzXKmpQ==";
  const sampleItem = items.find((it) => it.item_dncp_id === expectedBase64Sample);
  assert(Boolean(sampleItem), `Item con ID Base64 "${expectedBase64Sample}" no fue encontrado`);
  assert(sampleItem!.descripcion === "Provisión y colocación de zócalo de granito natural", `Descripción no coincide: ${sampleItem!.descripcion}`);
  assert(Number(sampleItem!.cantidad) === 11, `Cantidad debe ser 11, obtenido: ${sampleItem!.cantidad}`);
  assert(sampleItem!.unidad === "Metros", `Unidad debe ser Metros, obtenido: ${sampleItem!.unidad}`);
  assert(Number(sampleItem!.precio_unitario_referencial) === 425000, `Precio unitario debe ser 425,000, obtenido: ${sampleItem!.precio_unitario_referencial}`);

  const base64Items = items.filter((it) => it.item_dncp_id && it.item_dncp_id.includes("="));
  assert(base64Items.length > 0, "Debe haber items con padding base64 '=' preservado");
  console.log(`  ✓ ${items.length} Ítems verificados.`);
  console.log(`    Muestra Base64: ID="${sampleItem!.item_dncp_id}", Desc="${sampleItem!.descripcion}", Cant=${sampleItem!.cantidad} ${sampleItem!.unidad}, Unitario=PYG ${Number(sampleItem!.precio_unitario_referencial).toLocaleString()}`);

  // 3.6 Supplier
  console.log("\n[3.6] Verificando supplier (proveedor)...");
  const { data: suppliers, error: suppErr } = await supabase
    .from("procurement_suppliers")
    .select("*")
    .eq("ruc_clean", "310695");

  assert(!suppErr, `Error consultando proveedor: ${suppErr?.message}`);
  assert(suppliers.length === 1, `Debe existir exactamente 1 proveedor con RUC limpio 310695, encontrados: ${suppliers.length}`);
  const supplier = suppliers[0];
  assert(supplier.nombre === "RICARDO DIAZ MARTINEZ", `Nombre de proveedor incorrecto: ${supplier.nombre}`);
  assert(supplier.dv === "0", `DV de proveedor debe ser 0, obtenido: ${supplier.dv}`);

  const { data: contractSuppliers, error: csErr } = await supabase
    .from("procurement_contract_suppliers")
    .select("*")
    .eq("contract_id", contract.id)
    .eq("supplier_id", supplier.id);

  assert(!csErr, `Error consultando contract_suppliers: ${csErr?.message}`);
  assert(contractSuppliers.length === 1, `El proveedor debe estar vinculado en procurement_contract_suppliers`);
  assert(contract.supplier_id === supplier.id, `El contrato debe apuntar al ID del proveedor`);
  console.log(`  ✓ Supplier verificado: Nombre="${supplier.nombre}", RUC=${supplier.ruc_clean}-${supplier.dv}, Vinculado a Contrato.`);

  // ---------------------------------------------------------------------------
  // FASE 4: Ingerir 371560 POR SEGUNDA VEZ
  // ---------------------------------------------------------------------------
  console.log("\n--- FASE 4: Ingerir 371560 POR SEGUNDA VEZ ---");

  const startTime2 = Date.now();
  const { data: processId2, error: ingestErr2 } = await supabase.rpc(
    "ingestar_proceso_ocds_global",
    {
      p_cr: fullPayload371560,
      p_fuente: "DNCP_REAL_FIXTURE_371560_RETRY"
    }
  );
  const duration2 = Date.now() - startTime2;

  assert(!ingestErr2, `Error en segunda ingestión: ${ingestErr2?.message} (${ingestErr2?.code})`);
  assert(processId2 === processId1, `Violación de ID: Segunda ingestión retornó ID distinto (${processId2} vs ${processId1})`);
  console.log(`  ✓ Segunda Ingestión ejecutada en ${duration2}ms. Retornó exactamente el mismo Process ID: ${processId2}`);

  // ---------------------------------------------------------------------------
  // FASE 5: Comprobar Idempotencia Total en DB
  // ---------------------------------------------------------------------------
  console.log("\n--- FASE 5: Comprobar Idempotencia Total en DB ---");

  const { count: procCount, error: countProcErr } = await supabase
    .from("procurement_processes")
    .select("*", { count: "exact", head: true })
    .eq("ocid", "ocds-03ad3f-371560-1");

  assert(!countProcErr, `Error contando procesos: ${countProcErr?.message}`);
  assert(procCount === 1, `IDEMPOTENCIA ROTA: Hay ${procCount} procesos para el mismo OCID (esperado: 1)`);
  console.log(`  ✓ Procesos para ocds-03ad3f-371560-1: exactamente ${procCount}`);

  const { count: contractCount, error: countContractErr } = await supabase
    .from("procurement_contracts")
    .select("*", { count: "exact", head: true })
    .eq("process_id", processId1);

  assert(!countContractErr, `Error contando contratos: ${countContractErr?.message}`);
  assert(contractCount === 1, `IDEMPOTENCIA ROTA: Hay ${contractCount} contratos (esperado: 1)`);
  console.log(`  ✓ Contratos: exactamente ${contractCount}`);

  const { count: amendCount, error: countAmendErr } = await supabase
    .from("procurement_contract_amendments")
    .select("*", { count: "exact", head: true })
    .eq("process_id", processId1);

  assert(!countAmendErr, `Error contando adendas: ${countAmendErr?.message}`);
  assert(amendCount === 1, `IDEMPOTENCIA ROTA: Hay ${amendCount} adendas (esperado: 1)`);
  console.log(`  ✓ Adendas: exactamente ${amendCount}`);

  const { count: itemsCount, error: countItemsErr } = await supabase
    .from("procurement_items")
    .select("*", { count: "exact", head: true })
    .eq("process_id", processId1);

  assert(!countItemsErr, `Error contando items: ${countItemsErr?.message}`);
  assert(itemsCount === 17, `IDEMPOTENCIA ROTA: Hay ${itemsCount} items (esperado: 17)`);
  console.log(`  ✓ Ítems: exactamente ${itemsCount}`);

  const { count: csCount, error: countCsErr } = await supabase
    .from("procurement_contract_suppliers")
    .select("*", { count: "exact", head: true })
    .eq("contract_id", contract.id);

  assert(!countCsErr, `Error contando contract_suppliers: ${countCsErr?.message}`);
  assert(csCount === 1, `IDEMPOTENCIA ROTA: Hay ${csCount} contract_suppliers (esperado: 1)`);
  console.log(`  ✓ Proveedores vinculados a contrato: exactamente ${csCount}`);

  const { data: contractPostRetry, error: cprErr } = await supabase
    .from("procurement_contracts")
    .select("monto_contrato_original, monto_contrato_vigente, amendment_count, total_amendment_amount_delta")
    .eq("id", contract.id)
    .single();

  assert(!cprErr, `Error consultando contrato post re-ingestión: ${cprErr?.message}`);
  assert(Number(contractPostRetry.monto_contrato_original) === 824999752, "Monto original cambió post re-ingestión");
  assert(Number(contractPostRetry.monto_contrato_vigente) === 959372563, "Monto vigente cambió post re-ingestión");
  assert(contractPostRetry.amendment_count === 1, "amendment_count cambió post re-ingestión");
  assert(Number(contractPostRetry.total_amendment_amount_delta) === 134372811, "total_amendment_amount_delta cambió post re-ingestión");
  console.log(`  ✓ Invariantes económicos de contrato verificados post re-ingestión (monto vigente y original inmutables).`);

  console.log("\n================================================================================");
  console.log("¡TODAS LAS VERIFICACIONES PASARON CON ÉXITO ROTUNDO! (100% IDEMPOTENTE)");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("\nFATAL ERROR EJECUTANDO TEST EN POSTGRESQL:", err);
  process.exit(1);
});
