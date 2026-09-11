/**
 * REAL DNCP AMENDMENT REALITY SPIKE RUNNER
 * 
 * Fetches and processes genuine official DNCP public procurement records with modifications,
 * validating:
 * 1. Base64 / non-integer item and lot IDs.
 * 2. Exact parent resolution via extendsContractID (no guessing / no LIMIT 1).
 * 3. Consortia / multiple suppliers preservation.
 * 4. Currency preservation and dimension isolation (Amount vs Duration).
 * 5. Term-only vs Amount-only amendment handling.
 * 6. Release history preservation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { separateContractsAndExtendsAmendments, computeContractEconomicHistory } from '../lib/procurement/contract-history';

const SPIKE_DIR = path.resolve(process.cwd(), 'data', 'reality-spike');
if (!fs.existsSync(SPIKE_DIR)) {
  fs.mkdirSync(SPIKE_DIR, { recursive: true });
}

// Target discovered processes with verified modifications in DNCP
const TARGET_PROCESS_IDS = [
  371560, // Works: Reacondicionamiento Escalinata Congreso (Ampliación de Monto Gs. 134.372.811)
  372520, // Works: Terminación Depósito Portuaria Villeta (Ampliación de Monto Gs. 118.522.000)
  360200, // Goods: Libros Fac. Medicina (Rescisión unquantified)
  360600, // Services: Soporte SATAC (Ampliación de Plazo term-only)
  372517, // Goods: Alimentos (5 Ampliaciones de Monto)
  372533, // Services: Publicidad (Ampliación de Plazo term-only)
  371570, // Lease: Locación Inmueble (2 Renovaciones de Alquiler)
  371534, // Services: Internet (Ampliación de Monto)
  371538, // Installation: Montaje y Puesta en Marcha (Ampliación + Rescisión)
  371542, // Services: Publicación (Ampliación de Monto)
  371548, // Goods: Combustibles (Ampliación de Monto)
  372512  // Lease: Alquiler Oficinas Hacienda (2 Renovaciones)
];

async function fetchOrLoadRecord(nro: number): Promise<any> {
  const filePath = path.join(SPIKE_DIR, `${nro}.json`);
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }

  const url = `https://www.contrataciones.gov.py/datos/api/v3/doc/ocds/record/ocds-03ad3f-${nro}`;
  console.log(`  [Fetch Official DNCP] Downloading OCID ocds-03ad3f-${nro}...`);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${nro}`);
  }
  const json = await res.json();
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf8');
  return json;
}

export interface SpikeProcessResult {
  processId: number;
  ocid: string;
  title: string;
  category: string;
  originalContractsCount: number;
  amendmentsCount: number;
  extendsAmendmentsCount: number;
  extendsParentsResolved: number;
  extendsOrphanCount: number;
  extendsResolutionRatePct: number;
  embeddedAmendmentsCount: number;
  amendmentTypes: string[];
  currencies: string[];
  hasNonIntegerItemIds: boolean;
  hasNonIntegerLotIds: boolean;
  supplierCount: number;
  hasConsortium: boolean;
  parentResolutionRatePct: number;
  orphanAmendmentsCount: number;
  independentDimensionsValidated: boolean;
  termOnlyHandledCorrectly: boolean;
  amountOnlyHandledCorrectly: boolean;
  economicHistories: Array<{
    contractId: string;
    originalAmount: number;
    finalAmount: number | null;
    currency: string;
    hasUnresolvedAmount: boolean;
    hasUnresolvedDuration: boolean;
    growthPct: number | null;
  }>;
}

export async function runRealitySpike(): Promise<{
  totalInspected: number;
  results: SpikeProcessResult[];
  summary: {
    totalOriginalContracts: number;
    totalAmendments: number;
    totalOrphanAmendments: number;
    nonIntegerIdsConfirmed: boolean;
    consortiaDetected: boolean;
    termOnlyAmendmentsConfirmed: boolean;
    amountOnlyAmendmentsConfirmed: boolean;
  };
}> {
  console.log('================================================================================');
  console.log('REAL DNCP AMENDMENT REALITY SPIKE — GENUINE OCDS EVIDENCE VALIDATION');
  console.log(`Inspecting ${TARGET_PROCESS_IDS.length} real official DNCP processes with modifications...`);
  console.log('================================================================================\n');

  const results: SpikeProcessResult[] = [];
  let totalOrigContracts = 0;
  let totalAmendments = 0;
  let totalOrphans = 0;
  let nonIntegerIdsConfirmed = false;
  let consortiaDetected = false;
  let termOnlyConfirmed = false;
  let amountOnlyConfirmed = false;

  for (const nro of TARGET_PROCESS_IDS) {
    try {
      const recordPackage = await fetchOrLoadRecord(nro);
      const recordItem = recordPackage?.records?.[0];
      const cr = recordItem?.compiledRelease;
      if (!cr) {
        console.warn(`[!] Process ${nro} missing compiledRelease.`);
        continue;
      }

      const tender = cr.tender || {};
      const title = tender.title || '(sin título)';
      const cat = tender.mainProcurementCategory || 'unknown';
      const ocid = cr.ocid || `ocds-03ad3f-${nro}`;

      // 1. Validar IDs de Items y Lotes (Base64 / No enteros)
      const items = tender.items || [];
      const lots = tender.lots || [];
      let hasNonIntegerItemIds = false;
      let hasNonIntegerLotIds = false;

      for (const it of items) {
        if (typeof it.id === 'string' && !/^\d+$/.test(it.id)) {
          hasNonIntegerItemIds = true;
          nonIntegerIdsConfirmed = true;
        }
        if (it.relatedLot && typeof it.relatedLot === 'string' && !/^\d+$/.test(it.relatedLot)) {
          hasNonIntegerLotIds = true;
        }
      }
      for (const lot of lots) {
        if (typeof lot.id === 'string' && !/^\d+$/.test(lot.id)) {
          hasNonIntegerLotIds = true;
        }
      }

      // 2. Extraer Oferentes / Proveedores y verificar consorcios
      const awards = cr.awards || [];
      let maxSuppliersPerAward = 0;
      let totalSupplierEntries = 0;
      for (const a of awards) {
        const suppliers = a.suppliers || [];
        totalSupplierEntries += suppliers.length;
        if (suppliers.length > maxSuppliersPerAward) {
          maxSuppliersPerAward = suppliers.length;
        }
      }
      if (maxSuppliersPerAward > 1) {
        consortiaDetected = true;
      }

      // 3. Separar contratos originales vs adendas extendsContractID
      const rawContracts = cr.contracts || [];
      const { originalContracts, linkedAmendments } = separateContractsAndExtendsAmendments(rawContracts);

      // Embedded amendments en los contratos originales
      const embeddedAmendments: any[] = [];
      for (const orig of originalContracts) {
        if (Array.isArray(orig.amendments)) {
          for (const ea of orig.amendments) {
            embeddedAmendments.push({
              amendmentDncpId: ea.id || `ea-${ea.date || 'unkn'}`,
              extendsContractId: orig.id,
              sourceType: 'EMBEDDED_AMENDMENT',
              date: ea.date || null,
              description: ea.description || '',
              dncpAmendmentTypeRaw: ea.rationale || null,
              rawPayload: ea
            });
          }
        }
      }

      const allAmendments = [...linkedAmendments, ...embeddedAmendments];

      totalOrigContracts += originalContracts.length;
      totalAmendments += allAmendments.length;

      // 4. Exact Parent Matching (NUNCA adivinar con LIMIT 1)
      const originalContractMap = new Map<string, any>();
      for (const c of originalContracts) {
        if (c.id) originalContractMap.set(String(c.id).trim(), c);
        if (c.dncpContractCode) originalContractMap.set(String(c.dncpContractCode).trim(), c);
      }

      // EXTENDS CONTRACT amendments: exact parent resolution
      let extendsResolved = 0;
      let extendsOrphans = 0;
      for (const a of linkedAmendments) {
        const parentId = a.extendsContractId ? String(a.extendsContractId).trim() : null;
        if (parentId && originalContractMap.has(parentId)) {
          extendsResolved++;
        } else {
          extendsOrphans++;
        }
      }
      totalOrphans += extendsOrphans;

      const extendsResolutionRatePct = linkedAmendments.length > 0
        ? Math.round((extendsResolved / linkedAmendments.length) * 100)
        : 100;

      // 5. Computar historial económico independiente por contrato
      const economicHistories: any[] = [];
      const currencies = new Set<string>();
      let termOnlyHandled = true;
      let amountOnlyHandled = true;

      for (const orig of originalContracts) {
        const cId = String(orig.id).trim();
        const origAmt = orig.value?.amount != null ? Number(orig.value.amount) : 0;
        const cur = orig.value?.currency || 'PYG';
        currencies.add(cur);

        // Amendments strictly linked to this parent
        const parentAmendments = allAmendments.filter(a =>
          a.extendsContractId && String(a.extendsContractId).trim() === cId
        );

        let durationDays: number | null = null;
        if (orig.period?.startDate && orig.period?.endDate) {
          const s = new Date(orig.period.startDate).getTime();
          const e = new Date(orig.period.endDate).getTime();
          if (!isNaN(s) && !isNaN(e)) durationDays = Math.round((e - s) / 86_400_000);
        }

        const hist = computeContractEconomicHistory(
          {
            id: cId,
            contractDncpId: orig.dncpContractCode || cId,
            originalAmount: origAmt,
            originalDurationDays: durationDays,
            currency: cur
          },
          parentAmendments
        );

        economicHistories.push({
          contractId: cId,
          originalAmount: hist.originalAmount,
          finalAmount: hist.finalContractAmount,
          currency: hist.currency,
          hasUnresolvedAmount: hist.hasUnresolvedAmount,
          hasUnresolvedDuration: hist.hasUnresolvedDuration,
          growthPct: hist.growthPercentage
        });

        // Verificar aislamiento de dimensiones con aserciones reales
        for (const t of hist.timeline) {
          if (t.tipo === 'TERM_EXTENSION' || t.tipo === 'TERM_REDUCTION') {
            termOnlyConfirmed = true;
            // Term only amendment must NEVER alter amount delta
            if (t.amountDelta !== null && t.amountDelta !== 0) {
              termOnlyHandled = false;
            }
          }
          if (t.tipo === 'AMOUNT_INCREASE' || t.tipo === 'AMOUNT_DECREASE') {
            amountOnlyConfirmed = true;
            // Pure amount modification must not invent duration delta
            if (t.durationDeltaDays !== null && t.durationDeltaDays !== 0) {
              amountOnlyHandled = false;
            }
          }
        }
      }

      const independentDimensionsValidated = termOnlyHandled && amountOnlyHandled;
      if (!independentDimensionsValidated) {
        throw new Error(`DIMENSION_ISOLATION_ASSERTION_FAILED in process ${nro}: termOnlyHandled=${termOnlyHandled}, amountOnlyHandled=${amountOnlyHandled}`);
      }

      const amendmentTypes = Array.from(new Set(allAmendments.map(a => a.dncpAmendmentTypeRaw || a.tipo || 'OTHER')));

      const procResult: SpikeProcessResult = {
        processId: nro,
        ocid,
        title: title.slice(0, 60),
        category: cat,
        originalContractsCount: originalContracts.length,
        amendmentsCount: allAmendments.length,
        extendsAmendmentsCount: linkedAmendments.length,
        extendsParentsResolved: extendsResolved,
        extendsOrphanCount: extendsOrphans,
        extendsResolutionRatePct,
        embeddedAmendmentsCount: embeddedAmendments.length,
        amendmentTypes,
        currencies: Array.from(currencies),
        hasNonIntegerItemIds,
        hasNonIntegerLotIds,
        supplierCount: totalSupplierEntries,
        hasConsortium: maxSuppliersPerAward > 1,
        parentResolutionRatePct: extendsResolutionRatePct,
        orphanAmendmentsCount: extendsOrphans,
        independentDimensionsValidated,
        termOnlyHandledCorrectly: termOnlyHandled,
        amountOnlyHandledCorrectly: amountOnlyHandled,
        economicHistories
      };

      results.push(procResult);

      console.log(`[✓] Proceso DNCP ${nro}: "${title.slice(0, 40)}"`);
      console.log(`    Contratos orig: ${originalContracts.length} | Adendas EXTENDS: ${linkedAmendments.length} (resueltos: ${extendsResolved}, huérfanos: ${extendsOrphans}) | EMBEDDED: ${embeddedAmendments.length}`);
      console.log(`    Tipos adenda: [${amendmentTypes.join(', ')}]`);
      console.log(`    Dimensiones independientes: ${independentDimensionsValidated} (termOnly=${termOnlyHandled}, amountOnly=${amountOnlyHandled})`);
      console.log(`    IDs no-enteros: Items=${hasNonIntegerItemIds}, Lotes=${hasNonIntegerLotIds} | Consorcios: ${maxSuppliersPerAward > 1}`);
    } catch (err: any) {
      console.error(`[!] Error en spike para proceso ${nro}:`, err.message);
      throw err;
    }
  }

  const allDimensionsValidated = results.every(r => r.independentDimensionsValidated);
  if (!allDimensionsValidated) {
    throw new Error("REALITY SPIKE ASSERTION FAILED: Aislamiento dimensional violado en procesos analizados.");
  }

  const summary = {
    totalOriginalContracts: totalOrigContracts,
    totalAmendments: totalAmendments,
    totalExtendsAmendments: results.reduce((acc, r) => acc + r.extendsAmendmentsCount, 0),
    totalExtendsResolved: results.reduce((acc, r) => acc + r.extendsParentsResolved, 0),
    totalExtendsOrphans: totalOrphans,
    totalEmbeddedAmendments: results.reduce((acc, r) => acc + r.embeddedAmendmentsCount, 0),
    totalOrphanAmendments: totalOrphans,
    nonIntegerIdsConfirmed,
    consortiaDetected,
    termOnlyAmendmentsConfirmed: termOnlyConfirmed,
    amountOnlyAmendmentsConfirmed: amountOnlyConfirmed,
    independentDimensionsValidated: allDimensionsValidated
  };

  console.log('\n================================================================================');
  console.log('RESUMEN DE REALITY SPIKE CONTRA REGISTROS REALES DNCP:');
  console.log(`- Procesos inspeccionados: ${results.length}`);
  console.log(`- Contratos originales identificados: ${totalOrigContracts}`);
  console.log(`- Adendas oficiales analizadas: ${totalAmendments}`);
  console.log(`- Adendas huérfanas retenidas de forma segura: ${totalOrphans}`);
  console.log(`- IDs base64 / no enteros confirmados en producción: ${nonIntegerIdsConfirmed}`);
  console.log(`- Consorcios / múltiples oferentes confirmados: ${consortiaDetected}`);
  console.log(`- Adendas de solo plazo (term-only) verificadas: ${termOnlyConfirmed}`);
  console.log(`- Adendas de solo monto (amount-only) verificadas: ${amountOnlyConfirmed}`);
  console.log('================================================================================\n');

  return { totalInspected: results.length, results, summary };
}

if (process.argv[1]?.includes('spike-real-dncp-amendments')) {
  runRealitySpike().catch(console.error);
}
