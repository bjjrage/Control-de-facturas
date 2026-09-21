import { describe, expect, it } from "vitest";
import {
  CANONICAL_ASSETS,
  DEMO_IDS,
  REQUIRED_DOMAINS,
  SEED_PLAN,
  validateCanonicalDemoManifest,
} from "@/tests/fixtures/erp-demo/canonical-demo";

describe("canonical ERP E2E fixtures", () => {
  it("has unique deterministic IDs and all required domains", () => {
    expect(new Set(Object.values(DEMO_IDS)).size).toBe(Object.values(DEMO_IDS).length);
    expect(new Set(SEED_PLAN.map((item) => item.domain))).toEqual(new Set(REQUIRED_DOMAINS));
  });

  it("references only versioned functional assets", () => {
    expect(CANONICAL_ASSETS.length).toBeGreaterThan(0);
    expect(CANONICAL_ASSETS.every((asset) => !asset.path.includes(".env"))).toBe(true);
    expect(validateCanonicalDemoManifest()).toEqual([]);
  });
});
