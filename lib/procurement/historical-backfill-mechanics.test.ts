import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { HistoricalDncpEnumerator } from "./historical-enumerator";
import { verifyProductionSafety, loadCheckpoint, saveCheckpoint } from "../../scripts/run-historical-backfill";

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
    const prodUrl = "https://ezucivipgmbvamhugkbj.supabase.co";
    expect(() => {
      verifyProductionSafety(prodUrl, []);
    }).toThrow("PRODUCTION_SAFETY_GUARD_BLOCKED");

    expect(() => {
      verifyProductionSafety(prodUrl, ["--limit=10"]);
    }).toThrow("PRODUCTION_SAFETY_GUARD_BLOCKED");
  });

  it("3. Production Safety Guard ALLOWS writes to production ONLY when explicit --allow-production flag is provided", () => {
    const prodUrl = "https://ezucivipgmbvamhugkbj.supabase.co";
    expect(() => {
      verifyProductionSafety(prodUrl, ["--allow-production"]);
    }).not.toThrow();
  });

  it("4. Production Safety Guard transparently allows non-production lab URL without flag", () => {
    const labUrl = "https://klvvlybltcmowoptogpe.supabase.co";
    expect(() => {
      verifyProductionSafety(labUrl, []);
    }).not.toThrow();
  });

  it("5. Checkpoint persistence and resume state integrity", () => {
    const cp = loadCheckpoint();
    cp.current_window_idx = 3;
    cp.current_page = 15;
    cp.total_succeeded = 42;
    cp.last_ocid = "ocds-03ad3f-test-123";

    saveCheckpoint(cp);

    const reloaded = loadCheckpoint();
    expect(reloaded.current_window_idx).toBe(3);
    expect(reloaded.current_page).toBe(15);
    expect(reloaded.total_succeeded).toBe(42);
    expect(reloaded.last_ocid).toBe("ocds-03ad3f-test-123");
  });
});