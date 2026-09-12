import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { HistoricalDncpEnumerator } from "./historical-enumerator";
import {
  verifyProductionSafety,
  loadCheckpoint,
  saveCheckpoint,
  extractProjectRef,
  LAB_PROJECT_REF,
  PROD_PROJECT_REF,
  HistoricalCheckpoint,
} from "../../scripts/run-historical-backfill";

describe("Historical Backfill Mechanics & Safety", () => {
  const testCheckpointFile = path.resolve(process.cwd(), "data/historical-backfill-checkpoint.json");
  let backupCheckpoint: string | null = null;

  beforeEach(() => {
    if (fs.existsSync(testCheckpointFile)) {
      backupCheckpoint = fs.readFileSync(testCheckpointFile, "utf8");
    }
  });

  afterEach(() => {
    if (backupCheckpoint !== null) {
      fs.writeFileSync(testCheckpointFile, backupCheckpoint, "utf8");
    } else if (fs.existsSync(testCheckpointFile)) {
      fs.unlinkSync(testCheckpointFile);
    }
  });

  it("1. HistoricalDncpEnumerator defines contiguous semi-annual windows from 2015 to 2026", () => {
    const enumerator = new HistoricalDncpEnumerator(2015, 2026);
    expect(enumerator.windows.length).toBe(24); // 12 years * 2 windows
    expect(enumerator.windows[0].id).toBe("2015-H1");
    expect(enumerator.windows[0].desde).toBe("2015-01-01");
    expect(enumerator.windows[0].hasta).toBe("2015-06-30");
    expect(enumerator.windows[enumerator.windows.length - 1].id).toBe("2026-H2");
    expect(enumerator.windows[enumerator.windows.length - 1].hasta).toBe("2026-12-31");
  });

  it("2. Production Safety Guard BLOCKS writes to production when --allow-production is missing", () => {
    const prodUrl = `https://${PROD_PROJECT_REF}.supabase.co`;
    expect(() => {
      verifyProductionSafety(prodUrl, []);
    }).toThrow("PRODUCTION_SAFETY_GUARD_BLOCKED");

    expect(() => {
      verifyProductionSafety(prodUrl, ["--limit=10"]);
    }).toThrow("PRODUCTION_SAFETY_GUARD_BLOCKED");
  });

  it("3. Production Safety Guard ALLOWS writes to production ONLY when explicit --allow-production flag is provided", () => {
    const prodUrl = `https://${PROD_PROJECT_REF}.supabase.co`;
    expect(() => {
      verifyProductionSafety(prodUrl, ["--allow-production"]);
    }).not.toThrow();
  });

  it("4. Production Safety Guard transparently allows authorized LAB database without flag", () => {
    const labUrl = `https://${LAB_PROJECT_REF}.supabase.co`;
    expect(() => {
      verifyProductionSafety(labUrl, []);
    }).not.toThrow();
  });

  it("5. Production Safety Guard FAILS with UNKNOWN_PROJECT_REF for any foreign/unexpected project ref", () => {
    const unknownUrl1 = "https://arbitrary-project-ref-xyz.supabase.co";
    expect(() => {
      verifyProductionSafety(unknownUrl1, []);
    }).toThrow("UNKNOWN_PROJECT_REF");

    const unknownUrl2 = "https://invalid-url.example.com";
    expect(() => {
      verifyProductionSafety(unknownUrl2, []);
    }).toThrow("UNKNOWN_PROJECT_REF");
  });

  it("6. Checkpoint persistence and resume state integrity includes current_record_index", () => {
    const cp = loadCheckpoint();
    cp.current_window_idx = 3;
    cp.current_page = 15;
    cp.current_record_index = 27;
    cp.total_succeeded = 42;
    cp.last_ocid = "ocds-03ad3f-test-123";

    saveCheckpoint(cp);

    const reloaded = loadCheckpoint();
    expect(reloaded.current_window_idx).toBe(3);
    expect(reloaded.current_page).toBe(15);
    expect(reloaded.current_record_index).toBe(27);
    expect(reloaded.total_succeeded).toBe(42);
    expect(reloaded.last_ocid).toBe("ocds-03ad3f-test-123");
  });

  it("7. Deterministic lossless pagination across partial runs (15 + 15 + 20 = 50 exact unique records)", () => {
    // Simulate a 50-record page
    const mockRecords = Array.from({ length: 50 }, (_, i) => ({
      ocid: `ocds-test-${String(i + 1).padStart(3, "0")}`,
    }));

    // Fresh checkpoint
    let cp: HistoricalCheckpoint = {
      current_window_idx: 0,
      current_page: 1,
      current_record_index: 0,
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

    const processedOcids: string[] = [];

    // Helper to simulate runner record loop logic for a single page with limit
    function simulateRun(limit: number) {
      let processedInRun = 0;
      let rIdx = cp.current_record_index;

      while (rIdx < mockRecords.length && processedInRun < limit) {
        const rec = mockRecords[rIdx];
        processedOcids.push(rec.ocid);
        cp.total_succeeded++;
        cp.last_ocid = rec.ocid;
        processedInRun++;
        rIdx++;
        cp.current_record_index = rIdx;
      }

      if (rIdx >= mockRecords.length) {
        cp.current_page++;
        cp.current_record_index = 0;
      }
    }

    // Run 1: process 15 records
    simulateRun(15);
    expect(cp.current_page).toBe(1);
    expect(cp.current_record_index).toBe(15);
    expect(processedOcids.length).toBe(15);
    expect(processedOcids[14]).toBe("ocds-test-015");

    // Run 2: resume and process next 15 records
    simulateRun(15);
    expect(cp.current_page).toBe(1);
    expect(cp.current_record_index).toBe(30);
    expect(processedOcids.length).toBe(30);
    expect(processedOcids[29]).toBe("ocds-test-030");

    // Run 3: resume and process remaining 20 records
    simulateRun(20);
    expect(cp.current_page).toBe(2);
    expect(cp.current_record_index).toBe(0);
    expect(processedOcids.length).toBe(50);
    expect(processedOcids[49]).toBe("ocds-test-050");

    // Assert exact element-by-element match with original 50 items
    const expectedOcids = mockRecords.map((r) => r.ocid);
    expect(processedOcids).toEqual(expectedOcids);

    // Verify 0 duplicates, 0 skips
    const uniqueOcids = new Set(processedOcids);
    expect(uniqueOcids.size).toBe(50);
  });
});