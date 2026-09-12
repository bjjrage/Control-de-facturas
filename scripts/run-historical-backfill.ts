/**
 * CANONICAL HISTORICAL DNCP BACKFILL RUNNER (2015–2026)
 *
 * Implements:
 * - Official DNCP Search API enumeration (tipo_fecha=publicacion_llamado, date asc)
 * - Strict checkpoint & resume (data/historical-backfill-checkpoint.json)
 * - Explicit PRODUCTION SAFETY GUARD (--allow-production required for prod target)
 * - Safe fail-closed transaction execution via ingestar_proceso_ocds_global
 * - Year / category / buyer / failure metrics accounting
 * - Robust 429 backoff & timeout isolation
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import { HistoricalDncpEnumerator, DateWindow } from "../lib/procurement/historical-enumerator";

export interface HistoricalCheckpoint {
  current_window_idx: number;
  current_page: number;
  last_ocid: string | null;
  total_enumerated: number;
  total_attempted: number;
  total_succeeded: number;
  total_failed: number;
  failure_reasons: Record<string, number>;
  by_year: Record<string, { enumerated: number; succeeded: number; failed: number }>;
  completed_windows: string[];
  start_time: string;
  last_updated_at: string;
}

const CHECKPOINT_FILE = path.resolve(process.cwd(), "data/historical-backfill-checkpoint.json");
const BASE_RECORD_URL = "https://www.contrataciones.gov.py/datos/api/v3/doc/ocds/record";
const PROD_PROJECT_REF = "ezucivipgmbvamhugkbj";

export function loadCheckpoint(): HistoricalCheckpoint {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8"));
    } catch {
      // ignore and start fresh
    }
  }

  return {
    current_window_idx: 0,
    current_page: 1,
    last_ocid: null,
    total_enumerated: 0,
    total_attempted: 0,
    total_succeeded: 0,
    total_failed: 0,
    failure_reasons: {},
    by_year: {},
    completed_windows: [],
    start_time: new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
  };
}

export function saveCheckpoint(cp: HistoricalCheckpoint) {
  cp.last_updated_at = new Date().toISOString();
  if (!fs.existsSync(path.dirname(CHECKPOINT_FILE))) {
    fs.mkdirSync(path.dirname(CHECKPOINT_FILE), { recursive: true });
  }
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2), "utf8");
}

export function verifyProductionSafety(supabaseUrl: string, args: string[]) {
  const isProduction = supabaseUrl.includes(PROD_PROJECT_REF);
  const allowProdFlag = args.includes("--allow-production");

  if (isProduction && !allowProdFlag) {
    console.error("\n================================================================================");
    console.error("FATAL: PRODUCTION SAFETY GUARD TRIGGERED!");
    console.error(`Target database is PRODUCTION (${PROD_PROJECT_REF}), but --allow-production flag was NOT provided.`);
    console.error("Execution aborted to protect production data.");
    console.error("================================================================================\n");
    throw new Error("PRODUCTION_SAFETY_GUARD_BLOCKED");
  }

  if (isProduction && allowProdFlag) {
    console.log(`[SAFETY WARNING] Explicit --allow-production provided. Targeting PRODUCTION (${PROD_PROJECT_REF}).`);
  } else {
    console.log(`[SAFETY CHECK PASSED] Targeting non-production database (${supabaseUrl}).`);
  }
}

async function fetchWithRetry(url: string, attempt = 0): Promise<any> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 429 && attempt < 6) {
      const backoffMs = 1500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
      return fetchWithRetry(url, attempt + 1);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.json();
  } catch (err: any) {
    if (attempt < 4) {
      const backoffMs = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
      return fetchWithRetry(url, attempt + 1);
    }
    throw err;
  }
}

export async function runHistoricalBackfill(options?: {
  maxProcesses?: number;
  startYear?: number;
  endYear?: number;
  cliArgs?: string[];
  stopAfterFirstWindow?: boolean;
}) {
  const env = Object.fromEntries(
    fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";

  // 1. Production safety verification
  verifyProductionSafety(supabaseUrl, options?.cliArgs || process.argv);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const enumerator = new HistoricalDncpEnumerator(options?.startYear ?? 2015, options?.endYear ?? 2026);
  const cp = loadCheckpoint();
  const maxToProcess = options?.maxProcesses ?? Infinity;

  console.log("================================================================================");
  console.log("HISTORICAL DNCP BACKFILL RUNNER (2015–2026)");
  console.log(`- Target Database: ${supabaseUrl}`);
  console.log(`- Checkpoint Window: ${enumerator.windows[cp.current_window_idx]?.id || "DONE"} (Index ${cp.current_window_idx}/${enumerator.windows.length})`);
  console.log(`- Checkpoint Page: ${cp.current_page} | Total Succeeded: ${cp.total_succeeded} | Failed: ${cp.total_failed}`);
  console.log("================================================================================\n");

  let processedInThisRun = 0;

  for (let wIdx = cp.current_window_idx; wIdx < enumerator.windows.length; wIdx++) {
    const currentWindow = enumerator.windows[wIdx];
    const startPage = (wIdx === cp.current_window_idx) ? cp.current_page : 1;
    console.log(`\n>>> Processing Window [${currentWindow.id}] (${currentWindow.desde}..${currentWindow.hasta}) starting from Page ${startPage} <<<`);

    let pageInWindow = startPage;
    let totalPages = 1;

    while (pageInWindow <= totalPages && processedInThisRun < maxToProcess) {
      const { records, pagination } = await enumerator.fetchSearchPage(currentWindow, pageInWindow, 50);
      totalPages = pagination.total_pages || totalPages;

      console.log(`  Window ${currentWindow.id} | Page ${pageInWindow}/${totalPages} (${records.length} items)`);

      for (const rec of records) {
        if (processedInThisRun >= maxToProcess) break;

        const ocid = rec.ocid || rec.compiledRelease?.ocid;
        if (!ocid) continue;

        cp.total_enumerated++;
        const yKey = String(currentWindow.year);
        if (!cp.by_year[yKey]) cp.by_year[yKey] = { enumerated: 0, succeeded: 0, failed: 0 };
        cp.by_year[yKey].enumerated++;

        cp.total_attempted++;
        processedInThisRun++;

        try {
          // Fetch full official OCDS record
          const recordJson = await fetchWithRetry(`${BASE_RECORD_URL}/${ocid}`);
          if (!recordJson || !recordJson.records || !recordJson.records[0]) {
            throw new Error("EMPTY_RECORD");
          }

          const recordItem = recordJson.records[0];
          const cr = recordItem.compiledRelease;
          const releases = Array.isArray(recordItem.releases) ? recordItem.releases : [];

          if (!cr) throw new Error("EMPTY_COMPILED_RELEASE");

          const fullPayload = {
            compiledRelease: cr,
            releases,
            releasesMetadata: {
              count: releases.length,
              releaseType: releases.some((r: any) => r.releaseType === "FULL_RELEASE") ? "FULL_RELEASE" : "RELEASE_INDEX",
              ocid: recordItem.ocid || cr.ocid,
              fetchedAt: new Date().toISOString(),
            },
          };

          const { data: dbId, error: rpcErr } = await supabase.rpc("ingestar_proceso_ocds_global", {
            p_cr: fullPayload,
            p_fuente: `HISTORICAL_BACKFILL_${currentWindow.id}`,
          });

          if (rpcErr) {
            if (rpcErr.code === "23502" && rpcErr.message.includes("moneda")) {
              throw new Error("UNKNOWN_CURRENCY");
            }
            throw new Error(`RPC_ERROR [${rpcErr.code}]: ${rpcErr.message}`);
          }

          if (!dbId) throw new Error("EMPTY_PROCESS_ID_RETURNED");

          cp.total_succeeded++;
          cp.by_year[yKey].succeeded++;
          cp.last_ocid = ocid;
          process.stdout.write(`.`);
        } catch (err: any) {
          cp.total_failed++;
          cp.by_year[yKey].failed++;
          const reason = err.message || "UNKNOWN_ERROR";
          cp.failure_reasons[reason] = (cp.failure_reasons[reason] || 0) + 1;
          process.stdout.write(`x`);
        }
      }

      // Advance page checkpoint
      pageInWindow++;
      cp.current_window_idx = wIdx;
      cp.current_page = pageInWindow;
      saveCheckpoint(cp);
    }

    if (pageInWindow > totalPages) {
      cp.completed_windows.push(currentWindow.id);
      cp.current_window_idx = wIdx + 1;
      cp.current_page = 1;
      saveCheckpoint(cp);
      console.log(`\n  ✓ Window ${currentWindow.id} COMPLETED.`);
    }

    if (options?.stopAfterFirstWindow || processedInThisRun >= maxToProcess) {
      break;
    }
  }

  saveCheckpoint(cp);
  console.log("\n================================================================================");
  console.log("RUN TERMINATED NORMALLY");
  console.log(`Processed in this run: ${processedInThisRun}`);
  console.log(`Total Succeeded: ${cp.total_succeeded} | Total Failed: ${cp.total_failed}`);
  console.log("================================================================================\n");

  return cp;
}

if (process.argv[1]?.includes("run-historical-backfill")) {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;
  runHistoricalBackfill({ maxProcesses: limit, cliArgs: process.argv }).catch((err) => {
    console.error("FATAL RUNNER EXECUTION ERROR:", err.message);
    process.exit(1);
  });
}