import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import { collectDatabaseMetrics } from "./db-metrics";

const TARGET_PROJECT_REF = "klvvlybltcmowoptogpe";
const BASE_URL = "https://www.contrataciones.gov.py/datos/api/v3/doc";

// 1. SAFETY ENVIRONMENT CHECK
const envPath = path.resolve(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("FATAL: .env.local not found!");
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

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl.includes(TARGET_PROJECT_REF)) {
  console.error(`FATAL SAFETY CHECK FAILED: URL ${supabaseUrl} does NOT contain ${TARGET_PROJECT_REF}!`);
  process.exit(1);
}

console.log(`[SAFETY CHECK PASSED] Connected strictly to Lab: ${supabaseUrl}`);

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

const MIN_INTERVAL_MS = 250;
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
      console.log(`  [429 Rate Limit] Pausing ${waitMs}ms before retry...`);
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

async function run() {
  const poolPath = path.resolve(process.cwd(), "scripts/controlled-500-pool.json");
  const pool: Array<{ id: number; ocid: string; year: number; category: string }> = JSON.parse(
    fs.readFileSync(poolPath, "utf8")
  );

  console.log("================================================================================");
  console.log(`FASE D: CONTROLLED 500 EXECUTION ON LAB (${TARGET_PROJECT_REF})`);
  console.log(`Total processes to ingest: ${pool.length}`);
  console.log("================================================================================\n");

  const startTime = Date.now();
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  const failureReasons: Record<string, number> = {};
  const successfulOcids: string[] = [];

  for (let i = 0; i < pool.length; i++) {
    const item = pool[i];
    attempted++;
    const url = `${BASE_URL}/ocds/record/${item.ocid}`;

    try {
      const json = await getJsonWithRetry(url);
      if (!json || !json.records || !json.records[0]) {
        throw new Error("NOT_FOUND_OR_EMPTY");
      }

      const rec = json.records[0];
      const cr = rec.compiledRelease;
      const releases = Array.isArray(rec.releases) ? rec.releases : [];

      if (!cr) {
        throw new Error("EMPTY_COMPILED_RELEASE");
      }

      const fullPayload = {
        compiledRelease: cr,
        releases,
        releasesMetadata: {
          count: releases.length,
          releaseType: releases.some((r: any) => r.releaseType === "FULL_RELEASE") ? "FULL_RELEASE" : "RELEASE_INDEX",
          ocid: rec.ocid || cr.ocid,
          fetchedAt: new Date().toISOString(),
        },
      };

      const { data: procId, error: rpcErr } = await supabase.rpc("ingestar_proceso_ocds_global", {
        p_cr: fullPayload,
        p_fuente: "CONTROLLED_500",
      });

      if (rpcErr) {
        throw new Error(`RPC_ERROR [${rpcErr.code}]: ${rpcErr.message}`);
      }

      if (!procId) {
        throw new Error("EMPTY_PROCESS_ID_RETURNED");
      }

      succeeded++;
      successfulOcids.push(item.ocid);
      if ((i + 1) % 25 === 0 || i === pool.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (attempted / parseFloat(elapsed)).toFixed(2);
        console.log(`[${i + 1}/${pool.length}] Ingested: ${succeeded} | Failed: ${failed} | Rate: ${rate} req/s | Elapsed: ${elapsed}s`);
      }
    } catch (err: any) {
      failed++;
      const reason = err.message || "UNKNOWN_ERROR";
      failureReasons[reason] = (failureReasons[reason] || 0) + 1;
      console.log(`  [X] Failed ${item.ocid} (ID ${item.id}): ${reason}`);
    }
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n================================================================================");
  console.log(`CONTROLLED 500 COMPLETED IN ${totalSec}s`);
  console.log(`- Attempted: ${attempted}`);
  console.log(`- Succeeded: ${succeeded}`);
  console.log(`- Failed: ${failed}`);
  console.log(`- Failure Reasons:`, JSON.stringify(failureReasons, null, 2));
  console.log("================================================================================\n");

  // Save successful OCIDs for Idempotency test
  fs.writeFileSync("scripts/controlled-500-successful-ocids.json", JSON.stringify(successfulOcids, null, 2), "utf8");

  // Collect and print comprehensive DB metrics
  console.log("Auditing Database State post-500...");
  const metrics = await collectDatabaseMetrics();
  console.log("Audited Database Metrics:\n", JSON.stringify(metrics, null, 2));

  fs.writeFileSync(
    "data/controlled-500-summary.json",
    JSON.stringify({
      attempted,
      succeeded,
      failed,
      failure_reasons: failureReasons,
      metrics,
    }, null, 2),
    "utf8"
  );
}

run().catch((err) => {
  console.error("FATAL RUNNER ERROR:", err);
  process.exit(1);
});