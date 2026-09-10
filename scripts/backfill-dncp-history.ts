/**
 * GATE 3: HISTORICAL BACKFILL PIPELINE (DNCP 2015 → PRESENTE)
 * 
 * Pipeline de ingesta masiva histórica con:
 * - Checkpointing persistente (data/backfill-checkpoint.json)
 * - Rate limiting adaptativo con backoff exponencial
 * - Filtrado inteligente por relevancia en construcción / obras públicas
 * - Almacenamiento eficiente de raw payloads en data/backfill/{year}/
 * - Ingesta relacional idempotente en procurement_*
 * - Monitoreo de throughput, tasa de error y observabilidad en tiempo real
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

interface CheckpointData {
  wave: number;
  last_processed_id: number;
  total_processed: number;
  total_fetched: number;
  total_identified_construction: number;
  total_file_saved: number;
  total_db_persisted: number;
  errors_count: number;
  failure_reasons: Record<string, number>;
  by_year: Record<string, number>;
  by_category: Record<string, number>;
  top_buyers: Record<string, number>;
  start_time: string;
  last_updated_at: string;
}

const CHECKPOINT_PATH = path.resolve(process.cwd(), "data", "backfill-checkpoint.json");
const BACKFILL_DIR = path.resolve(process.cwd(), "data", "backfill");
const BASE_URL = "https://www.contrataciones.gov.py/datos/api/v3/doc";

// Conexión Supabase (opcional para dry-run o persistencia relacional)
let supabase: any = null;
try {
  const env = Object.fromEntries(
    fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
} catch {
  // Continuar en modo local si no hay .env.local
}

// ---------------------------------------------------------------------------
// Rate Limiter Adaptativo
// ---------------------------------------------------------------------------
const MIN_INTERVAL_MS = 320; // ~3.1 req/s, seguro bajo el techo de 4 req/s
let lastCall = 0;
let chain: Promise<unknown> = Promise.resolve();

async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, lastCall + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

async function getJsonWithRetry(url: string, attempt = 0): Promise<any> {
  try {
    const res = await throttled(() => fetch(url, { headers: { Accept: "application/json" } }));
    if (res.status === 429 && attempt < 5) {
      const waitMs = 1500 * Math.pow(2, attempt);
      console.log(`  [429 Rate Limit] Pausando ${waitMs}ms antes de reintentar...`);
      await new Promise((r) => setTimeout(r, waitMs));
      return getJsonWithRetry(url, attempt + 1);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err: any) {
    if (attempt < 4) {
      const waitMs = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, waitMs));
      return getJsonWithRetry(url, attempt + 1);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Heurística de Relevancia para Construcción e Infraestructura
// ---------------------------------------------------------------------------
const CONSTRUCTION_KEYWORDS = [
  "OBRA", "CONSTRUCCION", "PAVIMENTO", "ASFALTO", "EMPEDRADO", "CANALIZACION",
  "PUENTE", "EDIFICIO", "AULA", "MANTENIMIENTO EDILICIO", "ALCANTARILLADO",
  "DESAGUE", "DRAGADO", "VIAL", "PISTA", "PLAZA", "HORIZONTE", "HORMIGON",
  "POLIDEPORTIVO", "ESTRUCTURA", "TALLER", "PLANO", "FISCALIZACION", "CEMENTO"
];

function isConstructionRelevant(tender: any): boolean {
  const cat = (tender.mainProcurementCategoryDetails || tender.mainProcurementCategory || "").toUpperCase();
  if (cat.includes("OBRA") || cat.includes("CONSTRUCCION") || cat.includes("VIAL") || cat.includes("INMUEBLE")) {
    return true;
  }
  const title = (tender.title || "").toUpperCase();
  for (const kw of CONSTRUCTION_KEYWORDS) {
    if (title.includes(kw)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Gestión de Checkpoint
// ---------------------------------------------------------------------------
function loadCheckpoint(wave: number): CheckpointData {
  if (fs.existsSync(CHECKPOINT_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
      if (raw.wave === wave) {
        return {
          wave: raw.wave ?? wave,
          last_processed_id: raw.last_processed_id ?? 0,
          total_processed: raw.total_processed ?? 0,
          total_fetched: raw.total_fetched ?? raw.total_processed ?? 0,
          total_identified_construction: raw.total_identified_construction ?? raw.total_ingested_construction ?? 0,
          total_file_saved: raw.total_file_saved ?? raw.total_ingested_construction ?? 0,
          total_db_persisted: raw.total_db_persisted ?? 0,
          errors_count: raw.errors_count ?? 0,
          failure_reasons: raw.failure_reasons ?? {},
          by_year: raw.by_year ?? {},
          by_category: raw.by_category ?? {},
          top_buyers: raw.top_buyers ?? {},
          start_time: raw.start_time ?? new Date().toISOString(),
          last_updated_at: raw.last_updated_at ?? new Date().toISOString(),
        };
      }
    } catch {
      // Ignorar fallo de lectura y usar nuevo
    }
  }

  // Rango de IDs inicial por Ola:
  // Ola 1: Obras 2020-presente (IDs 370000 a 490000)
  // Ola 2: Obras 2015-2019 (IDs 280000 a 369999)
  // Ola 3: Bienes y servicios conexos
  const startId = wave === 1 ? 370000 : wave === 2 ? 280000 : 400000;

  return {
    wave,
    last_processed_id: startId,
    total_processed: 0,
    total_fetched: 0,
    total_identified_construction: 0,
    total_file_saved: 0,
    total_db_persisted: 0,
    errors_count: 0,
    failure_reasons: {},
    by_year: {},
    by_category: {},
    top_buyers: {},
    start_time: new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
  };
}

function saveCheckpoint(cp: CheckpointData) {
  cp.last_updated_at = new Date().toISOString();
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2), "utf8");
}

function saveRawRecordLocally(year: number | null, nro: string, cr: any) {
  const yearFolder = year !== null && !isNaN(year) ? String(year) : "unknown";
  const dir = path.join(BACKFILL_DIR, yearFolder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${nro}.json`);
  fs.writeFileSync(filePath, JSON.stringify(cr), "utf8");
}

// ---------------------------------------------------------------------------
// Pipeline Principal
// ---------------------------------------------------------------------------
export async function runBackfill(options?: {
  wave?: number;
  maxRecords?: number;
  idList?: number[];
  stride?: number;
}) {
  const wave = options?.wave ?? 1;
  const max = options?.maxRecords ?? 150;
  const cp = loadCheckpoint(wave);

  console.log("================================================================================");
  console.log(`GATE 3: INICIANDO PIPELINE DE INGESTA HISTÓRICA — OLA ${wave}`);
  console.log(`- Checkpoint actual: ID ${cp.last_processed_id}`);
  console.log(`- Licitaciones históricas ya procesadas: ${cp.total_processed}`);
  console.log(`- Obras/construcción identificadas: ${cp.total_identified_construction}`);
  console.log(`- Payloads guardados localmente: ${cp.total_file_saved}`);
  console.log(`- Confirmados en base de datos: ${cp.total_db_persisted}`);
  console.log(`- Meta de esta corrida: ${max} licitaciones representativas`);
  console.log("================================================================================\n");

  const startTime = Date.now();
  let processedInRun = 0;
  let constructionInRun = 0;

  // Generamos un muestreo estratificado multianual cubriendo 2020 a 2025
  // Cubriendo lotes de IDs representativos de cada año
  const idBatches: number[] = options?.idList ?? [];
  if (idBatches.length === 0) {
    const stride = options?.stride ?? 120; // Salto para cubrir ampliamente el espectro temporal
    let currentId = cp.last_processed_id;
    for (let i = 0; i < max; i++) {
      idBatches.push(currentId);
      currentId += stride;
      if (currentId > 490000) currentId = 370000 + (i % 50); // Loop de seguridad
    }
  }

  for (const nro of idBatches) {
    try {
      const url = `${BASE_URL}/ocds/record/ocds-03ad3f-${nro}`;
      const json = await getJsonWithRetry(url);

      cp.last_processed_id = nro;
      cp.total_processed++;
      cp.total_fetched++;
      processedInRun++;

      if (!json || !json.records || json.records.length === 0) {
        const reason = "NOT_FOUND_OR_EMPTY";
        cp.failure_reasons[reason] = (cp.failure_reasons[reason] || 0) + 1;
        saveCheckpoint(cp);
        continue;
      }

      const cr = json.records[0].compiledRelease;
      if (!cr || !cr.tender) {
        const reason = "NO_TENDER_RELEASE";
        cp.failure_reasons[reason] = (cp.failure_reasons[reason] || 0) + 1;
        saveCheckpoint(cp);
        continue;
      }

      const tender = cr.tender;
      const title = tender.title || "(sin título)";
      const buyer = tender.procuringEntity?.name || "Desconocido";
      const cat = tender.mainProcurementCategoryDetails || tender.mainProcurementCategory || "Sin Categoría";
      const dateStr = tender.datePublished || tender.tenderPeriod?.startDate;
      const parsedDate = dateStr ? new Date(dateStr) : null;
      const year = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.getFullYear() : null;

      const isConst = isConstructionRelevant(tender);

      if (isConst) {
        cp.total_identified_construction++;
        constructionInRun++;

        // Guardar payload crudo en warehouse local
        try {
          saveRawRecordLocally(year, String(nro), cr);
          cp.total_file_saved++;
        } catch (saveErr: any) {
          const reason = `FILE_SAVE_ERROR: ${saveErr.message || "unknown"}`;
          cp.failure_reasons[reason] = (cp.failure_reasons[reason] || 0) + 1;
        }

        // Ingestar en base de datos si supabase está activo
        // INVARIANTE: Supabase client retorna { data, error } en lugar de lanzar excepciones por fallos de SQL.
        // Incrementar total_db_persisted ÚNICAMENTE ante confirmación de éxito (!error).
        if (supabase) {
          try {
            const { data: rpcData, error: dbErr } = await supabase.rpc("ingestar_proceso_ocds_global", {
              p_cr: cr,
              p_fuente: `DNCP_BACKFILL_W${wave}`,
            });

            if (dbErr) {
              const reason = `DB_RPC_ERROR_${dbErr.code || 'NO_CODE'}: ${dbErr.message || 'unknown'}`;
              cp.failure_reasons[reason] = (cp.failure_reasons[reason] || 0) + 1;
              console.error(`  [!] Error de persistencia DB para ID ${nro} (${dbErr.code}):`, dbErr.message);
            } else {
              cp.total_db_persisted++;
            }
          } catch (unexpectedErr: any) {
            const reason = `DB_UNEXPECTED_EXCEPTION: ${unexpectedErr.message || "unknown"}`;
            cp.failure_reasons[reason] = (cp.failure_reasons[reason] || 0) + 1;
            console.error(`  [!] Excepción inesperada en llamada DB para ID ${nro}:`, unexpectedErr.message);
          }
        }

        // Estadísticas agregadas
        const yearKey = year !== null ? String(year) : "unknown";
        cp.by_year[yearKey] = (cp.by_year[yearKey] || 0) + 1;
        cp.by_category[cat] = (cp.by_category[cat] || 0) + 1;
        cp.top_buyers[buyer] = (cp.top_buyers[buyer] || 0) + 1;

        console.log(`[+] [Año ${yearKey}] ID ${nro} ✓ [CONSTRUCCIÓN]: "${title.slice(0, 45)}" | Convocante: ${buyer.slice(0, 25)}`);
      } else {
        const reason = "NON_CONSTRUCTION_CATEGORY";
        cp.failure_reasons[reason] = (cp.failure_reasons[reason] || 0) + 1;
        const yearKey = year !== null ? String(year) : "unknown";
        console.log(`[-] [Año ${yearKey}] ID ${nro}   [OMITIDO - OTRA CAT]: "${title.slice(0, 40)}" (${cat.slice(0, 20)})`);
      }

      // Guardar checkpoint cada 5 registros
      if (processedInRun % 5 === 0) {
        saveCheckpoint(cp);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const speed = (processedInRun / elapsedSec).toFixed(2);
        console.log(`    [Progreso] Procesados: ${processedInRun}/${max} | Rendimiento: ${speed} req/s`);
      }
    } catch (err: any) {
      cp.errors_count++;
      const reason = `FETCH_ERROR: ${err.message || "unknown"}`;
      cp.failure_reasons[reason] = (cp.failure_reasons[reason] || 0) + 1;
      console.error(`  [!] Error procesando ID ${nro}:`, err.message);
    }
  }

  saveCheckpoint(cp);

  const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n================================================================================");
  console.log(`BACKFILL OLA ${wave} FINALIZADO EXITOSAMENTE`);
  console.log(`- Tiempo total: ${totalTimeSec} segundos`);
  console.log(`- Total consultados en esta corrida: ${processedInRun}`);
  console.log(`- Licitaciones de construcción identificadas en esta corrida: ${constructionInRun}`);
  console.log(`- Total identificadas (construcción): ${cp.total_identified_construction}`);
  console.log(`- Total archivos guardados en disco: ${cp.total_file_saved}`);
  console.log(`- Total confirmados en base de datos: ${cp.total_db_persisted}`);
  console.log(`- Checkpoint guardado en: ${CHECKPOINT_PATH}`);
  console.log("================================================================================\n");

  return cp;
}

// Ejecución directa si se invoca desde la CLI
if (process.argv[1]?.includes("backfill-dncp-history")) {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 60;
  runBackfill({ wave: 1, maxRecords: limit }).catch(console.error);
}
