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
import { classifyProcess } from "../lib/procurement/construction-classifier";

export interface HistoricalCheckpoint {
  current_window_idx: number;
  current_page: number;
  current_record_index: number;
  last_ocid: string | null;
  total_enumerated: number;
  total_construction_matched?: number;
  total_skipped_non_construction?: number;
  total_attempted: number;
  total_succeeded: number;
  total_failed: number;
  failure_reasons: Record<string, number>;
  by_year: Record<string, { enumerated: number; succeeded: number; failed: number }>;
  completed_windows: string[];
  start_time: string;
  last_updated_at: string;
}

let activeCheckpointFile = path.resolve(process.cwd(), "data/construction-v1-backfill-checkpoint.json");
const BASE_RECORD_URL = "https://www.contrataciones.gov.py/datos/api/v3/doc/ocds/record";
export const LAB_PROJECT_REF = "klvvlybltcmowoptogpe";
export const PROD_PROJECT_REF = "ezucivipgmbvamhugkbj";

export function setCheckpointFile(customPath: string) {
  activeCheckpointFile = path.resolve(process.cwd(), customPath);
}

export function loadCheckpoint(customPath?: string): HistoricalCheckpoint {
  const filePath = customPath ? path.resolve(process.cwd(), customPath) : activeCheckpointFile;
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        ...data,
        current_record_index: data.current_record_index ?? 0,
        total_construction_matched: data.total_construction_matched ?? 0,
        total_skipped_non_construction: data.total_skipped_non_construction ?? 0,
      };
    } catch {
      // ignore and start fresh
    }
  }

  return {
    current_window_idx: 0,
    current_page: 1,
    current_record_index: 0,
    last_ocid: null,
    total_enumerated: 0,
    total_construction_matched: 0,
    total_skipped_non_construction: 0,
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

export function saveCheckpoint(cp: HistoricalCheckpoint, customPath?: string) {
  const filePath = customPath ? path.resolve(process.cwd(), customPath) : activeCheckpointFile;
  cp.last_updated_at = new Date().toISOString();
  if (!fs.existsSync(path.dirname(filePath))) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(cp, null, 2), "utf8");
}

export function extractProjectRef(supabaseUrl: string): string | null {
  const match = supabaseUrl.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match ? match[1] : null;
}

export function verifyProductionSafety(supabaseUrl: string, args: string[]) {
  const projectRef = extractProjectRef(supabaseUrl);
  const allowProdFlag = args.includes("--allow-production");

  if (!projectRef) {
    console.error(`\nFATAL: UNKNOWN_PROJECT_REF - Unable to parse project ref from URL: ${supabaseUrl}`);
    throw new Error("UNKNOWN_PROJECT_REF");
  }

  if (projectRef === LAB_PROJECT_REF) {
    console.log(`[SAFETY CHECK PASSED] Targeting authorized LAB database (${projectRef}).`);
    return;
  }

  if (projectRef === PROD_PROJECT_REF) {
    if (!allowProdFlag) {
      console.error("\n================================================================================");
      console.error("FATAL: PRODUCTION SAFETY GUARD TRIGGERED!");
      console.error(`Target database is PRODUCTION (${PROD_PROJECT_REF}), but --allow-production flag was NOT provided.`);
      console.error("Execution aborted to protect production data.");
      console.error("================================================================================\n");
      throw new Error("PRODUCTION_SAFETY_GUARD_BLOCKED");
    }
    console.log(`[SAFETY WARNING] Explicit --allow-production provided. Targeting PRODUCTION (${PROD_PROJECT_REF}).`);
    return;
  }

  console.error(`\nFATAL: UNKNOWN_PROJECT_REF - Target database ref '${projectRef}' is neither authorized LAB nor PRODUCTION.`);
  throw new Error("UNKNOWN_PROJECT_REF");
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
  targetWindow?: string;
  checkpointPath?: string;
  cliArgs?: string[];
  stopAfterFirstWindow?: boolean;
}) {
  const cliArgs = options?.cliArgs || process.argv;
  const windowArg = cliArgs.find((a) => a.startsWith("--window="))?.split("=")[1] || options?.targetWindow;
  const cpPathArg = cliArgs.find((a) => a.startsWith("--checkpoint="))?.split("=")[1] || options?.checkpointPath;

  if (cpPathArg) {
    setCheckpointFile(cpPathArg);
  }

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
  verifyProductionSafety(supabaseUrl, cliArgs);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const enumerator = new HistoricalDncpEnumerator(options?.startYear ?? 2020, options?.endYear ?? 2026);
  if (windowArg) {
    const matchedWindow = enumerator.windows.find((w) => w.id === windowArg);
    if (!matchedWindow) {
      throw new Error(`Window '${windowArg}' not found in enumerator windows`);
    }
    enumerator.windows.splice(0, enumerator.windows.length, matchedWindow);
  }

  const cp = loadCheckpoint();
  const maxToProcess = options?.maxProcesses ?? Infinity;

  console.log("================================================================================");
  console.log("CONSTRUCTION HISTORICAL DNCP BACKFILL RUNNER (2020–2026)");
  console.log(`- Target Database: ${supabaseUrl}`);
  console.log(`- Checkpoint Window: ${enumerator.windows[cp.current_window_idx]?.id || "DONE"} (Index ${cp.current_window_idx}/${enumerator.windows.length})`);
  console.log(`- Checkpoint Page: ${cp.current_page} | Matched: ${cp.total_construction_matched} | Succeeded: ${cp.total_succeeded} | Failed: ${cp.total_failed}`);
  console.log("================================================================================\n");

  let processedInThisRun = 0;
  const recentOcids = new Set<string>();
  const MAX_DEDUP_CACHE = 5000;

  for (let wIdx = cp.current_window_idx; wIdx < enumerator.windows.length; wIdx++) {
    const currentWindow = enumerator.windows[wIdx];
    const isResumeWindow = (wIdx === cp.current_window_idx);
    let pageInWindow = isResumeWindow ? cp.current_page : 1;
    let totalPages = 1;

    console.log(`\n>>> Processing Window [${currentWindow.id}] (${currentWindow.desde}..${currentWindow.hasta}) starting from Page ${pageInWindow}, Record ${isResumeWindow ? cp.current_record_index : 0} <<<`);

    while (pageInWindow <= totalPages && processedInThisRun < maxToProcess) {
      const { records, pagination } = await enumerator.fetchSearchPage(currentWindow, pageInWindow, 50);
      totalPages = pagination.total_pages || totalPages;

      const recordStartIndex = (wIdx === cp.current_window_idx && pageInWindow === cp.current_page)
        ? cp.current_record_index
        : 0;

      console.log(`  Window ${currentWindow.id} | Page ${pageInWindow}/${totalPages} (${records.length} items, starting at index ${recordStartIndex})`);

      let rIdx = recordStartIndex;
      while (rIdx < records.length && processedInThisRun < maxToProcess) {
        const rec = records[rIdx];
        const ocid = rec.ocid || rec.compiledRelease?.ocid;

        if (!ocid) {
          rIdx++;
          cp.current_record_index = rIdx;
          saveCheckpoint(cp);
          continue;
        }

        // ONE-PASS CONSTRUCTION CLASSIFIER FILTER
        const tender = rec.compiledRelease?.tender || rec.tender || {};
        const classification = classifyProcess(tender);

        if (!classification.isConstructionRelevant) {
          cp.total_skipped_non_construction = (cp.total_skipped_non_construction || 0) + 1;
          rIdx++;
          cp.current_window_idx = wIdx;
          cp.current_page = pageInWindow;
          cp.current_record_index = rIdx;
          saveCheckpoint(cp);
          continue;
        }

        cp.total_construction_matched = (cp.total_construction_matched || 0) + 1;

        // Bounded in-runner dedup check
        if (recentOcids.has(ocid)) {
          console.log(`  [DEDUP SKIP] OCID ${ocid} already processed in current session.`);
          rIdx++;
          cp.current_record_index = rIdx;
          saveCheckpoint(cp);
          continue;
        }

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
            p_fuente: `DNCP_CONSTRUCTION_V1_${currentWindow.id}`,
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
          recentOcids.add(ocid);
          if (recentOcids.size > MAX_DEDUP_CACHE) {
            const firstAdded = recentOcids.values().next().value;
            if (firstAdded) recentOcids.delete(firstAdded);
          }
          process.stdout.write(`.`);
        } catch (err: any) {
          cp.total_failed++;
          cp.by_year[yKey].failed++;
          const reason = err.message || "UNKNOWN_ERROR";
          cp.failure_reasons[reason] = (cp.failure_reasons[reason] || 0) + 1;
          process.stdout.write(`x`);
        }

        rIdx++;
        cp.current_window_idx = wIdx;
        cp.current_page = pageInWindow;
        cp.current_record_index = rIdx;
        saveCheckpoint(cp);
      }

      // Only advance page if we finished all records in this page
      if (rIdx >= records.length) {
        pageInWindow++;
        cp.current_window_idx = wIdx;
        cp.current_page = pageInWindow;
        cp.current_record_index = 0;
        saveCheckpoint(cp);
      } else {
        // We stopped early due to processedInThisRun >= maxToProcess
        break;
      }
    }

    if (pageInWindow > totalPages) {
      cp.completed_windows.push(currentWindow.id);
      cp.current_window_idx = wIdx + 1;
      cp.current_page = 1;
      cp.current_record_index = 0;
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