import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import { collectDatabaseMetrics } from "./db-metrics";

const BASE_URL = "https://www.contrataciones.gov.py/datos/api/v3/doc";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, attempt = 0): Promise<any> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 429 && attempt < 6) {
      await sleep(1500 * Math.pow(2, attempt));
      return fetchWithRetry(url, attempt + 1);
    }
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    if (attempt < 4) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchWithRetry(url, attempt + 1);
    }
    return null;
  }
}

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
  console.log("FASE E: IDEMPOTENCY VERIFICATION — STRICT 50/50 RE-INGESTION");
  console.log("================================================================================\n");

  const baseline = await collectDatabaseMetrics();
  console.log("Baseline metrics:", JSON.stringify(baseline, null, 2));

  const succOcids: string[] = JSON.parse(fs.readFileSync("scripts/controlled-500-successful-ocids.json", "utf8"));
  const sample50: string[] = [];
  const stride = Math.floor(succOcids.length / 50);
  for (let i = 0; i < 50; i++) {
    sample50.push(succOcids[i * stride]);
  }

  let reingestedCount = 0;
  for (let i = 0; i < sample50.length; i++) {
    const ocid = sample50[i];
    const url = `${BASE_URL}/ocds/record/${ocid}`;
    const json = await fetchWithRetry(url);
    if (!json || !json.records || !json.records[0]) {
      throw new Error(`Failed to fetch record for ${ocid}`);
    }

    const rec = json.records[0];
    const fullPayload = {
      compiledRelease: rec.compiledRelease,
      releases: rec.releases || [],
      releasesMetadata: {
        count: (rec.releases || []).length,
        releaseType: (rec.releases || []).some((r: any) => r.releaseType === "FULL_RELEASE") ? "FULL_RELEASE" : "RELEASE_INDEX",
        ocid: rec.ocid || rec.compiledRelease.ocid,
        fetchedAt: new Date().toISOString(),
      },
    };

    const { data: id, error } = await supabase.rpc("ingestar_proceso_ocds_global", {
      p_cr: fullPayload,
      p_fuente: "IDEMPOTENCY_STRICT_50",
    });

    if (error || !id) {
      throw new Error(`RPC Re-ingest failed for ${ocid}: ${error?.message}`);
    }

    reingestedCount++;
    process.stdout.write(`.`);
    await sleep(350);
  }

  console.log(`\nSuccessfully re-ingested: ${reingestedCount} / 50`);

  const post = await collectDatabaseMetrics();
  console.log("Post re-ingestion metrics:", JSON.stringify(post, null, 2));

  let pass = true;
  const differences: Record<string, any> = {};

  for (const key of [
    "processes", "lots", "items", "suppliers", "bids", "awards",
    "award_supplier_links", "contracts", "contract_supplier_links",
    "amendments", "documents"
  ] as const) {
    if (baseline[key] !== post[key]) {
      pass = false;
      differences[key] = { baseline: baseline[key], post: post[key] };
    }
  }

  if (pass && reingestedCount === 50) {
    console.log("\n>>> IDEMPOTENCY_50 = PASS (50/50 RE-INGESTED & ZERO STRUCTURAL DUPLICATION) <<<");
  } else {
    console.error("\n>>> IDEMPOTENCY_50 = FAIL <<<", differences);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL IDEMPOTENCY EXCEPTION:", err);
  process.exit(1);
});