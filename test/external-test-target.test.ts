import { describe, expect, it } from "vitest";
import { assertNonProductionTestTarget } from "../test-utils/external-test-target";
import { createGuardedLocalWebServer } from "../test-utils/playwright-safety";

describe("external test target safety guard", () => {
  it("starts E2E only against a runner-managed loopback Next server", () => {
    expect(createGuardedLocalWebServer("http://127.0.0.1:3005", "test")).toMatchObject({
      command: "npm run dev -- --hostname 127.0.0.1 --port 3005",
      url: "http://127.0.0.1:3005",
      reuseExistingServer: false,
    });
    expect(() => createGuardedLocalWebServer("https://app.example.test", "test")).toThrow(/loopback/);
    expect(() => createGuardedLocalWebServer("http://10.0.0.12:3005", "test")).toThrow(/loopback/);
  });

  it("allows a loopback target without external opt-in", () => {
    expect(() =>
      assertNonProductionTestTarget({
        url: "http://127.0.0.1:54321",
        env: {},
      }),
    ).not.toThrow();
  });

  it("requires explicit opt-in for an external non-production target", () => {
    expect(() =>
      assertNonProductionTestTarget({
        url: "https://isolated-test.supabase.co",
        env: {},
      }),
    ).toThrow(/ALLOW_EXTERNAL_TEST_DB=true/);

    expect(() =>
      assertNonProductionTestTarget({
        url: "https://isolated-test.supabase.co",
        env: { ALLOW_EXTERNAL_TEST_DB: "true" },
      }),
    ).not.toThrow();

    expect(() =>
      assertNonProductionTestTarget({
        projectRef: "abcdefghijklmnopqrst",
        env: {},
      }),
    ).toThrow(/ALLOW_EXTERNAL_TEST_DB=true/);
  });

  it("blocks the production project even with explicit opt-in", () => {
    expect(() =>
      assertNonProductionTestTarget({
        url: "https://ezucivipgmbvamhugkbj.supabase.co",
        env: { ALLOW_EXTERNAL_TEST_DB: "true" },
      }),
    ).toThrow(/production targets are always blocked/);

    expect(() =>
      assertNonProductionTestTarget({
        projectRef: "ezucivipgmbvamhugkbj",
        env: { ALLOW_EXTERNAL_TEST_DB: "true" },
      }),
    ).toThrow(/production targets are always blocked/);

    expect(() =>
      assertNonProductionTestTarget({
        url: "postgres://postgres%2E%65zucivipgmbvamhugkbj:secret@db.example.test:5432/postgres",
        env: { ALLOW_EXTERNAL_TEST_DB: "true" },
      }),
    ).toThrow(/production targets are always blocked/);
  });

  it("blocks production-marked hosts and runtime environments", () => {
    expect(() =>
      assertNonProductionTestTarget({
        url: "https://db.production.example.test",
        env: { ALLOW_EXTERNAL_TEST_DB: "true" },
      }),
    ).toThrow(/production targets are always blocked/);

    expect(() =>
      assertNonProductionTestTarget({
        url: "https://db.example.test/production",
        env: { ALLOW_EXTERNAL_TEST_DB: "true" },
      }),
    ).toThrow(/production targets are always blocked/);

    expect(() =>
      assertNonProductionTestTarget({
        url: "http://localhost:54321",
        env: { NODE_ENV: "production" },
      }),
    ).toThrow(/runtime environment is marked as production/);
  });

  it("fails closed for missing or malformed targets", () => {
    expect(() => assertNonProductionTestTarget({ env: {} })).toThrow(/required/);
    expect(() =>
      assertNonProductionTestTarget({ url: "not a url", env: {} }),
    ).toThrow(/invalid/);
    expect(() =>
      assertNonProductionTestTarget({
        projectRef: "../../production",
        env: { ALLOW_EXTERNAL_TEST_DB: "true" },
      }),
    ).toThrow(/project ref is invalid/);
  });
});
